"""
Phase 34: Cover requests ("I need cover").

A booked worker posts their shift for someone else to take:
  * audience 'team'   -> people on that venue's team see it (and get a notification if it fits their departments)
  * audience 'public' -> the team, plus everyone on the Find shifts board (only if the venue allows it:
                         venues.allow_public_cover)
They STAY BOOKED until someone takes it. Asking for cover never counts against reliability.

Taking it follows the venue's usual booking rules (same decision as a normal request):
  * instant (e.g. team member at a "book my team instantly" venue) -> swapped right away
  * otherwise -> a hand-off waiting for the manager (shift_transfers row with cover_request_id), shown in the
    manager's existing "Hand-offs to approve" queue. Approve = swapped; deny = the post opens again.
The background worker warns the worker + managers 12 h and 3 h before the start if nobody has taken it,
and closes posts whose shift started or whose booking is gone.
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Tuple
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import (
    CoverRequest, Shift, ShiftEvent, ShiftRequest, ShiftTransfer, User, Venue, VenueWhitelist, RequestStatus,
)
from src.schemas import CoverListing, CoverMine
from src.services.auto_confirm import decide_approval, check_double_booking
from src.services.booking import (
    _load_shift_locked, require_certs, prior_drop_in_event, withdraw_other_pending_in_event,
    ACTIVE_STATUSES, PENDING_STATUSES, BOOKED_STATUSES, as_utc,
)
from src.services.team import is_blocked, blocked_venue_ids
from src.services.departments import load_dept_context
from src.services.fit import load_requirements, required_for, load_fit, tz_of, cert_label

logger = logging.getLogger("shiftboard.cover")

LIVE = ("open", "pending_approval")
AUDIENCES = ("team", "public")
NOTE_MAX = 300
WARN_12H = timedelta(hours=12)             # "nobody has taken it yet" warnings to the worker + managers
WARN_3H = timedelta(hours=3)
NO_COVER_STATUSES = ("removed", "no_show")          # on this exact shift: can't take it


def _name(u: Optional[User]) -> str:
    if u is None:
        return "Someone"
    return (f"{u.first_name or ''} {u.last_name or ''}".strip()) or (u.email or "Someone")


async def _on_team(db: AsyncSession, venue_id, worker_id) -> bool:
    return bool(await db.scalar(select(VenueWhitelist.id).where(
        VenueWhitelist.venue_id == venue_id, VenueWhitelist.worker_id == worker_id,
        VenueWhitelist.is_active == True, VenueWhitelist.status == "active",
    )))


def effective_audience(cover: CoverRequest, venue: Venue) -> str:
    """A public post goes back to team-only if the venue turns public cover off."""
    return "public" if cover.audience == "public" and bool(venue.allow_public_cover) else "team"


# ------------------------------------------------------------------------------------------------
# Posting / cancelling
# ------------------------------------------------------------------------------------------------
async def post_cover(db: AsyncSession, worker: User, request_id: UUID, audience: str, note: Optional[str]) -> UUID:
    """Creates an open cover post for the worker's own booking. Commits. Returns its id."""
    if audience not in AUDIENCES:
        raise HTTPException(status_code=400, detail="Choose who can see it: your team, or your team and the public board.")
    clean = (note or "").strip()[:NOTE_MAX] or None
    try:
        req = await db.scalar(select(ShiftRequest).where(ShiftRequest.id == request_id))
        if req is None or req.worker_id != worker.id:
            raise HTTPException(status_code=404, detail="Shift not found.")
        if (req.status or "").lower() not in ("approved", "confirmed"):
            raise HTTPException(status_code=400, detail="You can only ask for cover on a shift you're booked on and haven't started.")
        shift = await _load_shift_locked(db, req.shift_id)
        if as_utc(shift.start_time) <= datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="This shift has already started.")
        venue = shift.venue
        if audience == "public" and not venue.allow_public_cover:
            raise HTTPException(status_code=400, detail=f"{venue.name} only lets you ask your team for cover.")
        live = await db.scalar(select(CoverRequest.id).where(CoverRequest.request_id == req.id, CoverRequest.status.in_(LIVE)))
        if live:
            raise HTTPException(status_code=400, detail="You've already asked for cover on this shift.")
        handoff = await db.scalar(select(ShiftTransfer.id).where(
            ShiftTransfer.shift_id == shift.id, ShiftTransfer.from_worker_id == worker.id,
            ShiftTransfer.status.in_(("pending_worker_acceptance", "pending_manager_approval")),
        ))
        if handoff:
            raise HTTPException(status_code=400, detail="You've already sent a hand-off for this shift. Withdraw it first.")
        cover = CoverRequest(shift_id=shift.id, venue_id=shift.venue_id, request_id=req.id, from_worker_id=worker.id,
                             audience=audience, note=clean, status="open")
        db.add(cover)
        await db.flush()
        cover_id = cover.id
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.exception("post_cover failed")
        raise HTTPException(status_code=500, detail=f"Could not post your cover request: {e}")
    return cover_id


async def cancel_cover(db: AsyncSession, worker: User, cover_id: UUID) -> None:
    """The worker takes their post down (only while nobody is waiting on a manager for it). Commits."""
    cover = await db.scalar(select(CoverRequest).where(CoverRequest.id == cover_id))
    if cover is None or cover.from_worker_id != worker.id:
        raise HTTPException(status_code=404, detail="Cover request not found.")
    if cover.status == "pending_approval":
        raise HTTPException(status_code=400, detail="Someone is already taking it and the manager is deciding. Ask the manager if you need to stop it.")
    if cover.status != "open":
        raise HTTPException(status_code=400, detail="This cover request is already closed.")
    try:
        cover.status = "cancelled"
        cover.closed_reason = "Cancelled by you"
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not cancel it: {e}")


# ------------------------------------------------------------------------------------------------
# Who can take it, and how
# ------------------------------------------------------------------------------------------------
async def taker_check(db: AsyncSession, taker: User, cover: CoverRequest, shift: Shift, venue: Venue,
                      depts=None) -> Tuple[Optional[str], str, Optional[str]]:
    """(problem or None, 'instant' | 'approval', note). `note` explains side effects (e.g. a waiting request is withdrawn)."""
    if taker.id == cover.from_worker_id:
        return "This is your own shift.", "approval", None
    if as_utc(shift.start_time) <= datetime.now(timezone.utc):
        return "This shift has already started.", "approval", None
    if await is_blocked(db, venue.id, taker.id):
        return "This venue isn't taking requests from you right now.", "approval", None
    on_team = await _on_team(db, venue.id, taker.id)
    if effective_audience(cover, venue) == "team" and not on_team:
        return "Only the venue's team can take this one.", "approval", None
    try:
        await require_certs(db, taker, shift, you=True)
    except HTTPException as e:
        return e.detail, "approval", None
    try:
        await check_double_booking(db, taker.id, shift.start_time, shift.end_time, exclude_shift_id=shift.id)
    except HTTPException:
        return "You're booked on another shift at that time.", "approval", None
    same = select(ShiftRequest, Shift.role_type).join(Shift, Shift.id == ShiftRequest.shift_id).where(
        ShiftRequest.worker_id == taker.id, func.lower(ShiftRequest.status).in_(ACTIVE_STATUSES))
    same = same.where(Shift.event_id == shift.event_id) if shift.event_id else same.where(Shift.id == shift.id)
    note = None
    for r, role in (await db.execute(same)).all():
        if (r.status or "").lower() in PENDING_STATUSES:
            note = f"Your waiting request for {role} at this event will be withdrawn."
        else:
            return f"You're already booked as {role} for this event.", "approval", None
    mine = await db.scalar(select(ShiftRequest.status).where(ShiftRequest.shift_id == shift.id, ShiftRequest.worker_id == taker.id))
    if (mine or "").lower() in NO_COVER_STATUSES:
        return "You can't take this shift.", "approval", None

    decision, _src = decide_approval(shift, venue, taker, on_team)
    mode = "instant" if decision == RequestStatus.APPROVED else "approval"
    if mode == "instant" and await prior_drop_in_event(db, taker.id, shift) is not None:
        mode = "approval"                                   # coming back after a drop always needs the manager
    if mode == "instant":
        depts = depts or await load_dept_context(db, [taker.id], [venue.id])
        if depts.match(taker.id, shift) == "outside":
            mode = "approval"                               # Phase 32.2: outside their departments
    return None, mode, note


async def take_cover(db: AsyncSession, taker: User, cover_id: UUID) -> Tuple[str, UUID]:
    """Takes a cover post. Returns ('covered' | 'pending_approval', transfer_id). Commits."""
    try:
        cover = await db.scalar(select(CoverRequest).where(CoverRequest.id == cover_id))
        if cover is None:
            raise HTTPException(status_code=404, detail="This cover request is no longer available.")
        shift = await _load_shift_locked(db, cover.shift_id)
        cover = await db.scalar(select(CoverRequest).where(CoverRequest.id == cover_id).with_for_update()
                                .execution_options(populate_existing=True))
        if cover.status != "open":
            raise HTTPException(status_code=400, detail="Someone else is already taking this shift.")
        venue = shift.venue
        orig = await db.scalar(select(ShiftRequest).where(ShiftRequest.id == cover.request_id))
        if orig is None or (orig.status or "").lower() not in ("approved", "confirmed"):
            cover.status = "cancelled"
            cover.closed_reason = "The original booking changed"
            await db.commit()
            raise HTTPException(status_code=400, detail="This shift doesn't need cover anymore.")
        problem, mode, _note = await taker_check(db, taker, cover, shift, venue)
        if problem:
            raise HTTPException(status_code=400, detail=problem)

        now = datetime.now(timezone.utc)
        from_user = await db.scalar(select(User).where(User.id == cover.from_worker_id))
        transfer = ShiftTransfer(
            shift_id=shift.id, from_worker_id=cover.from_worker_id, to_worker_id=taker.id,
            status="approved" if mode == "instant" else "pending_manager_approval",
            notes=("Cover request" + (f": {cover.note}" if cover.note else "")), cover_request_id=cover.id,
        )
        db.add(transfer)
        await db.flush()
        cover.taken_by_worker_id = taker.id
        cover.transfer_id = transfer.id
        if mode == "instant":
            await swap(db, shift, orig, taker, from_user, approved_by=None)
            cover.status = "covered"
        else:
            cover.status = "pending_approval"
        transfer_id = transfer.id
        result = cover.status
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.exception("take_cover failed")
        raise HTTPException(status_code=500, detail=f"Could not take this shift: {e}")
    return result, transfer_id


async def swap(db: AsyncSession, shift: Shift, orig: ShiftRequest, taker: User, from_user: Optional[User], approved_by=None) -> ShiftRequest:
    """Moves the booking from the original worker to the taker. Spots don't change. Does NOT commit."""
    now = datetime.now(timezone.utc)
    orig.status = "transferred"
    orig.status_reason = f"Covered by {_name(taker)}"
    to_req = await db.scalar(select(ShiftRequest).where(ShiftRequest.shift_id == shift.id, ShiftRequest.worker_id == taker.id))
    if to_req is None:
        to_req = ShiftRequest(shift_id=shift.id, worker_id=taker.id)
        db.add(to_req)
    to_req.status = "approved"
    to_req.approval_source = "cover"
    to_req.approved_by_user_id = approved_by
    to_req.approved_at = now
    to_req.status_reason = f"Covering for {_name(from_user)}"
    to_req.pay_rate = None
    to_req.check_in_time = None
    to_req.check_in_verified = False
    to_req.check_out_time = None
    to_req.check_out_verified = False
    await withdraw_other_pending_in_event(db, taker.id, shift.event_id, shift.id, "Took a shift that needed cover at this event")
    await db.flush()
    return to_req


async def check_before_approve(db: AsyncSession, transfer: ShiftTransfer) -> None:
    """Manager approving a cover take: the original worker must still hold the shift. Raises 400 if not."""
    if not transfer.cover_request_id:
        return
    cover = await db.scalar(select(CoverRequest).where(CoverRequest.id == transfer.cover_request_id))
    orig = await db.scalar(select(ShiftRequest).where(ShiftRequest.id == cover.request_id)) if cover else None
    if orig is None or (orig.status or "").lower() not in ("approved", "confirmed"):
        raise HTTPException(status_code=400, detail="The original worker isn't on this shift anymore, so there's nothing to cover.")


async def after_transfer_review(db: AsyncSession, transfer: ShiftTransfer) -> None:
    """Called by the manager's hand-off review before its commit: keeps the cover post in step. Does NOT commit."""
    if not transfer.cover_request_id:
        return
    await db.flush()                          # the session doesn't autoflush: make the new booking row visible
    cover = await db.scalar(select(CoverRequest).where(CoverRequest.id == transfer.cover_request_id))
    if cover is None:
        return
    st = (transfer.status or "").lower()
    if st == "approved":
        cover.status = "covered"
        taker = await db.scalar(select(User).where(User.id == transfer.to_worker_id))
        frm = await db.scalar(select(User).where(User.id == transfer.from_worker_id))
        for r in (await db.execute(select(ShiftRequest).where(
                ShiftRequest.shift_id == transfer.shift_id,
                ShiftRequest.worker_id.in_((transfer.to_worker_id, transfer.from_worker_id))))).scalars().all():
            if r.worker_id == transfer.to_worker_id:
                r.approval_source = "cover"
                r.status_reason = f"Covering for {_name(frm)}"
            elif (r.status or "").lower() == "transferred":
                r.status_reason = f"Covered by {_name(taker)}"
    elif st in ("denied", "declined"):
        if cover.status == "pending_approval":
            cover.status = "open"             # back up for someone else
            cover.taken_by_worker_id = None
            cover.transfer_id = None
    elif st == "cancelled_by_sender":         # the worker withdrew: they keep the shift, the post closes
        if cover.status in LIVE:
            cover.status = "cancelled"
            cover.closed_reason = "Cancelled by you"


async def close_for_request(db: AsyncSession, request_id: UUID, reason: str) -> int:
    """The booking is going away (dropped / removed / no-show): close its live cover post and any
    cover take waiting for the manager. Does NOT commit. Returns how many were closed."""
    n = 0
    for cover in (await db.execute(select(CoverRequest).where(
            CoverRequest.request_id == request_id, CoverRequest.status.in_(LIVE)))).scalars().all():
        if cover.transfer_id:
            t = await db.scalar(select(ShiftTransfer).where(ShiftTransfer.id == cover.transfer_id))
            if t is not None and t.status == "pending_manager_approval":
                t.status = "cancelled_by_sender"
        cover.status = "cancelled"
        cover.closed_reason = reason
        n += 1
    return n


# ------------------------------------------------------------------------------------------------
# Lists
# ------------------------------------------------------------------------------------------------
def _rate_for(shift: Shift, booked_here: bool) -> Tuple[Optional[float], Optional[float]]:
    if shift.hide_rate and not booked_here:
        return None, None
    return float(shift.hourly_rate), (float(shift.hourly_rate_max) if shift.hourly_rate_max is not None else None)


async def open_for(db: AsyncSession, viewer: User) -> List[CoverListing]:
    """Cover posts this person can see: their teams' posts, plus public posts from venues that allow them."""
    now = datetime.now(timezone.utc)
    rows = (await db.execute(
        select(CoverRequest, Shift, Venue, ShiftEvent, User)
        .join(Shift, Shift.id == CoverRequest.shift_id)
        .join(Venue, Venue.id == CoverRequest.venue_id)
        .outerjoin(ShiftEvent, ShiftEvent.id == Shift.event_id)
        .join(User, User.id == CoverRequest.from_worker_id)
        .where(CoverRequest.status == "open", Shift.start_time > now, CoverRequest.from_worker_id != viewer.id)
        .order_by(Shift.start_time.asc())
        .limit(100)
    )).all()
    if not rows:
        return []
    blocked = await blocked_venue_ids(db, viewer.id)
    team = set((await db.execute(select(VenueWhitelist.venue_id).where(
        VenueWhitelist.worker_id == viewer.id, VenueWhitelist.is_active == True, VenueWhitelist.status == "active",
    ))).scalars().all())
    depts = await load_dept_context(db, [viewer.id], {r[2].id for r in rows})
    out: List[CoverListing] = []
    for cover, shift, venue, event, frm in rows:
        if venue.id in blocked:
            continue
        aud = effective_audience(cover, venue)
        if aud == "team" and venue.id not in team:
            continue
        problem, mode, note = await taker_check(db, viewer, cover, shift, venue, depts=depts)
        rate, rate_max = _rate_for(shift, False)
        start, end = as_utc(shift.start_time), as_utc(shift.end_time)
        out.append(CoverListing(
            cover_id=cover.id, shift_id=shift.id, event_id=shift.event_id,
            title=(event.title if event is not None else None) or shift.title or shift.role_type,
            role_type=shift.role_type or "Shift", venue_id=venue.id, venue_name=venue.name,
            venue_timezone=venue.timezone or "America/New_York",
            start_time=shift.start_time, end_time=shift.end_time,
            hours=round(max(0.0, (end - start).total_seconds() / 3600.0), 2),
            hourly_rate=rate, hourly_rate_max=rate_max, hide_rate=bool(shift.hide_rate),
            tips_eligible=bool(shift.tips_eligible),
            from_first_name=(frm.first_name or "A teammate"), note=cover.note,
            audience=aud, on_team=venue.id in team,
            can_take=problem is None, problem=problem, booking=mode, take_note=note,
            department_match=depts.match(viewer.id, shift),
            created_at=cover.created_at,
        ))
    return out


async def mine(db: AsyncSession, worker: User) -> List[CoverMine]:
    rows = (await db.execute(
        select(CoverRequest, User).outerjoin(User, User.id == CoverRequest.taken_by_worker_id)
        .where(CoverRequest.from_worker_id == worker.id, CoverRequest.status.in_(LIVE))
    )).all()
    return [CoverMine(cover_id=c.id, request_id=c.request_id, shift_id=c.shift_id, status=c.status, audience=c.audience,
                      note=c.note, taker_first_name=(u.first_name if u is not None else None), created_at=c.created_at)
            for c, u in rows]


# ------------------------------------------------------------------------------------------------
# Background sweep (every minute, from the notification worker)
# ------------------------------------------------------------------------------------------------
async def sweep(db: AsyncSession, now: datetime) -> List[Tuple[str, UUID]]:
    """Closes stale posts and returns warnings to send: [('12h'|'3h', cover_id)]. Does NOT commit."""
    rows = (await db.execute(
        select(CoverRequest, Shift, ShiftRequest)
        .join(Shift, Shift.id == CoverRequest.shift_id)
        .join(ShiftRequest, ShiftRequest.id == CoverRequest.request_id)
        .where(CoverRequest.status.in_(LIVE))
    )).all()
    warnings = []

    async def _close(cover, status, reason, transfer_status):
        if cover.status == "pending_approval" and cover.transfer_id:
            t = await db.scalar(select(ShiftTransfer).where(ShiftTransfer.id == cover.transfer_id))
            if t is not None and t.status == "pending_manager_approval":
                t.status = transfer_status
        cover.status = status
        cover.closed_reason = reason

    for cover, shift, req in rows:
        start = as_utc(shift.start_time)
        if start <= now:
            await _close(cover, "expired", "The shift started", "expired")
            continue
        if (req.status or "").lower() not in ("approved", "confirmed"):
            await _close(cover, "cancelled", "The booking changed (dropped, removed or cancelled)", "cancelled_by_sender")
            continue
        if (shift.status or "").upper() == "CANCELLED":
            await _close(cover, "cancelled", "The shift was cancelled", "cancelled_by_sender")
            continue
        if cover.status != "open":
            continue
        left = start - now
        if left <= WARN_3H:
            if cover.warned_3h_at is None:
                cover.warned_3h_at = now
                cover.warned_12h_at = cover.warned_12h_at or now     # never send the 12 h one after the 3 h one
                warnings.append(("3h", cover.id))
        elif left <= WARN_12H and cover.warned_12h_at is None:
            cover.warned_12h_at = now
            warnings.append(("12h", cover.id))
    return warnings
