"""
Phase 34: Waitlists for full positions.

* A worker joins the waitlist of a FULL position (one live place per event).
* When a spot opens (someone drops, is removed, a manager adds a spot ...), the background worker
  (every minute, and right after a drop) goes down the line in join order:
    - auto_book = True  -> it asks for the spot for them with the venue's usual rules
                           (request_position: instant booking, or a request the manager reviews)
    - auto_book = False -> they get an OFFER for a short time (30 min; 10 min if the shift starts
                           within 3 hours). Take = same as auto_book. Pass / time out = next person.
* A live offer HOLDS the spot: nobody else can book it while the offer is open (request_position).
* Entries close when the shift starts or is cancelled, or when the person can't be booked anymore
  (the reason is kept in closed_reason and sent to them).
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Iterable, List, Optional, Tuple
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import AsyncSessionLocal
from src.models import Shift, ShiftEvent, ShiftRequest, User, Venue, WaitlistEntry
from src.schemas import ListingWaitlist, WaitlistMine
from src.services.auto_confirm import check_double_booking
from src.services.booking import (
    as_utc, require_certs, prior_drop_in_event, ACTIVE_STATUSES, PENDING_STATUSES, BLOCKED_MESSAGES,
)
from src.services.team import is_blocked

logger = logging.getLogger("shiftboard.waitlist")

LIVE = ("waiting", "offered")
OFFER_TIME = timedelta(minutes=30)
OFFER_TIME_SOON = timedelta(minutes=10)      # when the shift starts within SOON
SOON = timedelta(hours=3)
MAX_STEPS = 25                               # per shift per run


def _is_full(shift: Shift) -> bool:
    cap = shift.capacity if shift.capacity is not None else 1
    return (shift.status or "").upper() == "FILLED" or (shift.spots_filled or 0) >= cap


async def held_by_offers(db: AsyncSession, shift_id, exclude_worker_id=None) -> int:
    """How many spots are held by open waitlist offers (used by request_position and listings)."""
    q = select(func.count(WaitlistEntry.id)).where(
        WaitlistEntry.shift_id == shift_id, WaitlistEntry.status == "offered",
        WaitlistEntry.offer_expires_at > datetime.now(timezone.utc),
    )
    if exclude_worker_id is not None:
        q = q.where(WaitlistEntry.worker_id != exclude_worker_id)
    return int(await db.scalar(q) or 0)


# ------------------------------------------------------------------------------------------------
# Join / leave
# ------------------------------------------------------------------------------------------------
async def join(db: AsyncSession, worker: User, shift_id: UUID, auto_book: bool) -> UUID:
    """Adds the worker to a full position's waitlist. Commits. Returns the entry id."""
    try:
        shift = await db.scalar(select(Shift).where(Shift.id == shift_id))
        if shift is None:
            raise HTTPException(status_code=404, detail="Position not found.")
        st = (shift.status or "").upper()
        if st == "CANCELLED":
            raise HTTPException(status_code=400, detail="This position was cancelled.")
        if st == "DRAFT":
            raise HTTPException(status_code=400, detail="This event isn't open for requests.")
        event = await db.scalar(select(ShiftEvent).where(ShiftEvent.id == shift.event_id)) if shift.event_id else None
        if event is not None and (event.cancelled_at is not None or (event.status or "published") == "draft"):
            raise HTTPException(status_code=400, detail="This event isn't open for requests.")
        if as_utc(shift.start_time) <= datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="This shift has already started.")
        cap = shift.capacity if shift.capacity is not None else 1
        if not _is_full(shift) and (shift.spots_filled or 0) + await held_by_offers(db, shift.id, worker.id) < cap:
            raise HTTPException(status_code=400, detail="This position has open spots. Request it instead.")
        if await is_blocked(db, shift.venue_id, worker.id):
            raise HTTPException(status_code=403, detail="This venue isn't taking requests from you right now.")
        await require_certs(db, worker, shift, you=True)

        same = select(ShiftRequest.id).join(Shift, Shift.id == ShiftRequest.shift_id).where(
            ShiftRequest.worker_id == worker.id, func.lower(ShiftRequest.status).in_(ACTIVE_STATUSES))
        same = same.where(Shift.event_id == shift.event_id) if shift.event_id else same.where(Shift.id == shift.id)
        if await db.scalar(same.limit(1)):
            raise HTTPException(status_code=400, detail="You already have a request or a booking at this event.")
        mine = await db.scalar(select(ShiftRequest.status).where(
            ShiftRequest.shift_id == shift.id, ShiftRequest.worker_id == worker.id))
        if (mine or "").lower() in BLOCKED_MESSAGES:
            raise HTTPException(status_code=400, detail=BLOCKED_MESSAGES[(mine or "").lower()])
        if await prior_drop_in_event(db, worker.id, shift) is not None:
            raise HTTPException(status_code=400, detail="You dropped a shift at this event, so you can't join its waitlist. Message the manager instead.")
        try:
            await check_double_booking(db, worker.id, shift.start_time, shift.end_time, exclude_shift_id=shift.id)
        except HTTPException:
            raise HTTPException(status_code=400, detail="You're booked on another shift at that time.")

        live = select(WaitlistEntry.id).where(WaitlistEntry.worker_id == worker.id, WaitlistEntry.status.in_(LIVE))
        live = live.where(WaitlistEntry.event_id == shift.event_id) if shift.event_id else live.where(WaitlistEntry.shift_id == shift.id)
        if await db.scalar(live.limit(1)):
            raise HTTPException(status_code=400, detail="You're already on a waitlist for this event. Leave it first to pick a different position.")

        entry = WaitlistEntry(shift_id=shift.id, venue_id=shift.venue_id, event_id=shift.event_id,
                              worker_id=worker.id, auto_book=bool(auto_book), status="waiting")
        db.add(entry)
        await db.flush()
        entry_id = entry.id
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.exception("waitlist join failed")
        raise HTTPException(status_code=500, detail=f"Could not join the waitlist: {e}")
    return entry_id


async def _own_live(db: AsyncSession, worker: User, entry_id: UUID) -> WaitlistEntry:
    entry = await db.scalar(select(WaitlistEntry).where(WaitlistEntry.id == entry_id).with_for_update())
    if entry is None or entry.worker_id != worker.id:
        raise HTTPException(status_code=404, detail="Waitlist entry not found.")
    if entry.status not in LIVE:
        raise HTTPException(status_code=400, detail="You're not on this waitlist anymore.")
    return entry


async def leave(db: AsyncSession, worker: User, entry_id: UUID) -> UUID:
    """Leaves the waitlist (also turns down an open offer). Commits. Returns the shift id."""
    try:
        entry = await _own_live(db, worker, entry_id)
        entry.status = "left"
        entry.closed_reason = "You left the waitlist"
        shift_id = entry.shift_id
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not leave the waitlist: {e}")
    return shift_id


async def pass_offer(db: AsyncSession, worker: User, entry_id: UUID) -> UUID:
    """Turns down an offer. Commits. Returns the shift id (the caller runs process_shift for the next person)."""
    try:
        entry = await _own_live(db, worker, entry_id)
        if entry.status != "offered":
            raise HTTPException(status_code=400, detail="There's no offer to pass on.")
        entry.status = "passed"
        entry.closed_reason = "You passed on the spot"
        shift_id = entry.shift_id
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not pass on the offer: {e}")
    return shift_id


async def take_offer(db: AsyncSession, worker: User, entry_id: UUID) -> Tuple[str, UUID]:
    """Takes an open offer: asks for the spot with the venue's usual rules.
    Returns ('booked' | 'requested', request_id). Commits (request_position commits)."""
    from src.services.booking import request_position      # late import: booking imports this module
    entry = await db.scalar(select(WaitlistEntry).where(WaitlistEntry.id == entry_id))
    if entry is None or entry.worker_id != worker.id:
        raise HTTPException(status_code=404, detail="Waitlist entry not found.")
    if entry.status != "offered":
        raise HTTPException(status_code=400, detail="This offer isn't open anymore.")
    if entry.offer_expires_at is None or as_utc(entry.offer_expires_at) <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="This offer ran out of time.")
    shift_id = entry.shift_id
    request_id = await request_position(db, worker, shift_id, note="From the waitlist")
    return await _mark_done(db, entry_id, request_id)


async def _mark_done(db: AsyncSession, entry_id: UUID, request_id: UUID) -> Tuple[str, UUID]:
    status = (await db.scalar(select(ShiftRequest.status).where(ShiftRequest.id == request_id)) or "").lower()
    result = "requested" if status in PENDING_STATUSES else "booked"
    entry = await db.scalar(select(WaitlistEntry).where(WaitlistEntry.id == entry_id))
    if entry is not None:
        entry.status = result
        entry.request_id = request_id
        entry.closed_reason = None
        await db.commit()
    return result, request_id


# ------------------------------------------------------------------------------------------------
# Views
# ------------------------------------------------------------------------------------------------
async def _live_by_shift(db: AsyncSession, shift_ids: Iterable) -> Dict:
    """shift_id -> live entries in line order."""
    ids = list(shift_ids)
    out: Dict = {}
    if not ids:
        return out
    for e in (await db.execute(
        select(WaitlistEntry).where(WaitlistEntry.shift_id.in_(ids), WaitlistEntry.status.in_(LIVE))
        .order_by(WaitlistEntry.created_at.asc(), WaitlistEntry.id.asc())
    )).scalars().all():
        out.setdefault(e.shift_id, []).append(e)
    return out


class ListingInfo:
    """Waitlist facts for a batch of positions, for one viewer (listings) or for a manager (roster)."""

    def __init__(self, by_shift: Dict, viewer_id=None):
        self.by_shift = by_shift
        self.viewer_id = viewer_id
        now = datetime.now(timezone.utc)
        self.held = {sid: sum(1 for e in es if e.status == "offered" and e.offer_expires_at is not None
                              and as_utc(e.offer_expires_at) > now and e.worker_id != viewer_id)
                     for sid, es in by_shift.items()}
        self.my_events = set()
        for es in by_shift.values():
            for e in es:
                if viewer_id is not None and e.worker_id == viewer_id:
                    self.my_events.add(e.event_id or e.shift_id)

    def count(self, shift_id) -> int:
        return len(self.by_shift.get(shift_id, []))

    def mine(self, shift_id) -> Optional[ListingWaitlist]:
        for i, e in enumerate(self.by_shift.get(shift_id, []), start=1):
            if e.worker_id == self.viewer_id:
                return ListingWaitlist(entry_id=e.id, status=e.status, place=i, auto_book=bool(e.auto_book),
                                       offer_expires_at=e.offer_expires_at if e.status == "offered" else None)
        return None


async def listing_info(db: AsyncSession, shift_ids: Iterable, viewer_id=None) -> ListingInfo:
    return ListingInfo(await _live_by_shift(db, shift_ids), viewer_id)


async def my_entries(db: AsyncSession, worker: User) -> List[WaitlistMine]:
    rows = (await db.execute(
        select(WaitlistEntry, Shift, Venue, ShiftEvent)
        .join(Shift, Shift.id == WaitlistEntry.shift_id)
        .join(Venue, Venue.id == WaitlistEntry.venue_id)
        .outerjoin(ShiftEvent, ShiftEvent.id == Shift.event_id)
        .where(WaitlistEntry.worker_id == worker.id, WaitlistEntry.status.in_(LIVE),
               Shift.start_time > datetime.now(timezone.utc))
        .order_by(Shift.start_time.asc())
    )).all()
    lines = await _live_by_shift(db, {r[1].id for r in rows})
    out = []
    for e, shift, venue, event in rows:
        place = next((i for i, x in enumerate(lines.get(shift.id, []), start=1) if x.id == e.id), 1)
        out.append(WaitlistMine(
            entry_id=e.id, shift_id=shift.id, event_id=shift.event_id,
            title=(event.title if event is not None else None) or shift.title or shift.role_type,
            role_type=shift.role_type or "Shift", venue_name=venue.name,
            venue_timezone=venue.timezone or "America/New_York",
            start_time=shift.start_time, end_time=shift.end_time, status=e.status, place=place,
            auto_book=bool(e.auto_book), offer_expires_at=e.offer_expires_at if e.status == "offered" else None,
        ))
    return out


# ------------------------------------------------------------------------------------------------
# The engine
# ------------------------------------------------------------------------------------------------
async def _close(entry: WaitlistEntry, status: str, reason: str, events: list, notify: bool = True) -> None:
    entry.status = status
    entry.closed_reason = reason
    if notify:
        events.append(("closed", entry.id))


async def process_shift(db: AsyncSession, shift_id, now: datetime, events: list) -> None:
    """Goes down one position's line while there are free spots. Commits as it goes.
    Appends ('offer' | 'booked' | 'requested' | 'closed' | 'expired', entry_id) to `events`."""
    from src.services.booking import request_position      # late import (booking imports this module)
    for _ in range(MAX_STEPS):
        # Lock the position so two runs never hand out the same spot
        shift = await db.scalar(select(Shift).where(Shift.id == shift_id).with_for_update()
                                .execution_options(populate_existing=True))
        if shift is None:
            await db.rollback()
            return
        entries = (await db.execute(
            select(WaitlistEntry).where(WaitlistEntry.shift_id == shift_id, WaitlistEntry.status.in_(LIVE))
            .order_by(WaitlistEntry.created_at.asc(), WaitlistEntry.id.asc())
            .execution_options(populate_existing=True)
        )).scalars().all()
        if not entries:
            await db.commit()
            return
        event = await db.scalar(select(ShiftEvent).where(ShiftEvent.id == shift.event_id)) if shift.event_id else None
        start = as_utc(shift.start_time)

        # 1. Whole line closes: started / cancelled
        reason = None
        if start <= now:
            reason = "The shift started"
        elif (shift.status or "").upper() == "CANCELLED" or (event is not None and event.cancelled_at is not None):
            reason = "The position was cancelled"
        if reason:
            for e in entries:
                await _close(e, "closed", reason, events, notify=reason != "The shift started")
            await db.commit()
            return

        # 2. Offers that ran out of time
        for e in entries:
            if e.status == "offered" and (e.offer_expires_at is None or as_utc(e.offer_expires_at) <= now):
                e.status = "expired"
                e.closed_reason = "The offer ran out of time"
                events.append(("expired", e.id))
        entries = [e for e in entries if e.status in LIVE]

        # 3. Free spots not already held by an offer or a waiting request from this line
        cap = shift.capacity if shift.capacity is not None else 1
        offered = sum(1 for e in entries if e.status == "offered")
        pending_from_line = int(await db.scalar(
            select(func.count(WaitlistEntry.id)).join(ShiftRequest, ShiftRequest.id == WaitlistEntry.request_id)
            .where(WaitlistEntry.shift_id == shift_id, WaitlistEntry.status == "requested",
                   func.lower(ShiftRequest.status).in_(PENDING_STATUSES))
        ) or 0)
        free = cap - (shift.spots_filled or 0) - offered - pending_from_line
        open_now = (shift.status or "").upper() in ("OPEN", "FILLED")
        waiting = [e for e in entries if e.status == "waiting"]
        if free <= 0 or not open_now or not waiting:
            await db.commit()
            return

        nxt = waiting[0]
        if not nxt.auto_book:
            nxt.status = "offered"
            nxt.offered_at = now
            nxt.offer_expires_at = min(now + (OFFER_TIME_SOON if start - now <= SOON else OFFER_TIME), start)
            events.append(("offer", nxt.id))
            await db.commit()
            continue

        # auto_book: ask for the spot with the venue's usual rules
        entry_id, worker_id = nxt.id, nxt.worker_id
        await db.commit()                                     # release the lock; request_position takes its own
        worker = await db.scalar(select(User).where(User.id == worker_id))
        if worker is None or not worker.is_active:
            e = await db.scalar(select(WaitlistEntry).where(WaitlistEntry.id == entry_id))
            await _close(e, "closed", "Account not active", events, notify=False)
            await db.commit()
            continue
        try:
            request_id = await request_position(db, worker, shift_id, note="From the waitlist")
        except HTTPException as ex:
            e = await db.scalar(select(WaitlistEntry).where(WaitlistEntry.id == entry_id))
            if e is not None and e.status in LIVE:
                if ex.detail == "This position just filled up.":
                    await db.commit()
                    return                                    # someone else got it first; stay in line
                await _close(e, "closed", f"We couldn't book you: {ex.detail}", events)
                await db.commit()
            continue
        result, _rid = await _mark_done(db, entry_id, request_id)
        events.append((result, entry_id))


async def process(db: AsyncSession, now: datetime, shift_ids: Optional[Iterable] = None) -> list:
    """Every minute (notification worker): all positions with a live line. Returns the events to notify."""
    if shift_ids is None:
        shift_ids = (await db.execute(
            select(WaitlistEntry.shift_id).where(WaitlistEntry.status.in_(LIVE)).distinct()
        )).scalars().all()
        await db.commit()
    events: list = []
    for sid in list(shift_ids):
        try:
            await process_shift(db, sid, now, events)
        except Exception:
            await db.rollback()
            logger.exception(f"waitlist processing failed for {sid}")
    return events


async def kick(shift_id) -> None:
    """Right after a spot opens (drop, pass ...): run this position's line now. Own session. Never raises."""
    try:
        from src.services import notify_cover
        async with AsyncSessionLocal() as db:
            events = await process(db, datetime.now(timezone.utc), [shift_id])
        await notify_cover.waitlist_events(events)
    except Exception:
        logger.exception("waitlist kick failed")
