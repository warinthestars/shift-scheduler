"""
Phase 29: Managers put specific people on a position.

* assign_worker(): "Assign to..." books one person directly (manager decision, no request needed).
* create_offers(): "Offer to..." sends the position to 1-5 people. The FIRST to accept is booked;
  the others' offers become 'filled' once the position is full.
* accept_offer() / decline_offer(): the worker's side.
* list_candidates(): who can be assigned / offered, with the reason when someone can't.

Booking uses the same row locks as request_position() (event, then position), so an assign,
an offer acceptance and a worker's own request can never overbook a position.
"""
import logging
import uuid
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Tuple
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select, func, or_, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import (
    Shift, ShiftEvent, ShiftRequest, ShiftOffer, User, Venue, VenueWhitelist,
)
from src.schemas import AssignCandidate, OfferCreateResult, OfferSkip, WorkerOffer
from src.services.booking import (
    _load_shift_locked, as_utc, PENDING_STATUSES, BOOKED_STATUSES, ACTIVE_STATUSES,
)
from src.services.team import get_venue_team, is_blocked, EXCLUDED_STATUSES
from src.services.reliability import compute_reliability
from src.services.locations import load_locations
from src.auth import normalize_role

logger = logging.getLogger("shiftboard.staffing")

MAX_OFFER_PEOPLE = 5
REASSIGNABLE_STATUSES = ("withdrawn", "rejected", "cancelled", "removed")
HISTORY_MESSAGES = {
    "dropped": "dropped this shift earlier",
    "no_show": "was marked a no-show on this shift",
    "transferred": "handed this shift off earlier",
    "completed": "already completed this shift",
}
FINISHED_STATUSES = ("approved", "confirmed", "checked_in", "completed")


def full_name(u: Optional[User]) -> str:
    if u is None:
        return "Someone"
    name = f"{u.first_name or ''} {u.last_name or ''}".strip()
    return name or (u.email or "Someone")


async def _book_locked(
    db: AsyncSession,
    shift: Shift,
    worker: User,
    *,
    source: str,
    approved_by: Optional[UUID],
    who: str,
) -> ShiftRequest:
    """
    Books `worker` on the (already locked) `shift`. Does NOT commit.
    `who` words the error messages: "you" for the worker's own action, the person's name for a manager.
    """
    now = datetime.now(timezone.utc)
    you = who == "you"
    if normalize_role(worker.role) != "worker" or not worker.is_active:
        raise HTTPException(status_code=400, detail="Only active worker accounts can be booked on shifts.")
    if shift.event_id:
        event = await db.scalar(select(ShiftEvent).where(ShiftEvent.id == shift.event_id))
        if event is not None and event.cancelled_at is not None:
            raise HTTPException(status_code=400, detail="This event was cancelled.")
    if (shift.status or "").upper() == "CANCELLED":
        raise HTTPException(status_code=400, detail="This position was cancelled.")
    if as_utc(shift.end_time) <= now:
        raise HTTPException(status_code=400, detail="This shift is already over.")
    if await is_blocked(db, shift.venue_id, worker.id):
        raise HTTPException(
            status_code=400,
            detail="This venue isn't booking you right now." if you else f"{who} is blocked at this venue. Unblock them on the Team page first.",
        )
    if (shift.spots_filled or 0) >= (shift.capacity or 1) or (shift.status or "").upper() != "OPEN":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This position is already full.")

    # One active request per worker per event
    same_event_q = (
        select(ShiftRequest, Shift.role_type)
        .join(Shift, ShiftRequest.shift_id == Shift.id)
        .where(ShiftRequest.worker_id == worker.id, func.lower(ShiftRequest.status).in_(ACTIVE_STATUSES))
    )
    same_event_q = same_event_q.where(Shift.event_id == shift.event_id) if shift.event_id else same_event_q.where(Shift.id == shift.id)
    target = None
    for req, role in (await db.execute(same_event_q)).all():
        st = (req.status or "").lower()
        if req.shift_id == shift.id:
            if st in PENDING_STATUSES:
                target = req                       # their own waiting request: approve it
                continue
            raise HTTPException(status_code=400, detail="You're already booked on this position." if you else f"{who} is already booked on this position.")
        if st in PENDING_STATUSES:
            req.status = "withdrawn"
            req.status_reason = f"Booked as {shift.role_type} instead"
        else:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(f"You're already booked as {role} for this event." if you
                        else f"{who} is already booked as {role} for this event."),
            )

    if target is None:
        target = await db.scalar(
            select(ShiftRequest).where(ShiftRequest.shift_id == shift.id, ShiftRequest.worker_id == worker.id)
        )
        if target is not None:
            st = (target.status or "").lower()
            if st in HISTORY_MESSAGES:
                raise HTTPException(
                    status_code=400,
                    detail=(f"You {HISTORY_MESSAGES[st]}, so it can't be booked again here." if you
                            else f"{who} {HISTORY_MESSAGES[st]}, so they can't be booked on it again."),
                )
            if st not in REASSIGNABLE_STATUSES and st not in PENDING_STATUSES:
                raise HTTPException(status_code=400, detail=f"Already on this position (status: {st}).")

    # Overlapping booking elsewhere
    overlap = await db.scalar(
        select(Shift.title)
        .join(ShiftRequest, ShiftRequest.shift_id == Shift.id)
        .where(
            ShiftRequest.worker_id == worker.id,
            func.lower(ShiftRequest.status).in_(BOOKED_STATUSES),
            Shift.start_time < shift.end_time,
            Shift.end_time > shift.start_time,
            Shift.id != shift.id,
        )
        .limit(1)
    )
    if overlap:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(f"You're already booked at that time ({overlap})." if you
                    else f"{who} is already booked at that time ({overlap})."),
        )

    shift.spots_filled = (shift.spots_filled or 0) + 1
    if shift.spots_filled >= (shift.capacity or 1):
        shift.status = "FILLED"

    if target is None:
        target = ShiftRequest(shift_id=shift.id, worker_id=worker.id)
        db.add(target)
    target.status = "approved"
    target.approval_source = source
    target.approved_by_user_id = approved_by
    target.approved_at = now
    target.check_in_time = None
    target.check_in_verified = False
    target.check_out_time = None
    target.check_out_verified = False
    target.dropped_at = None
    target.status_reason = None
    target.pay_rate = None
    await db.flush()

    # Offers: this person's pending offer for this position is settled; if now full, the rest are 'filled'
    await db.execute(
        update(ShiftOffer)
        .where(ShiftOffer.shift_id == shift.id, ShiftOffer.worker_id == worker.id, ShiftOffer.status == "pending")
        .values(status="accepted" if source == "offer" else "cancelled", responded_at=now)
    )
    if shift.spots_filled >= (shift.capacity or 1):
        await db.execute(
            update(ShiftOffer)
            .where(ShiftOffer.shift_id == shift.id, ShiftOffer.status == "pending")
            .values(status="filled", responded_at=now)
        )
    return target


async def assign_worker(db: AsyncSession, manager: User, shift_id: UUID, worker_id: UUID) -> Tuple[UUID, str]:
    """Manager books a specific person. Commits. Returns (request_id, message)."""
    try:
        shift = await _load_shift_locked(db, shift_id)
        worker = await db.scalar(select(User).where(User.id == worker_id))
        if worker is None:
            raise HTTPException(status_code=404, detail="Person not found.")
        name = full_name(worker)
        req = await _book_locked(db, shift, worker, source="manager_assign", approved_by=manager.id, who=name)
        req_id = req.id
        role = shift.role_type
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.exception("assign_worker failed")
        raise HTTPException(status_code=500, detail=f"Could not assign: {e}")
    return req_id, f"{name} is booked as {role}."


async def create_offers(
    db: AsyncSession, manager: User, shift_id: UUID, worker_ids: List[UUID], message: Optional[str]
) -> Tuple[OfferCreateResult, List[UUID]]:
    """Creates one offer batch. Commits. Returns (result, offer ids to notify)."""
    ids = list(dict.fromkeys(worker_ids or []))
    if not ids:
        raise HTTPException(status_code=400, detail="Pick at least one person.")
    if len(ids) > MAX_OFFER_PEOPLE:
        raise HTTPException(status_code=400, detail=f"Offer to at most {MAX_OFFER_PEOPLE} people at a time.")
    now = datetime.now(timezone.utc)
    try:
        shift = await db.scalar(select(Shift).where(Shift.id == shift_id))
        if shift is None:
            raise HTTPException(status_code=404, detail="Position not found.")
        if (shift.status or "").upper() == "CANCELLED":
            raise HTTPException(status_code=400, detail="This position was cancelled.")
        if shift.event_id:
            ev = await db.scalar(select(ShiftEvent).where(ShiftEvent.id == shift.event_id))
            if ev is not None and ev.cancelled_at is not None:
                raise HTTPException(status_code=400, detail="This event was cancelled.")
        if as_utc(shift.start_time) <= now:
            raise HTTPException(status_code=400, detail="This shift has already started. Use Assign instead.")
        if (shift.spots_filled or 0) >= (shift.capacity or 1):
            raise HTTPException(status_code=400, detail="This position is already full.")

        cands = {c.worker_id: c for c in await list_candidates(db, shift, worker_ids=ids)}
        users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(ids)))).scalars().all()}
        batch = uuid.uuid4()
        skipped: List[OfferSkip] = []
        offer_ids: List[UUID] = []
        clean_msg = (message or "").strip()[:500] or None
        for wid in ids:
            u = users.get(wid)
            c = cands.get(wid)
            name = full_name(u)
            if u is None or c is None:
                skipped.append(OfferSkip(worker_id=wid, name=name, reason="Not found, inactive or blocked."))
                continue
            if c.offered:
                skipped.append(OfferSkip(worker_id=wid, name=name, reason="Already has an offer for this position."))
                continue
            if not c.available and not c.requested_this:
                skipped.append(OfferSkip(worker_id=wid, name=name, reason=c.reason or "Not available."))
                continue
            o = ShiftOffer(
                shift_id=shift.id, venue_id=shift.venue_id, worker_id=wid, batch_id=batch,
                offered_by_user_id=manager.id, status="pending", message=clean_msg,
                expires_at=shift.start_time, created_at=now,
            )
            db.add(o)
            await db.flush()
            offer_ids.append(o.id)
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.exception("create_offers failed")
        raise HTTPException(status_code=500, detail=f"Could not send offers: {e}")

    n = len(offer_ids)
    msg = (f"Offered to {n} {'person' if n == 1 else 'people'}. The first to accept gets it."
           if n else "No offers sent.")
    return OfferCreateResult(batch_id=batch if n else None, offered=n, skipped=skipped, message=msg), offer_ids


async def accept_offer(db: AsyncSession, worker: User, offer_id: UUID) -> Tuple[UUID, ShiftOffer]:
    """Worker accepts. First to accept is booked. Commits. Returns (request_id, offer)."""
    now = datetime.now(timezone.utc)
    offer = await db.scalar(select(ShiftOffer).where(ShiftOffer.id == offer_id, ShiftOffer.worker_id == worker.id))
    if offer is None:
        raise HTTPException(status_code=404, detail="Offer not found.")
    st = (offer.status or "").lower()
    if st != "pending":
        raise HTTPException(status_code=400, detail={
            "accepted": "You already accepted this offer.",
            "declined": "You declined this offer.",
            "filled": "Someone else accepted this one first.",
            "cancelled": "The manager withdrew this offer.",
        }.get(st, "This offer is no longer open."))
    if as_utc(offer.expires_at) <= now:
        raise HTTPException(status_code=400, detail="This offer has expired.")
    shift_id = offer.shift_id
    try:
        shift = await _load_shift_locked(db, shift_id)
        offer = await db.scalar(
            select(ShiftOffer).where(ShiftOffer.id == offer_id).with_for_update()
            .execution_options(populate_existing=True)
        )
        if (offer.status or "").lower() != "pending":
            raise HTTPException(status_code=409, detail="Someone else accepted this one first.")
        req = await _book_locked(db, shift, worker, source="offer", approved_by=offer.offered_by_user_id, who="you")
        req_id = req.id
        await db.commit()
    except HTTPException as e:
        await db.rollback()
        if e.status_code == status.HTTP_409_CONFLICT and "full" in str(e.detail):
            try:
                await db.execute(
                    update(ShiftOffer).where(ShiftOffer.id == offer_id, ShiftOffer.status == "pending")
                    .values(status="filled", responded_at=now)
                )
                await db.commit()
            except Exception:
                await db.rollback()
            raise HTTPException(status_code=409, detail="Someone else accepted this one first.")
        raise
    except Exception as e:
        await db.rollback()
        logger.exception("accept_offer failed")
        raise HTTPException(status_code=500, detail=f"Could not accept: {e}")
    offer = await db.scalar(select(ShiftOffer).where(ShiftOffer.id == offer_id))
    return req_id, offer


async def decline_offer(db: AsyncSession, worker: User, offer_id: UUID) -> Tuple[ShiftOffer, bool]:
    """Worker declines. Commits. Returns (offer, nobody_left) - nobody_left: every offer in the batch is answered and none accepted."""
    offer = await db.scalar(select(ShiftOffer).where(ShiftOffer.id == offer_id, ShiftOffer.worker_id == worker.id))
    if offer is None:
        raise HTTPException(status_code=404, detail="Offer not found.")
    if (offer.status or "").lower() != "pending":
        raise HTTPException(status_code=400, detail="This offer is no longer open.")
    try:
        offer.status = "declined"
        offer.responded_at = datetime.now(timezone.utc)
        await db.flush()
        statuses = (await db.execute(
            select(ShiftOffer.status).where(ShiftOffer.batch_id == offer.batch_id)
        )).scalars().all()
        nobody_left = all(s in ("declined", "cancelled") for s in statuses)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not decline: {e}")
    return offer, nobody_left


async def cancel_offer(db: AsyncSession, offer: ShiftOffer) -> None:
    if (offer.status or "").lower() != "pending":
        raise HTTPException(status_code=400, detail="Only offers that are still waiting can be withdrawn.")
    try:
        offer.status = "cancelled"
        offer.responded_at = datetime.now(timezone.utc)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not withdraw the offer: {e}")


# ---------------------------------------------------------------------------------------------
# Candidates
# ---------------------------------------------------------------------------------------------
async def list_candidates(
    db: AsyncSession, shift: Shift, *, q: Optional[str] = None, worker_ids: Optional[List[UUID]] = None,
) -> List[AssignCandidate]:
    """
    The venue's team (+ anyone matching `q` by name / email when searching, flagged on_team=False).
    Blocked people are never listed. With worker_ids: exactly those people (used to validate offers).
    """
    venue_id = shift.venue_id
    team = await get_venue_team(db, venue_id)
    team_ids = {u.id for u in team}
    people = {u.id: u for u in team}
    if worker_ids is not None:
        extra = [w for w in worker_ids if w not in people]
        if extra:
            for u in (await db.execute(
                select(User).where(User.id.in_(extra), func.lower(User.role) == "worker", User.is_active == True)
            )).scalars().all():
                people[u.id] = u
        people = {k: v for k, v in people.items() if k in set(worker_ids)}
    elif q and q.strip():
        term = f"%{q.strip().lower()}%"
        for u in (await db.execute(
            select(User).where(
                func.lower(User.role) == "worker", User.is_active == True,
                or_(
                    func.lower(User.first_name + " " + User.last_name).like(term),
                    func.lower(User.email).like(term),
                ),
            ).limit(25)
        )).scalars().all():
            people.setdefault(u.id, u)
        people = {
            k: v for k, v in people.items()
            if q.strip().lower() in f"{v.first_name or ''} {v.last_name or ''} {v.email or ''}".lower()
        }
    if not people:
        return []
    ids = list(people.keys())

    wl = {r.worker_id: r for r in (await db.execute(
        select(VenueWhitelist).where(VenueWhitelist.venue_id == venue_id, VenueWhitelist.worker_id.in_(ids))
    )).scalars().all()}
    blocked = {wid for wid, r in wl.items() if r.status == "blocked"}

    # Requests in this event (or on this position when it has no event)
    ev_q = (
        select(ShiftRequest.worker_id, ShiftRequest.shift_id, ShiftRequest.status, Shift.role_type)
        .join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(ShiftRequest.worker_id.in_(ids), func.lower(ShiftRequest.status).in_(ACTIVE_STATUSES))
    )
    ev_q = ev_q.where(Shift.event_id == shift.event_id) if shift.event_id else ev_q.where(Shift.id == shift.id)
    in_event = defaultdict(list)
    for wid, sid, st, role in (await db.execute(ev_q)).all():
        in_event[wid].append((sid, (st or "").lower(), role))

    history = {wid: (st or "").lower() for wid, st in (await db.execute(
        select(ShiftRequest.worker_id, ShiftRequest.status).where(
            ShiftRequest.shift_id == shift.id, ShiftRequest.worker_id.in_(ids)
        )
    )).all()}

    overlaps = {}
    for wid, title in (await db.execute(
        select(ShiftRequest.worker_id, Shift.title)
        .join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(
            ShiftRequest.worker_id.in_(ids),
            func.lower(ShiftRequest.status).in_(BOOKED_STATUSES),
            Shift.start_time < shift.end_time,
            Shift.end_time > shift.start_time,
            Shift.id != shift.id,
        )
    )).all():
        overlaps.setdefault(wid, title)

    offered = set((await db.execute(
        select(ShiftOffer.worker_id).where(
            ShiftOffer.shift_id == shift.id, ShiftOffer.status == "pending", ShiftOffer.worker_id.in_(ids)
        )
    )).scalars().all())

    now = datetime.now(timezone.utc)
    worked = dict((await db.execute(
        select(ShiftRequest.worker_id, func.count(ShiftRequest.id))
        .join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(
            ShiftRequest.worker_id.in_(ids), Shift.venue_id == venue_id, Shift.end_time < now,
            func.lower(ShiftRequest.status).in_(FINISHED_STATUSES),
        )
        .group_by(ShiftRequest.worker_id)
    )).all())
    rel = await compute_reliability(db, ids)
    role_l = (shift.role_type or "").lower()

    out: List[AssignCandidate] = []
    for wid, u in people.items():
        if wid in blocked:
            continue
        positions = list(wl[wid].positions or []) if wid in wl else []
        reason = None
        requested_this = False
        for sid, st, role in in_event.get(wid, []):
            if sid == shift.id and st in PENDING_STATUSES:
                requested_this = True
            elif sid == shift.id:
                reason = "Already booked on this position."
            elif st in PENDING_STATUSES:
                pass                       # booking them here withdraws that request
            else:
                reason = f"Booked as {role} for this event."
        if reason is None and history.get(wid) in HISTORY_MESSAGES:
            reason = f"Can't rebook: {HISTORY_MESSAGES[history[wid]]}."
        if reason is None and wid in overlaps:
            reason = f"Booked at that time ({overlaps[wid]})."
        out.append(AssignCandidate(
            worker_id=wid,
            first_name=u.first_name or "",
            last_name=u.last_name or "",
            email=u.email,
            phone=u.phone,
            aggregate_rating=float(u.aggregate_rating or 0.0),
            rating_count=int(u.rating_count or 0),
            reliability_score=(rel.get(wid) or {}).get("score"),
            on_team=wid in team_ids,
            positions=positions,
            position_match=any(p.lower() == role_l for p in positions),
            available=reason is None,
            reason=reason,
            requested_this=requested_this,
            offered=wid in offered,
            venue_shifts=int(worked.get(wid, 0)),
        ))
    out.sort(key=lambda c: (
        not c.requested_this, not c.available, not c.position_match, not c.on_team,
        -c.venue_shifts, (c.first_name or "").lower(), (c.last_name or "").lower(),
    ))
    return out


# ---------------------------------------------------------------------------------------------
# Worker's open offers
# ---------------------------------------------------------------------------------------------
async def worker_offers(db: AsyncSession, worker: User) -> List[WorkerOffer]:
    now = datetime.now(timezone.utc)
    rows = (await db.execute(
        select(ShiftOffer, Shift)
        .join(Shift, Shift.id == ShiftOffer.shift_id)
        .where(
            ShiftOffer.worker_id == worker.id,
            ShiftOffer.status == "pending",
            ShiftOffer.expires_at > now,
            func.upper(Shift.status) == "OPEN",
        )
        .order_by(Shift.start_time.asc())
    )).all()
    if not rows:
        return []
    venue_ids = {s.venue_id for _, s in rows}
    venues = {v.id: v for v in (await db.execute(select(Venue).where(Venue.id.in_(venue_ids)))).scalars().all()}
    event_ids = {s.event_id for _, s in rows if s.event_id}
    events = {e.id: e for e in (await db.execute(select(ShiftEvent).where(ShiftEvent.id.in_(event_ids)))).scalars().all()} if event_ids else {}
    locations = await load_locations(db, [e.location_id for e in events.values()])
    offerer_ids = {o.offered_by_user_id for o, _ in rows if o.offered_by_user_id}
    offerers = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(offerer_ids)))).scalars().all()} if offerer_ids else {}
    batch_ids = {o.batch_id for o, _ in rows}
    batch_counts = dict((await db.execute(
        select(ShiftOffer.batch_id, func.count(ShiftOffer.id))
        .where(ShiftOffer.batch_id.in_(batch_ids), ShiftOffer.status == "pending")
        .group_by(ShiftOffer.batch_id)
    )).all())

    out = []
    for o, s in rows:
        ev = events.get(s.event_id)
        if ev is not None and ev.cancelled_at is not None:
            continue
        if (s.spots_filled or 0) >= (s.capacity or 1):
            continue
        v = venues.get(s.venue_id)
        loc = locations.get(ev.location_id) if ev is not None and ev.location_id else None
        show_pay = not s.hide_rate
        out.append(WorkerOffer(
            offer_id=o.id,
            shift_id=s.id,
            event_id=s.event_id,
            venue_id=s.venue_id,
            venue_name=v.name if v else "",
            venue_timezone=v.timezone if v else None,
            title=ev.title if ev is not None else (s.title or "Shift"),
            role_type=s.role_type or "Worker",
            start_time=s.start_time,
            end_time=s.end_time,
            hourly_rate=float(s.hourly_rate) if show_pay and s.hourly_rate is not None else None,
            hourly_rate_max=float(s.hourly_rate_max) if show_pay and s.hourly_rate_max is not None else None,
            tips_eligible=bool(s.tips_eligible),
            tip_pool=bool(s.tip_pool),
            location_name=loc.name if loc is not None else None,
            address=loc.address if loc is not None else (v.address if v else None),
            message=o.message,
            offered_by=full_name(offerers.get(o.offered_by_user_id)) if o.offered_by_user_id in offerers else None,
            others_offered=max(0, int(batch_counts.get(o.batch_id, 1)) - 1),
            created_at=o.created_at,
            expires_at=o.expires_at,
        ))
    return out
