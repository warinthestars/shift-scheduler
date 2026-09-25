# Phase 26.1: Event-Based Shift Cards & One Request per Event

Workers currently see one card per **position** (a "Bar Shift – Bartender" card, a "Bar Shift – Server" card, …). For a worker, the thing they're deciding on is the **event**: *where, when, how long, what's it pay, can I get in?* This phase:

1. Replaces the Find Shifts grid with **one card per event**. Each card shows the date, venue, time and length, pay range, tips, and every position with its pay and open spots, marked ⚡ **Instant book** or **Needs approval** *for this worker*.
2. Adds an **event details modal** (click a card). It shows event, venue, dress code, arrival instructions, notes, directions and a position picker, plus an optional note to the manager.
3. Enforces **one active request per worker per event**, on the server, with row locks so double taps or two workers at once can't overbook. A waiting request can be **switched** to another position or **withdrawn**. A booked worker must drop or hand off first.
4. Makes the listing more useful for service workers:
   * cards grouped by day (Today / Tomorrow / Fri, Oct 3)
   * search, date, position and venue filters, "Instant book only" and "Hide ones I've requested"
   * estimated earnings for the shift ("≈ $150")
   * a "Your venue" badge where they've worked before
   * an **overlap warning** when an event clashes with a shift they're already booked on
5. My Schedule:
   * upcoming shifts come first, and past or closed ones are folded away
   * new buttons: **Details**, **Directions**, **Add to calendar** (.ics) and **Withdraw** for waiting requests
   * friendly status words, with the reason shown for cancelled, removed, no-show and withdrawn requests
   * this includes the Phase 26 §10 worker edits, which never reached `WorkerDashboard.jsx`
6. Managers see the worker's note in the roster ("Requested" list).
7. Venue profile pages use the same modal instead of per-position "Pick up shift" buttons.

**No database schema change.** The new request status `withdrawn` is a plain VARCHAR value, and the worker note uses the existing `shift_requests.notes` column.

## 0. Rules for this phase (read first)

* Do **NOT** touch `backend/src/auth.py`, `main.py` CORS logic, `frontend/src/context/AuthContext.jsx`, `frontend/src/api/client.js`, or `frontend/vite.config.js`.
* No native PostgreSQL ENUMs. Statuses stay lowercase VARCHAR strings.
* All backend datetime comparisons use aware UTC (`datetime.now(timezone.utc)`). The helper `as_utc()` in `services/booking.py` normalizes DB values.
* **Never** call `UserResponse.model_validate(<ORM User>)` anywhere. Never touch an ORM relationship that wasn't `selectinload`-ed (MissingGreenlet).
* Where this prompt gives a **full file**, replace the whole file with exactly that content. Where it gives an **edit**, change only the lines shown.
* Do not rename existing endpoints. The old `POST /api/shifts/{shift_id}/request` keeps working and now uses the same booking rules.

---

## 1. Backend — `backend/src/services/auto_confirm.py` (FULL FILE REPLACEMENT)

The approval decision is split into a pure function `decide_approval()`. The listings use it to label positions "Instant book" or "Needs approval" for the viewer, and `evaluate_shift_request()` uses it to decide, so the two always agree. The behavior is unchanged: whitelist lookup, then the same order of rules, then the double-booking check only when approved.

```python
import logging
from typing import Tuple, Optional
from datetime import datetime
from uuid import UUID
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from src.models import Shift, Venue, VenueWhitelist, ShiftRequest, User, RequestStatus

logger = logging.getLogger("shiftboard.auto_confirm")

async def check_double_booking(
    db: AsyncSession,
    worker_id: UUID,
    start_time: datetime,
    end_time: datetime,
    exclude_shift_id: Optional[UUID] = None
) -> None:
    """
    Checks if a worker already has an approved or active shift overlapping with the time slot:
    (existing_shift.start_time < new_shift.end_time) AND (existing_shift.end_time > new_shift.start_time).

    Raises:
        HTTPException(status_code=400, detail="Worker is already booked for this time slot.")
    """
    query = (
        select(Shift)
        .join(ShiftRequest, ShiftRequest.shift_id == Shift.id)
        .where(
            ShiftRequest.worker_id == worker_id,
            func.lower(ShiftRequest.status).in_([
                "approved", "checked_in", "confirmed"
            ]),
            Shift.start_time < end_time,
            Shift.end_time > start_time
        )
    )
    if exclude_shift_id:
        query = query.where(Shift.id != exclude_shift_id)

    overlapping = await db.scalar(query)
    if overlapping:
        logger.warning(
            f"[Double-Booking Check] Overlap detected for Worker {worker_id} "
            f"with Shift {overlapping.id} ({overlapping.start_time} - {overlapping.end_time})"
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Worker is already booked for this time slot."
        )


def decide_approval(
    shift: Shift,
    venue: Venue,
    worker: User,
    is_whitelisted: bool,
) -> Tuple[RequestStatus, Optional[str]]:
    """
    Phase 26.1: Pure decision (no database access, no side effects).
    Used by evaluate_shift_request AND by the worker listings ("Instant book" vs "Needs approval"),
    so both always agree. Order:
    1. Position approval_mode 'auto' (or legacy is_shift_auto_confirm) -> APPROVED "shift_auto_confirm"
    2. Position approval_mode 'manual'                                 -> PENDING
    3. Venue policy 'manual'                                           -> PENDING
    4. Venue policy 'everyone_auto'                                    -> APPROVED "venue_everyone_auto"
    5. Venue policy 'team_auto' AND worker on venue whitelist          -> APPROVED "venue_whitelist"
    6. Rating threshold (worker has >= 1 rating and meets threshold)   -> APPROVED "rating_threshold"
    7. Otherwise                                                       -> PENDING
    """
    shift_mode = (getattr(shift, "approval_mode", None) or "venue_default").lower()
    if shift_mode == "auto" or (shift_mode == "venue_default" and shift.is_shift_auto_confirm):
        return RequestStatus.APPROVED, "shift_auto_confirm"
    if shift_mode == "manual":
        return RequestStatus.PENDING, None

    policy = (getattr(venue, "approval_policy", None) or "team_auto").lower()
    if policy == "manual":
        return RequestStatus.PENDING, None
    if policy == "everyone_auto":
        return RequestStatus.APPROVED, "venue_everyone_auto"
    if policy == "team_auto" and is_whitelisted:
        return RequestStatus.APPROVED, "venue_whitelist"

    if venue.auto_approve_rating_threshold is not None:
        rating_count = int(worker.rating_count or 0)
        worker_rating = float(worker.aggregate_rating or 0.0)
        if rating_count > 0 and worker_rating >= float(venue.auto_approve_rating_threshold):
            return RequestStatus.APPROVED, "rating_threshold"

    return RequestStatus.PENDING, None


async def evaluate_shift_request(
    db: AsyncSession,
    worker: User,
    shift: Shift,
    venue: Venue
) -> Tuple[RequestStatus, Optional[str]]:
    """
    ShiftBoard Auto-Confirm Engine. Looks up the whitelist, asks decide_approval(),
    and runs the double-booking check when the answer is APPROVED.
    """
    whitelist_id = await db.scalar(
        select(VenueWhitelist.id).where(
            VenueWhitelist.venue_id == venue.id,
            VenueWhitelist.worker_id == worker.id,
            VenueWhitelist.is_active == True
        )
    )
    decision, source = decide_approval(shift, venue, worker, whitelist_id is not None)
    logger.info(
        f"[Auto-Confirm Engine] Worker {worker.id} / Shift {shift.id} ('{shift.title}') "
        f"at Venue {venue.id}: {decision.value} via {source or 'manager review'}"
    )
    if decision == RequestStatus.APPROVED:
        await check_double_booking(db, worker.id, shift.start_time, shift.end_time, exclude_shift_id=shift.id)
    return decision, source
```

---

## 2. Backend — NEW FILE `backend/src/services/booking.py`

This is the one place a worker gets put on a position. It holds:
* the one-per-event rule
* switching a waiting request
* re-requesting after a withdraw (the unique `(shift_id, worker_id)` row is re-opened, not duplicated)
* locking: `SELECT … FOR UPDATE` on the event row, then the position row
* the capacity check under the lock

```python
"""
Phase 26.1: The one place that puts a worker on a position.

Rules
* One active request per worker per event (waiting for approval OR booked).
  A waiting request can be switched to another position in the same event (switch=True).
  A booked worker must drop / hand off first.
* The event row and the position row are locked (SELECT ... FOR UPDATE) for the whole
  transaction, so a double tap or two workers at once can't overbook or double-request.
* A position can be requested again only after the worker WITHDREW it. Drops, rejections,
  removals, no-shows and hand-offs stay on record (they feed reliability).
"""
import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.models import Shift, ShiftEvent, ShiftRequest, User
from src.services.auto_confirm import evaluate_shift_request, check_double_booking

logger = logging.getLogger("shiftboard.booking")

PENDING_STATUSES = ("pending", "pending_manager_approval")
BOOKED_STATUSES = ("approved", "confirmed", "checked_in")
ASSIGNED_STATUSES = ("approved", "confirmed", "checked_in", "completed")
ACTIVE_STATUSES = PENDING_STATUSES + ASSIGNED_STATUSES
REREQUESTABLE_STATUSES = ("withdrawn",)
BLOCKED_MESSAGES = {
    "rejected": "The venue already passed on your request for this position. You can request a different position.",
    "removed": "The venue removed you from this shift.",
    "no_show": "You were marked as a no-show for this shift.",
    "cancelled": "This position was cancelled.",
    "dropped": "You dropped this shift earlier, so it can't be picked back up here. Message the manager if they still need you.",
    "transferred": "You handed this shift off earlier.",
}
NOTE_MAX = 500


def as_utc(dt: datetime) -> datetime:
    if isinstance(dt, str):
        dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _clean_note(note: Optional[str]) -> Optional[str]:
    if note is None:
        return None
    note = str(note).strip()
    return note[:NOTE_MAX] if note else None


async def _load_shift_locked(db: AsyncSession, shift_id: UUID) -> Shift:
    shift = await db.scalar(select(Shift).where(Shift.id == shift_id))
    if not shift:
        raise HTTPException(status_code=404, detail="Position not found.")
    if shift.event_id:
        # Lock the event first so every request for this event is handled one at a time.
        await db.execute(select(ShiftEvent.id).where(ShiftEvent.id == shift.event_id).with_for_update())
    locked = await db.scalar(
        select(Shift)
        .options(selectinload(Shift.venue))
        .where(Shift.id == shift_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return locked


async def request_position(
    db: AsyncSession,
    worker: User,
    shift_id: UUID,
    note: Optional[str] = None,
    switch: bool = False,
    expected_event_id: Optional[UUID] = None,
) -> UUID:
    """Creates (or re-opens a withdrawn) ShiftRequest. Commits. Returns the request id."""
    try:
        shift = await _load_shift_locked(db, shift_id)
        if expected_event_id is not None and shift.event_id != expected_event_id:
            raise HTTPException(status_code=400, detail="That position isn't part of this event.")

        if shift.event_id:
            event = await db.scalar(select(ShiftEvent).where(ShiftEvent.id == shift.event_id))
            if event is not None and event.cancelled_at is not None:
                raise HTTPException(status_code=400, detail="This event was cancelled.")

        shift_status = (shift.status or "").upper()
        if shift_status == "CANCELLED":
            raise HTTPException(status_code=400, detail="This position was cancelled.")
        if as_utc(shift.start_time) <= datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="This shift has already started.")

        # --- One active request per event -------------------------------------------------
        same_event_q = (
            select(ShiftRequest, Shift.role_type)
            .join(Shift, ShiftRequest.shift_id == Shift.id)
            .where(
                ShiftRequest.worker_id == worker.id,
                func.lower(ShiftRequest.status).in_(ACTIVE_STATUSES),
            )
        )
        if shift.event_id:
            same_event_q = same_event_q.where(Shift.event_id == shift.event_id)
        else:
            same_event_q = same_event_q.where(Shift.id == shift.id)

        replaced = None
        for req, role in (await db.execute(same_event_q)).all():
            st = (req.status or "").lower()
            if req.shift_id == shift.id:
                if st in PENDING_STATUSES:
                    raise HTTPException(status_code=400, detail="You've already requested this position.")
                raise HTTPException(status_code=400, detail="You're already booked on this position.")
            if st in PENDING_STATUSES:
                if not switch:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=f"You already requested {role} for this event. Switch your request instead.",
                    )
                replaced = req
            else:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"You're already booked as {role} for this event. Drop or hand off that shift before picking a different position.",
                )

        # --- Earlier history on this exact position ---------------------------------------
        existing = await db.scalar(
            select(ShiftRequest).where(
                ShiftRequest.shift_id == shift.id,
                ShiftRequest.worker_id == worker.id,
            )
        )
        if existing is not None:
            st = (existing.status or "").lower()
            if st in BLOCKED_MESSAGES:
                raise HTTPException(status_code=400, detail=BLOCKED_MESSAGES[st])
            if st not in REREQUESTABLE_STATUSES:
                raise HTTPException(status_code=400, detail=f"You already have this position (status: {st}).")

        # --- Capacity (checked under the lock) -------------------------------------------
        if shift_status != "OPEN" or (shift.spots_filled or 0) >= (shift.capacity or 1):
            raise HTTPException(status_code=400, detail="This position just filled up.")

        await check_double_booking(db, worker.id, shift.start_time, shift.end_time, exclude_shift_id=shift.id)

        decision, source = await evaluate_shift_request(db=db, worker=worker, shift=shift, venue=shift.venue)
        status_val = (decision.value if hasattr(decision, "value") else str(decision)).lower()
        now = datetime.now(timezone.utc)

        if replaced is not None:
            replaced.status = "withdrawn"
            replaced.status_reason = f"Switched to {shift.role_type}"

        if status_val == "approved":
            shift.spots_filled = (shift.spots_filled or 0) + 1
            if shift.spots_filled >= (shift.capacity or 1):
                shift.status = "FILLED"

        if existing is not None:
            req = existing
            req.status = status_val
            req.approval_source = source
            req.approved_by_user_id = None
            req.approved_at = now if status_val == "approved" else None
            req.check_in_time = None
            req.check_in_verified = False
            req.check_out_time = None
            req.check_out_verified = False
            req.dropped_at = None
            req.status_reason = None
            req.pay_rate = None
            req.notes = _clean_note(note)
            req.created_at = now
        else:
            req = ShiftRequest(
                shift_id=shift.id,
                worker_id=worker.id,
                status=status_val,
                approval_source=source,
                approved_at=now if status_val == "approved" else None,
                notes=_clean_note(note),
            )
            db.add(req)

        await db.flush()
        req_id = req.id          # read before commit (commit may expire attributes)
        await db.commit()
        return req_id
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.exception("request_position failed")
        raise HTTPException(status_code=500, detail=f"Could not request this position: {e}")


async def withdraw_request(db: AsyncSession, worker: User, request_id: UUID) -> Optional[UUID]:
    """Worker cancels their own WAITING request. Commits. Returns the event id (or None)."""
    try:
        row = (await db.execute(
            select(ShiftRequest, Shift.event_id)
            .join(Shift, ShiftRequest.shift_id == Shift.id)
            .where(ShiftRequest.id == request_id, ShiftRequest.worker_id == worker.id)
            .with_for_update(of=ShiftRequest)
        )).first()
        if row is None:
            raise HTTPException(status_code=404, detail="Request not found.")
        req, event_id = row
        if (req.status or "").lower() not in PENDING_STATUSES:
            raise HTTPException(
                status_code=400,
                detail="Only requests that are still waiting for approval can be withdrawn. Booked shifts can be dropped or handed off from My Schedule.",
            )
        req.status = "withdrawn"
        req.status_reason = None
        await db.commit()
        return event_id          # plain value from the query row, safe after commit
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.exception("withdraw_request failed")
        raise HTTPException(status_code=500, detail=f"Could not withdraw this request: {e}")


async def withdraw_other_pending_in_event(
    db: AsyncSession,
    worker_id: UUID,
    event_id: Optional[UUID],
    keep_shift_id: UUID,
    reason: str,
) -> int:
    """
    When a worker gets booked on one position, close their other WAITING requests in the same
    event. Does NOT commit (the caller's transaction does). Returns how many were closed.
    """
    if event_id is None:
        return 0
    rows = (await db.execute(
        select(ShiftRequest)
        .join(Shift, ShiftRequest.shift_id == Shift.id)
        .where(
            ShiftRequest.worker_id == worker_id,
            Shift.event_id == event_id,
            Shift.id != keep_shift_id,
            func.lower(ShiftRequest.status).in_(PENDING_STATUSES),
        )
    )).scalars().all()
    for r in rows:
        r.status = "withdrawn"
        r.status_reason = reason
    return len(rows)
```

**Re-request rules:**
* Only a **withdrawn** request can be re-opened.
* `dropped`, `rejected`, `removed`, `no_show`, `transferred` and `cancelled` stay on record, because reliability scoring depends on them. The worker gets a plain-English message instead.

---

## 3. Backend — NEW FILE `backend/src/services/listings.py`

```python
"""
Phase 26.1: Worker-facing event listings. One listing = one event with its positions.

* Never exposes other workers (only counts).
* Hidden pay stays hidden unless the viewer is booked on that position, manages the venue,
  or is an admin.
* `booking` tells THIS viewer whether a position books instantly or needs approval
  (same decision function the request endpoint uses).
"""
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import List, Optional
from uuid import UUID

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import ShiftEvent, Shift, ShiftRequest, Venue, VenueWhitelist, User, RequestStatus
from src.schemas import EventListing, ListingPosition, ListingVenue, ListingMyRequest
from src.services.auto_confirm import decide_approval
from src.services.shift_views import viewer_managed_venue_ids
from src.services.booking import (
    as_utc, ACTIVE_STATUSES, ASSIGNED_STATUSES, BOOKED_STATUSES, PENDING_STATUSES,
)

MAX_EVENTS = 200
WORKED_STATUSES = ("approved", "confirmed", "checked_in", "completed", "transferred")


def _f(v) -> Optional[float]:
    return float(v) if v is not None else None


async def build_listings(
    db: AsyncSession,
    user: User,
    *,
    venue_id: Optional[UUID] = None,
    days: int = 60,
    event_id: Optional[UUID] = None,
) -> List[EventListing]:
    """
    List mode (event_id None): upcoming, not-cancelled events in the next `days` days that have
    at least one open spot OR where the viewer has an active request.
    Single mode (event_id given): that event, whatever its state (used by the details modal).
    """
    now = datetime.now(timezone.utc)

    q = select(ShiftEvent)
    if event_id is not None:
        q = q.where(ShiftEvent.id == event_id)
    else:
        q = q.where(
            ShiftEvent.cancelled_at.is_(None),
            ShiftEvent.start_time > now,
            ShiftEvent.start_time <= now + timedelta(days=days),
        )
        if venue_id is not None:
            q = q.where(ShiftEvent.venue_id == venue_id)
        q = q.order_by(ShiftEvent.start_time.asc()).limit(MAX_EVENTS)
    events = (await db.execute(q)).scalars().all()
    if not events:
        return []

    event_ids = [e.id for e in events]
    venue_ids = {e.venue_id for e in events}

    shifts = (await db.execute(
        select(Shift)
        .where(Shift.event_id.in_(event_ids), func.upper(Shift.status) != "CANCELLED")
        .order_by(Shift.created_at.asc(), Shift.role_type.asc())
    )).scalars().all()
    shifts_by_event = defaultdict(list)
    for s in shifts:
        shifts_by_event[s.event_id].append(s)

    venues = {
        v.id: v for v in (await db.execute(select(Venue).where(Venue.id.in_(venue_ids)))).scalars().all()
    }

    # The viewer's own requests on these positions
    mine = {}
    if shifts:
        for r in (await db.execute(
            select(ShiftRequest).where(
                ShiftRequest.worker_id == user.id,
                ShiftRequest.shift_id.in_([s.id for s in shifts]),
            )
        )).scalars().all():
            mine[r.shift_id] = r

    whitelisted = set((await db.execute(
        select(VenueWhitelist.venue_id).where(
            VenueWhitelist.worker_id == user.id,
            VenueWhitelist.is_active == True,
            VenueWhitelist.venue_id.in_(venue_ids),
        )
    )).scalars().all())
    worked = set((await db.execute(
        select(Shift.venue_id)
        .join(ShiftRequest, ShiftRequest.shift_id == Shift.id)
        .where(
            ShiftRequest.worker_id == user.id,
            Shift.venue_id.in_(venue_ids),
            func.lower(ShiftRequest.status).in_(WORKED_STATUSES),
        )
        .distinct()
    )).scalars().all())

    managed = await viewer_managed_venue_ids(db, user)   # None = admin (sees all pay)

    # The viewer's booked shifts, for "overlaps your shift" warnings
    bookings = (await db.execute(
        select(Shift.event_id, Shift.title, Shift.start_time, Shift.end_time, Venue.name)
        .join(ShiftRequest, ShiftRequest.shift_id == Shift.id)
        .join(Venue, Venue.id == Shift.venue_id)
        .where(
            ShiftRequest.worker_id == user.id,
            func.lower(ShiftRequest.status).in_(BOOKED_STATUSES),
            Shift.end_time > now,
        )
    )).all()

    out: List[EventListing] = []
    for ev in events:
        venue = venues.get(ev.venue_id)
        if venue is None:
            continue
        ev_shifts = shifts_by_event.get(ev.id, [])
        start, end = as_utc(ev.start_time), as_utc(ev.end_time)
        hours = round(max(0.0, (end - start).total_seconds() / 3600.0), 2)
        can_see_all_pay = managed is None or venue.id in managed

        positions: List[ListingPosition] = []
        my_request: Optional[ListingMyRequest] = None
        for s in ev_shifts:
            r = mine.get(s.id)
            my_status = (r.status or "").lower() if r is not None else None
            if r is not None and my_status in ACTIVE_STATUSES:
                my_request = ListingMyRequest(
                    request_id=r.id, shift_id=s.id, role_type=s.role_type,
                    status=my_status, note=r.notes,
                )
            visible = (not s.hide_rate) or can_see_all_pay or (my_status in ASSIGNED_STATUSES)
            rate = _f(s.hourly_rate) if visible else None
            rate_max = _f(s.hourly_rate_max) if visible else None
            cap = s.capacity if s.capacity is not None else 1
            left = max(0, cap - (s.spots_filled or 0))
            is_open = (s.status or "").upper() == "OPEN" and left > 0
            decision, _src = decide_approval(s, venue, user, venue.id in whitelisted)
            positions.append(ListingPosition(
                shift_id=s.id,
                role_type=s.role_type or "Worker",
                role_notes=s.description,
                hourly_rate=rate,
                hourly_rate_max=rate_max,
                hide_rate=bool(s.hide_rate),
                tips_eligible=bool(s.tips_eligible),
                tip_pool=bool(s.tip_pool),
                capacity=cap,
                spots_left=left,
                status="OPEN" if is_open else "FILLED",
                booking="instant" if decision == RequestStatus.APPROVED else "approval",
                est_pay_min=round(rate * hours, 2) if rate is not None else None,
                est_pay_max=round((rate_max or rate) * hours, 2) if rate is not None else None,
                my_status=my_status,
                my_status_reason=r.status_reason if r is not None else None,
            ))

        open_positions = [p for p in positions if p.status == "OPEN"]
        if event_id is None and not open_positions and my_request is None:
            continue   # list mode: nothing to request and nothing of mine here

        conflict = None
        if my_request is None or my_request.status not in ASSIGNED_STATUSES:
            for b_event_id, b_title, b_start, b_end, b_venue in bookings:
                if b_event_id == ev.id:
                    continue
                if as_utc(b_start) < end and as_utc(b_end) > start:
                    conflict = f"{b_venue} · {b_title}"
                    break

        priced = [p for p in positions if p.hourly_rate is not None]
        started = start <= now
        cancelled = ev.cancelled_at is not None
        can_request = (
            not cancelled
            and not started
            and bool(open_positions)
            and conflict is None
            and (my_request is None or my_request.status in PENDING_STATUSES)
        )

        out.append(EventListing(
            event_id=ev.id,
            title=ev.title,
            notes=ev.notes,
            start_time=ev.start_time,
            end_time=ev.end_time,
            hours=hours,
            venue=ListingVenue(
                id=venue.id,
                name=venue.name,
                address=venue.address,
                timezone=venue.timezone or "America/New_York",
                logo_url=venue.logo_url,
                phone=venue.phone,
                lat=_f(venue.lat),
                lng=_f(venue.lng),
                dress_code=venue.dress_code,
                arrival_instructions=venue.arrival_instructions,
                default_shift_notes=venue.default_shift_notes,
            ),
            positions=positions,
            total_capacity=sum(p.capacity for p in positions),
            total_spots_left=sum(p.spots_left for p in open_positions),
            open_positions=len(open_positions),
            pay_min=min((p.hourly_rate for p in priced), default=None),
            pay_max=max(((p.hourly_rate_max or p.hourly_rate) for p in priced), default=None),
            any_tips=any(p.tips_eligible for p in positions),
            any_instant=any(p.booking == "instant" for p in open_positions),
            on_team=(venue.id in whitelisted) or (venue.id in worked),
            my_request=my_request,
            conflict=conflict,
            cancelled=cancelled,
            cancel_reason=ev.cancel_reason,
            started=started,
            can_request=can_request,
        ))
    return out
```

---

## 4. Backend — `backend/src/schemas.py` (EDITS)

### 4a. Append this block at the very END of the file
```python
# ------------------------------------------------------------------------------
# Phase 26.1: Worker event listings (one card per event)
# ------------------------------------------------------------------------------
class ListingVenue(BaseModel):
    id: UUID
    name: str
    address: Optional[str] = None
    timezone: str = "America/New_York"
    logo_url: Optional[str] = None
    phone: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    dress_code: Optional[str] = None
    arrival_instructions: Optional[str] = None
    default_shift_notes: Optional[str] = None


class ListingPosition(BaseModel):
    shift_id: UUID
    role_type: str
    role_notes: Optional[str] = None
    hourly_rate: Optional[float] = None        # None = hidden from this viewer
    hourly_rate_max: Optional[float] = None
    hide_rate: bool = False
    tips_eligible: bool = False
    tip_pool: bool = False
    capacity: int
    spots_left: int
    status: str                                # OPEN | FILLED
    booking: str                               # instant | approval  (for THIS viewer)
    est_pay_min: Optional[float] = None        # hours x rate, None when pay is hidden
    est_pay_max: Optional[float] = None
    my_status: Optional[str] = None            # viewer's request status on this position
    my_status_reason: Optional[str] = None


class ListingMyRequest(BaseModel):
    request_id: UUID
    shift_id: UUID
    role_type: str
    status: str
    note: Optional[str] = None


class EventListing(BaseModel):
    event_id: UUID
    title: str
    notes: Optional[str] = None
    start_time: datetime
    end_time: datetime
    hours: float
    venue: ListingVenue
    positions: List[ListingPosition]
    total_capacity: int
    total_spots_left: int
    open_positions: int
    pay_min: Optional[float] = None
    pay_max: Optional[float] = None
    any_tips: bool = False
    any_instant: bool = False
    on_team: bool = False
    my_request: Optional[ListingMyRequest] = None     # the viewer's ACTIVE request in this event
    conflict: Optional[str] = None                    # "Blue Bar · Friday Service" when it overlaps a booked shift
    cancelled: bool = False
    cancel_reason: Optional[str] = None
    started: bool = False
    can_request: bool = True


class PositionRequestBody(BaseModel):
    shift_id: UUID
    note: Optional[str] = Field(None, max_length=500)
    switch: bool = False


class PositionRequestResult(BaseModel):
    request_id: UUID
    status: str
    instant: bool
    message: str
    listing: Optional[EventListing] = None
```
(`Field` is already imported at the top of `schemas.py`: `from pydantic import BaseModel, EmailStr, Field`.)

### 4b. `class ShiftRequestResponse` — add one field
Find:
```python
    status_reason: Optional[str] = None
    pay_rate: Optional[float] = None
    shift: Optional[ShiftResponse] = None
```
Replace with:
```python
    status_reason: Optional[str] = None
    pay_rate: Optional[float] = None
    notes: Optional[str] = None         # Phase 26.1: the worker's note with the request
    shift: Optional[ShiftResponse] = None
```

### 4c. `class RosterPerson` — add one field at the end
Find:
```python
    clocked_in: bool = False
    clocked_out: bool = False


class EventPosition(BaseModel):
```
Replace with:
```python
    clocked_in: bool = False
    clocked_out: bool = False
    note: Optional[str] = None          # Phase 26.1: worker's note with their request


class EventPosition(BaseModel):
```

### 4d. `class PublicVenueEvent` — add `event_id`
Find:
```python
class PublicVenueEvent(BaseModel):
    event_key: str
```
Replace with:
```python
class PublicVenueEvent(BaseModel):
    event_key: str
    event_id: Optional[UUID] = None     # Phase 26.1: opens the worker listing modal
```

---

## 5. Backend — NEW FILE `backend/src/routers/listings.py`

| Method | URL | Auth | Purpose |
|---|---|---|---|
| GET | `/api/listings?venue_id=&days=60` | any logged-in user | Upcoming events with open spots, or with the viewer's active request |
| GET | `/api/listings/{event_id}` | any logged-in user | One event in any state (for the modal) |
| POST | `/api/listings/{event_id}/request` | `require_worker` (worker + platform_admin) | Body `{shift_id, note?, switch?}` → `PositionRequestResult` |
| POST | `/api/listings/requests/{request_id}/withdraw` | `require_worker` | Withdraw own **waiting** request → `PositionRequestResult` |

Error codes:
* **409** when the worker already has a request in the event (waiting without `switch`, or booked).
* **400** for full, started, cancelled or blocked positions.
* **404** when not found.

`request_position` and `withdraw_request` do their own `try/except` with `await db.rollback()`.

```python
"""
Phase 26.1: Worker "Find Shifts" — one listing per event, one request per event.
"""
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import User, ShiftRequest
from src.schemas import EventListing, PositionRequestBody, PositionRequestResult
from src.auth import get_current_user, require_worker
from src.services.listings import build_listings
from src.services.booking import request_position, withdraw_request

router = APIRouter(prefix="/api/listings", tags=["Listings"])


@router.get("", response_model=List[EventListing])
async def list_open_events(
    venue_id: Optional[UUID] = Query(None, description="Only this venue"),
    days: int = Query(60, ge=1, le=180, description="How far ahead to look"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upcoming events with open spots (or with the viewer's active request), soonest first."""
    return await build_listings(db, current_user, venue_id=venue_id, days=days)


@router.get("/{event_id}", response_model=EventListing)
async def get_event_listing(
    event_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """One event for the details modal, in any state (full, started, cancelled)."""
    rows = await build_listings(db, current_user, event_id=event_id)
    if not rows:
        raise HTTPException(status_code=404, detail="Event not found.")
    return rows[0]


@router.post("/{event_id}/request", response_model=PositionRequestResult, status_code=status.HTTP_201_CREATED)
async def request_event_position(
    event_id: UUID,
    body: PositionRequestBody,
    current_user: User = Depends(require_worker),
    db: AsyncSession = Depends(get_db),
):
    """
    Request one position in this event. switch=true replaces the worker's WAITING request
    for another position in the same event. request_position() commits or rolls back.
    """
    request_id = await request_position(
        db, current_user, body.shift_id,
        note=body.note, switch=body.switch, expected_event_id=event_id,
    )
    await db.refresh(current_user)
    req_status = (await db.scalar(select(ShiftRequest.status).where(ShiftRequest.id == request_id)) or "").lower()
    instant = req_status in ("approved", "confirmed")
    rows = await build_listings(db, current_user, event_id=event_id)
    return PositionRequestResult(
        request_id=request_id,
        status=req_status,
        instant=instant,
        message="You're booked! It's on your schedule." if instant else "Request sent. The manager will review it.",
        listing=rows[0] if rows else None,
    )


@router.post("/requests/{request_id}/withdraw", response_model=PositionRequestResult)
async def withdraw_my_request(
    request_id: UUID,
    current_user: User = Depends(require_worker),
    db: AsyncSession = Depends(get_db),
):
    """Worker withdraws their own request that is still waiting for approval."""
    event_id = await withdraw_request(db, current_user, request_id)
    await db.refresh(current_user)
    rows = await build_listings(db, current_user, event_id=event_id) if event_id else []
    return PositionRequestResult(
        request_id=request_id,
        status="withdrawn",
        instant=False,
        message="Request withdrawn.",
        listing=rows[0] if rows else None,
    )
```

---

## 6. Backend — `backend/src/main.py` (EDIT)

Add the import directly under the timesheets import:
```python
from src.routers.timesheets import router as timesheets_router
from src.routers.listings import router as listings_router
```
Add the include directly under `app.include_router(timesheets_router)`:
```python
app.include_router(timesheets_router)
app.include_router(listings_router)
```
Change nothing else in `main.py`.

---

## 7. Backend — `backend/src/routers/shifts.py` (EDITS)

### 7a. Imports
Directly under `from src.services.shift_views import to_shift_responses` add:
```python
from src.services.booking import request_position, withdraw_other_pending_in_event
```
(Leave the existing `evaluate_shift_request, check_double_booking` import as it is.)

### 7b. `request_shift` (the `POST /{shift_id}/request` endpoint)
Keep the decorator, signature and docstring. **Replace the entire function body after the docstring** (from the line `    # 1. Fetch shift with its venue` down to and including the final `    return resp` of this function) with:
```python
    # Phase 26.1: all booking rules (one request per event, locking, re-request rules) live in
    # services/booking.request_position. This legacy endpoint is kept for older screens.
    request_id = await request_position(db, current_user, shift_id)
    await db.refresh(current_user)

    res = await db.execute(
        select(ShiftRequest)
        .options(
            selectinload(ShiftRequest.shift).selectinload(Shift.venue),
            selectinload(ShiftRequest.worker)
        )
        .where(ShiftRequest.id == request_id)
    )
    req_obj = res.scalar_one()
    status_val = (req_obj.status or "").lower()
    resp = ShiftRequestResponse.model_validate(req_obj)
    if req_obj.shift is not None:
        shown = await to_shift_responses(
            db, [req_obj.shift], current_user,
            reveal_shift_ids={req_obj.shift_id} if status_val == "approved" else set(),
        )
        resp.shift = shown[0]
    return resp
```

### 7c. `update_shift_request_status` — close other waiting requests when a manager approves
Find (inside the `if target_clean == "approved" and prev_status != "approved":` branch):
```python
        shift_req.approved_by_user_id = current_user.id
        shift_req.approved_at = datetime.utcnow()
```
Replace with:
```python
        shift_req.approved_by_user_id = current_user.id
        shift_req.approved_at = datetime.utcnow()
        # Phase 26.1: booked on this position -> close their other waiting requests in the event
        await withdraw_other_pending_in_event(
            db, shift_req.worker_id, shift.event_id, shift.id,
            "Booked on another position for this event",
        )
```

---

## 8. Backend — `backend/src/routers/transfers.py` (EDITS)

### 8a. Import
Directly under `from src.services.auto_confirm import check_double_booking` add:
```python
from src.services.booking import withdraw_other_pending_in_event
```

### 8b. Manager approves a transfer
In the manager review endpoint, find the end of the "create or update ShiftRequest for to_worker_id" block:
```python
                approved_at=datetime.now(timezone.utc)
            )
            db.add(to_req)
```
Replace with (same indentation. The new call sits **after** the `if to_req: … else: …` block, still inside `if action == "approve":`):
```python
                approved_at=datetime.now(timezone.utc)
            )
            db.add(to_req)
        # Phase 26.1: the new holder's other waiting requests in this event are closed
        await withdraw_other_pending_in_event(
            db, transfer.to_worker_id, shift.event_id, shift.id,
            "Took over a handed-off shift for this event",
        )
```

---

## 9. Backend — `backend/src/routers/venues.py` (EDIT)

In `get_venue_events`, the `RosterPerson(...)` constructor: find
```python
            clocked_out=clocked_out or req.check_out_time is not None,
        )
        if person.status in ASSIGNED_STATUSES:
```
Replace with:
```python
            clocked_out=clocked_out or req.check_out_time is not None,
            note=req.notes,
        )
        if person.status in ASSIGNED_STATUSES:
```

---

## 10. Backend — `backend/src/services/venue_public.py` (EDIT)

In `build_public_events`, find:
```python
            events[key] = {
                "event_key": key,
```
Replace with:
```python
            events[key] = {
                "event_key": key,
                "event_id": s.event_id,
```

---

## 11. Frontend — NEW FILE `frontend/src/utils/listingFormat.js`

```javascript
/**
 * Phase 26.1: Small helpers for worker event listings (Find Shifts cards + details modal).
 */
import { dayKey, fmtDate } from './venueTime';

export const PENDING_STATUSES = ['pending', 'pending_manager_approval'];
export const BOOKED_STATUSES = ['approved', 'confirmed', 'checked_in'];
export const ACTIVE_STATUSES = [...PENDING_STATUSES, ...BOOKED_STATUSES, 'completed'];

/** Friendly words for every request status a worker can see. */
export const STATUS_LABELS = {
  pending: 'Waiting for approval',
  pending_manager_approval: 'Waiting for approval',
  approved: 'Confirmed',
  confirmed: 'Confirmed',
  checked_in: 'Clocked in',
  completed: 'Completed',
  rejected: 'Not selected',
  dropped: 'Released',
  transferred: 'Handed off',
  cancelled: 'Cancelled by venue',
  removed: 'Removed by manager',
  no_show: 'Marked no-show',
  withdrawn: 'Withdrawn',
};

const money = (n) => {
  const v = Number(n);
  if (Number.isNaN(v)) return '';
  return Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`;
};
const wholeMoney = (n) => `$${Math.round(Number(n)).toLocaleString()}`;

/** "5 hrs", "5.5 hrs", "1 hr" */
export function hoursText(hours) {
  const h = Math.round(Number(hours || 0) * 10) / 10;
  return `${h} ${h === 1 ? 'hr' : 'hrs'}`;
}

/** Headline pay for a card: "$28–$35/hr", "$30/hr" or null when every rate is hidden. */
export function listingPayText(listing) {
  if (listing?.pay_min === null || listing?.pay_min === undefined) return null;
  const lo = Number(listing.pay_min);
  const hi = listing.pay_max === null || listing.pay_max === undefined ? lo : Number(listing.pay_max);
  return hi > lo ? `${money(lo)}–${money(hi)}/hr` : `${money(lo)}/hr`;
}

/** "≈ $140" or "≈ $140–$175" for one position, or null when pay is hidden. */
export function estPayText(position) {
  if (position?.est_pay_min === null || position?.est_pay_min === undefined) return null;
  const lo = Number(position.est_pay_min);
  const hi = position.est_pay_max === null || position.est_pay_max === undefined ? lo : Number(position.est_pay_max);
  return hi > lo ? `≈ ${wholeMoney(lo)}–${wholeMoney(hi)}` : `≈ ${wholeMoney(lo)}`;
}

/** Day group heading in the venue's timezone: "Today", "Tomorrow" or "Fri, Oct 3". */
export function dayGroupLabel(value, tz) {
  const k = dayKey(value, tz);
  if (k === dayKey(new Date(), tz)) return 'Today';
  if (k === dayKey(new Date(Date.now() + 86400000), tz)) return 'Tomorrow';
  return fmtDate(value, tz);
}

/** True when the event starts on the venue-local "today" / "tomorrow". */
export function isOnDay(value, tz, offsetDays) {
  return dayKey(value, tz) === dayKey(new Date(Date.now() + offsetDays * 86400000), tz);
}

export function mapsUrl(venue) {
  if (!venue) return '#';
  const q = venue.address || (venue.lat && venue.lng ? `${venue.lat},${venue.lng}` : venue.name);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q || '')}`;
}

function icsStamp(value) {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsEscape(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/** Download a one-event .ics file (works with Google, Apple and Outlook calendars). */
export function downloadIcs({ uid, title, start, end, location, description }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ShiftBoard//Shift//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid || `${icsStamp(start)}@shiftboard`}`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsEscape(title)}`,
    location ? `LOCATION:${icsEscape(location)}` : null,
    description ? `DESCRIPTION:${icsEscape(description)}` : null,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${String(title || 'shift').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

---

## 12. Frontend — NEW FILE `frontend/src/components/EventListingCard.jsx`

The whole card is clickable (a `div role="button"`, keyboard accessible). It contains **no** links or buttons inside, because nested interactive elements are invalid.

```jsx
import React from 'react';
import { Clock, MapPin, Zap, ShieldCheck, Users, ChevronRight, AlertTriangle, Star } from 'lucide-react';
import PayLabel from './PayLabel';
import { fmtTimeRange } from '../utils/venueTime';
import {
  hoursText, listingPayText, estPayText, STATUS_LABELS, PENDING_STATUSES, BOOKED_STATUSES,
} from '../utils/listingFormat';

const MAX_ROWS = 4;

function dateParts(value, tz) {
  const d = new Date(value);
  const make = (opts) => {
    try {
      return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz || undefined }).format(d);
    } catch (e) {
      return new Intl.DateTimeFormat('en-US', opts).format(d);
    }
  };
  return { month: make({ month: 'short' }).toUpperCase(), day: make({ day: 'numeric' }), weekday: make({ weekday: 'short' }) };
}

export function MyRequestPill({ status, role }) {
  if (!status) return null;
  const s = String(status).toLowerCase();
  const booked = BOOKED_STATUSES.includes(s) || s === 'completed';
  const waiting = PENDING_STATUSES.includes(s);
  const cls = booked
    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
    : waiting
    ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
    : 'bg-slate-800 text-slate-400 border-slate-700';
  const text = booked ? `Booked · ${role}` : waiting ? `Requested · ${role}` : STATUS_LABELS[s] || s;
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold border whitespace-nowrap ${cls}`}>
      {text}
    </span>
  );
}

/**
 * Phase 26.1: One card per event on the worker's Find Shifts tab.
 * The whole card opens the details modal (onOpen).
 */
export default function EventListingCard({ listing, onOpen }) {
  const tz = listing.venue?.timezone;
  const { month, day, weekday } = dateParts(listing.start_time, tz);
  const pay = listingPayText(listing);
  const rows = listing.positions.slice(0, MAX_ROWS);
  const extra = listing.positions.length - rows.length;
  const mine = listing.my_request;

  const open = () => onOpen && onOpen(listing);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      className="group bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl cursor-pointer transition hover:border-emerald-600/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/60 flex flex-col"
    >
      {/* Header: date tile + title + my status */}
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-14 rounded-xl bg-slate-950 border border-slate-800 text-center py-1.5">
          <div className="text-[10px] font-bold text-emerald-400 tracking-wider">{month}</div>
          <div className="text-xl font-black text-white leading-none">{day}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">{weekday}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-base font-bold text-white leading-snug line-clamp-2">{listing.title}</h3>
            {mine && <MyRequestPill status={mine.status} role={mine.role_type} />}
          </div>
          <p className="text-xs font-semibold text-slate-300 mt-0.5 flex items-center gap-1.5">
            <span className="truncate">{listing.venue?.name}</span>
            {listing.on_team && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 text-[10px] font-bold whitespace-nowrap">
                <Star className="w-2.5 h-2.5" /> Your venue
              </span>
            )}
          </p>
          {listing.venue?.address && (
            <p className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
              <MapPin className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{listing.venue.address}</span>
            </p>
          )}
        </div>
      </div>

      {/* Time + pay */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-slate-300 inline-flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-emerald-400" />
          {fmtTimeRange(listing.start_time, listing.end_time, tz)}
          <span className="text-slate-500">· {hoursText(listing.hours)}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          {pay ? (
            <span className="text-base font-black text-emerald-400">{pay}</span>
          ) : (
            <span className="text-xs italic text-slate-400">Pay shared when booked</span>
          )}
          {listing.any_tips && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
              + Tips
            </span>
          )}
        </span>
      </div>

      {/* Positions */}
      <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/60 divide-y divide-slate-800/70">
        {rows.map((p) => {
          const full = p.status !== 'OPEN';
          const est = estPayText(p);
          return (
            <div key={p.shift_id} className={`px-3 py-2 flex items-center justify-between gap-2 ${full ? 'opacity-50' : ''}`}>
              <div className="min-w-0 flex items-center gap-1.5">
                {p.booking === 'instant' && !full ? (
                  <Zap className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" title="Instant book" />
                ) : (
                  <ShieldCheck className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" title="Needs approval" />
                )}
                <span className="text-xs font-bold text-slate-100 truncate">{p.role_type}</span>
                {p.my_status && <span className="text-[10px] text-amber-300">• you</span>}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 text-[11px]">
                <PayLabel rate={p.hourly_rate} rateMax={p.hourly_rate_max} className="text-slate-200 font-semibold" hiddenText="—" />
                {est && <span className="hidden sm:inline text-slate-500">{est}</span>}
                <span className={`font-semibold ${full ? 'text-slate-500' : 'text-emerald-300'}`}>
                  {full ? 'Full' : `${p.spots_left} open`}
                </span>
              </div>
            </div>
          );
        })}
        {extra > 0 && (
          <div className="px-3 py-1.5 text-[11px] text-slate-400">+{extra} more position{extra === 1 ? '' : 's'}</div>
        )}
      </div>

      {listing.conflict && (
        <p className="mt-2 text-[11px] text-amber-300 flex items-center gap-1">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">Overlaps your shift: {listing.conflict}</span>
        </p>
      )}

      {/* Footer */}
      <div className="mt-auto pt-3 flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-400 inline-flex items-center gap-1">
          <Users className="w-3.5 h-3.5" />
          {listing.total_spots_left > 0
            ? `${listing.total_spots_left} spot${listing.total_spots_left === 1 ? '' : 's'} open`
            : 'Fully staffed'}
          {listing.any_instant && <span className="text-emerald-400 font-semibold"> · Instant book</span>}
        </span>
        <span className="text-xs font-bold text-emerald-400 inline-flex items-center gap-0.5 group-hover:gap-1.5 transition-all">
          {mine ? 'View details' : 'View & request'}
          <ChevronRight className="w-4 h-4" />
        </span>
      </div>
    </div>
  );
}
```

---

## 13. Frontend — NEW FILE `frontend/src/components/EventListingModal.jsx`

Uses the shared `ModalShell` (z-[60], scrolling backdrop, Esc closes the top modal only). It is two columns on desktop and stacked on phones.

The primary button changes with the situation:
* **Book instantly** or **Send request** for a new request
* **Switch to X** when the worker already has a waiting request in this event
* **Withdraw request** for their own waiting position
* **Add to calendar** and **Go to My Schedule** when they're booked

```jsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar, Clock, MapPin, Phone, Shirt, Info, StickyNote, Navigation, CalendarPlus,
  Zap, ShieldCheck, AlertTriangle, CheckCircle2, ExternalLink, Briefcase,
} from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import PayLabel from './PayLabel';
import TipBadge from './TipBadge';
import { fmtLongDate, fmtTimeRange } from '../utils/venueTime';
import {
  hoursText, estPayText, mapsUrl, downloadIcs, STATUS_LABELS, PENDING_STATUSES,
} from '../utils/listingFormat';

// Statuses on a position that the server will refuse to re-open.
const LOCKED_POSITION_STATUSES = ['rejected', 'removed', 'no_show', 'dropped', 'transferred', 'cancelled'];

function pickDefault(listing, prev) {
  if (!listing) return null;
  if (prev && listing.positions.some((p) => p.shift_id === prev)) return prev;
  if (listing.my_request) return listing.my_request.shift_id;
  const open = listing.positions.filter((p) => p.status === 'OPEN');
  return open.length === 1 ? open[0].shift_id : null;
}

function InfoBlock({ icon: Icon, label, children }) {
  if (!children) return null;
  return (
    <div className="flex gap-2.5">
      <Icon className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
        <div className="text-xs text-slate-200 whitespace-pre-line break-words">{children}</div>
      </div>
    </div>
  );
}

/**
 * Phase 26.1: Event details + request flow for workers.
 * Props:
 *   eventId         (required) event to show; always re-fetched from GET /api/listings/{eventId}
 *   initial         optional listing object from the card list (shown instantly while loading)
 *   onClose()       close the modal
 *   onChanged(res)  called after a successful request / switch / withdraw (parent refreshes lists)
 *   onGoToSchedule() optional; shows a "Go to My Schedule" button when the worker is booked
 */
export default function EventListingModal({ eventId, initial = null, onClose, onChanged, onGoToSchedule }) {
  const [listing, setListing] = useState(initial);
  const [loading, setLoading] = useState(!initial);
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState(() => pickDefault(initial, null));
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // { type: 'success' | 'info' | 'error', message }

  const applyListing = (next, resetSelection = false) => {
    setListing(next);
    setSelectedId((prev) => pickDefault(next, resetSelection ? null : prev));
  };

  const reload = async (resetSelection = false) => {
    try {
      const res = await api.get(`/listings/${eventId}`);
      applyListing(res.data, resetSelection);
      setLoadError('');
    } catch (err) {
      setLoadError(err.response?.data?.detail || 'Could not load this event.');
    }
  };

  useEffect(() => {
    let alive = true;
    setLoading(!initial);
    api
      .get(`/listings/${eventId}`)
      .then((res) => {
        if (alive) applyListing(res.data, false);
      })
      .catch((err) => {
        if (alive) setLoadError(err.response?.data?.detail || 'Could not load this event.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const sendRequest = async (isSwitch) => {
    if (!selectedId) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await api.post(`/listings/${eventId}/request`, {
        shift_id: selectedId,
        note: note.trim() ? note.trim() : null,
        switch: Boolean(isSwitch),
      });
      setResult({ type: res.data.instant ? 'success' : 'info', message: res.data.message });
      if (res.data.listing) applyListing(res.data.listing, true);
      setNote('');
      if (onChanged) onChanged(res.data);
    } catch (err) {
      setResult({ type: 'error', message: err.response?.data?.detail || 'Could not send your request.' });
      reload(false);
    } finally {
      setSubmitting(false);
    }
  };

  const withdraw = async () => {
    if (!listing?.my_request) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await api.post(`/listings/requests/${listing.my_request.request_id}/withdraw`);
      setResult({ type: 'info', message: res.data.message });
      if (res.data.listing) applyListing(res.data.listing, true);
      if (onChanged) onChanged(res.data);
    } catch (err) {
      setResult({ type: 'error', message: err.response?.data?.detail || 'Could not withdraw your request.' });
      reload(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (!listing) {
    return (
      <ModalShell title="Shift details" onClose={onClose} maxWidth="max-w-md">
        <p className="text-sm text-center py-10 text-slate-400">
          {loading ? 'Loading…' : loadError || 'Event not found.'}
        </p>
      </ModalShell>
    );
  }

  const tz = listing.venue?.timezone;
  const mine = listing.my_request;
  const mineStatus = mine ? String(mine.status).toLowerCase() : null;
  const isWaiting = mine && PENDING_STATUSES.includes(mineStatus);
  const isBooked = mine && !isWaiting;
  const selected = listing.positions.find((p) => p.shift_id === selectedId) || null;
  const selectedIsMine = selected && mine && selected.shift_id === mine.shift_id;
  const bookedPosition = isBooked ? listing.positions.find((p) => p.shift_id === mine.shift_id) : null;

  const addToCalendar = () =>
    downloadIcs({
      uid: `${listing.event_id}@shiftboard`,
      title: `${listing.title} — ${mine?.role_type || 'Shift'} (${listing.venue?.name || ''})`,
      start: listing.start_time,
      end: listing.end_time,
      location: listing.venue?.address,
      description: [listing.notes, listing.venue?.arrival_instructions, listing.venue?.dress_code && `Dress code: ${listing.venue.dress_code}`]
        .filter(Boolean)
        .join('\n\n'),
    });

  // ---- Footer actions --------------------------------------------------------------------
  let primary = null;
  let secondary = null;
  let blockedReason = null;
  if (listing.cancelled) {
    blockedReason = `This event was cancelled${listing.cancel_reason ? `: ${listing.cancel_reason}` : '.'}`;
  } else if (isBooked) {
    secondary = (
      <button type="button" onClick={addToCalendar} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5">
        <CalendarPlus className="w-4 h-4 text-emerald-400" /> Add to calendar
      </button>
    );
    if (onGoToSchedule) {
      primary = (
        <button type="button" onClick={onGoToSchedule} className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold">
          Go to My Schedule
        </button>
      );
    }
  } else if (listing.started) {
    blockedReason = 'This shift has already started.';
  } else {
    if (isWaiting) {
      secondary = (
        <button type="button" onClick={withdraw} disabled={submitting} className="px-4 py-2 rounded-xl border border-rose-500/50 text-rose-300 hover:bg-rose-500/10 text-xs font-semibold disabled:opacity-50">
          Withdraw request
        </button>
      );
    }
    if (listing.conflict) {
      blockedReason = `This overlaps a shift you're booked on (${listing.conflict}).`;
    } else if (!selected) {
      primary = (
        <button type="button" disabled className="px-5 py-2 rounded-xl bg-slate-800 text-slate-500 text-xs font-bold cursor-not-allowed">
          Pick a position
        </button>
      );
    } else if (!selectedIsMine) {
      const label = isWaiting
        ? `Switch to ${selected.role_type}`
        : selected.booking === 'instant'
        ? 'Book instantly'
        : 'Send request';
      primary = (
        <button
          type="button"
          onClick={() => sendRequest(isWaiting)}
          disabled={submitting || !listing.can_request || selected.status !== 'OPEN'}
          className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold shadow-md shadow-emerald-500/20 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {selected.booking === 'instant' && <Zap className="w-4 h-4" />}
          {submitting ? 'Sending…' : label}
        </button>
      );
    }
  }

  const footer = (
    <>
      <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 mr-auto">
        Close
      </button>
      {secondary}
      {primary}
    </>
  );

  const showNoteBox = !isBooked && !listing.cancelled && !listing.started && !listing.conflict && selected && !selectedIsMine;

  return (
    <ModalShell
      title={listing.title}
      subtitle={
        <span>
          {listing.venue?.name} · {fmtLongDate(listing.start_time, tz)}
        </span>
      }
      icon={<Briefcase className="w-5 h-5 text-emerald-400" />}
      onClose={onClose}
      maxWidth="max-w-4xl"
      footer={footer}
    >
      {result && (
        <div
          className={`mb-4 p-3 rounded-xl border text-sm flex items-start gap-2 ${
            result.type === 'success'
              ? 'bg-emerald-950/70 border-emerald-700 text-emerald-200'
              : result.type === 'error'
              ? 'bg-rose-950/70 border-rose-700 text-rose-200'
              : 'bg-indigo-950/70 border-indigo-700 text-indigo-200'
          }`}
        >
          {result.type === 'success' ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />}
          <span>{result.message}</span>
        </div>
      )}

      {blockedReason && (
        <div className="mb-4 p-3 rounded-xl border border-amber-700/60 bg-amber-950/40 text-amber-200 text-xs flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{blockedReason}</span>
        </div>
      )}

      {isBooked && (
        <div className="mb-4 p-3 rounded-xl border border-emerald-700/60 bg-emerald-950/40 text-emerald-200 text-sm">
          <div className="font-bold flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" /> You're booked as {mine.role_type}
          </div>
          <p className="text-xs text-emerald-300/80 mt-1">
            To change position, drop or hand off this shift from My Schedule first.
            {bookedPosition && bookedPosition.hourly_rate !== null && (
              <> Pay: <PayLabel rate={bookedPosition.hourly_rate} rateMax={bookedPosition.hourly_rate_max} className="font-semibold" /></>
            )}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-5 gap-5">
        {/* LEFT: event + venue info */}
        <div className="md:col-span-2 space-y-4">
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
            <InfoBlock icon={Calendar} label="When">
              {fmtLongDate(listing.start_time, tz)}
            </InfoBlock>
            <InfoBlock icon={Clock} label="Hours">
              {fmtTimeRange(listing.start_time, listing.end_time, tz)} · {hoursText(listing.hours)}
            </InfoBlock>
            <InfoBlock icon={MapPin} label="Where">
              <span className="font-semibold">{listing.venue?.name}</span>
              {listing.venue?.address ? `\n${listing.venue.address}` : ''}
            </InfoBlock>
            <div className="flex flex-wrap gap-2 pl-6">
              <a
                href={mapsUrl(listing.venue)}
                target="_blank"
                rel="noreferrer"
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 inline-flex items-center gap-1"
              >
                <Navigation className="w-3 h-3 text-emerald-400" /> Directions
              </a>
              <Link
                to={`/venues/${listing.venue?.id}`}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 inline-flex items-center gap-1"
              >
                <ExternalLink className="w-3 h-3 text-emerald-400" /> Venue profile
              </Link>
            </div>
            {listing.venue?.phone && (
              <InfoBlock icon={Phone} label="Venue phone">
                <a href={`tel:${listing.venue.phone}`} className="underline decoration-slate-600">{listing.venue.phone}</a>
              </InfoBlock>
            )}
          </div>

          {(listing.notes || listing.venue?.default_shift_notes || listing.venue?.dress_code || listing.venue?.arrival_instructions) && (
            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
              <InfoBlock icon={StickyNote} label="About this event">{listing.notes}</InfoBlock>
              <InfoBlock icon={Shirt} label="Dress code">{listing.venue?.dress_code}</InfoBlock>
              <InfoBlock icon={MapPin} label="When you arrive">{listing.venue?.arrival_instructions}</InfoBlock>
              <InfoBlock icon={Info} label="Venue notes">{listing.venue?.default_shift_notes}</InfoBlock>
            </div>
          )}
        </div>

        {/* RIGHT: positions */}
        <div className="md:col-span-3 space-y-3">
          <div className="flex items-baseline justify-between">
            <h4 className="text-sm font-bold text-white">Positions</h4>
            <span className="text-[11px] text-slate-400">You can request one position per event</span>
          </div>

          <div className="space-y-2" role="radiogroup" aria-label="Positions">
            {listing.positions.map((p) => {
              const full = p.status !== 'OPEN';
              const ps = p.my_status ? String(p.my_status).toLowerCase() : null;
              const isMine = mine && mine.shift_id === p.shift_id;
              const locked = LOCKED_POSITION_STATUSES.includes(ps);
              const disabled = !isMine && (full || locked || isBooked || listing.cancelled || listing.started);
              const active = selectedId === p.shift_id;
              const est = estPayText(p);
              return (
                <button
                  key={p.shift_id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={disabled}
                  onClick={() => setSelectedId(p.shift_id)}
                  className={`w-full text-left p-3 rounded-xl border transition ${
                    active
                      ? 'border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500/40'
                      : 'border-slate-800 bg-slate-950/60 hover:border-slate-600'
                  } ${disabled ? 'opacity-50 cursor-not-allowed hover:border-slate-800' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${active ? 'border-emerald-400 bg-emerald-400' : 'border-slate-600'}`} />
                        <span className="text-sm font-bold text-white">{p.role_type}</span>
                        <TipBadge shift={p} />
                        {p.booking === 'instant' ? (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                            <Zap className="w-2.5 h-2.5" /> Instant book
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                            <ShieldCheck className="w-2.5 h-2.5" /> Needs approval
                          </span>
                        )}
                      </div>
                      {p.role_notes && <p className="text-[11px] text-slate-400 mt-1.5 whitespace-pre-line">{p.role_notes}</p>}
                      {ps && (
                        <p className={`text-[11px] mt-1.5 font-semibold ${isMine ? 'text-amber-300' : 'text-slate-400'}`}>
                          You: {STATUS_LABELS[ps] || ps}
                          {p.my_status_reason ? ` — ${p.my_status_reason}` : ''}
                        </p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <PayLabel rate={p.hourly_rate} rateMax={p.hourly_rate_max} className="text-sm font-black text-emerald-400" hiddenText="Pay shared when booked" />
                      {est && <div className="text-[10px] text-slate-500">{est} for the shift</div>}
                      <div className={`text-[11px] font-semibold mt-0.5 ${full ? 'text-slate-500' : 'text-emerald-300'}`}>
                        {full ? 'Full' : `${p.spots_left} of ${p.capacity} open`}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {listing.positions.some((p) => p.est_pay_min !== null && p.est_pay_min !== undefined) && (
            <p className="text-[10px] text-slate-500">Estimates are hours × hourly rate, before tips and taxes.</p>
          )}

          {isWaiting && selected && !selectedIsMine && !listing.conflict && (
            <p className="text-xs text-amber-300 bg-amber-950/30 border border-amber-800/40 rounded-lg p-2.5">
              Switching replaces your waiting request for <b>{mine.role_type}</b>.
            </p>
          )}

          {showNoteBox && (
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">Note for the manager (optional)</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 500))}
                rows={2}
                placeholder="e.g. 3 years behind the bar, can stay late"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
              />
              <div className="text-[10px] text-slate-500 text-right">{note.length}/500</div>
            </div>
          )}

          {isWaiting && mine.note && (
            <p className="text-[11px] text-slate-400">
              Your note: <span className="text-slate-300">{mine.note}</span>
            </p>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
```

---

## 14. Frontend — `frontend/src/pages/WorkerDashboard.jsx` (FULL FILE REPLACEMENT)

What changed vs. the current file:
* `availableShifts`, `/shifts/open`, `handleRequestShift`, `requestingId` and `requestedMap` are removed. The page loads `GET /listings` into `listings`.
* New state:
  * filters: `search`, `whenFilter`, `roleFilter`, `venueFilter`, `instantOnly`, `hideRequested`
  * `openListing` (`{eventId, initial}`)
  * `withdrawingId`
* `fetchWorkerData(showSpinner = true)`. The modal calls it with `false` so the page doesn't flash.
* Find Shifts is a filter bar plus day-grouped `EventListingCard`s.
* My Schedule shows upcoming first, then a folded "Past & closed" list. It uses `STATUS_LABELS`, shows reasons, and adds the Details, Directions, Calendar and Withdraw buttons.
* The Pending Transfers tab, clock in/out, drop, transfer and board logic are unchanged.

```jsx
import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import {
  Calendar, AlertCircle, Briefcase, Check, Search, Filter,
  Timer, ArrowRightLeft, MessageSquare, X, Star, Zap, Info, CalendarPlus, Navigation,
} from 'lucide-react';
import TransferModal from '../components/TransferModal';
import ShiftBoardModal from '../components/ShiftBoardModal';
import TipBadge from '../components/TipBadge';
import PayLabel from '../components/PayLabel';
import EventListingCard from '../components/EventListingCard';
import EventListingModal from '../components/EventListingModal';
import { fmtDateTime } from '../utils/venueTime';
import {
  STATUS_LABELS, PENDING_STATUSES, dayGroupLabel, isOnDay, downloadIcs, mapsUrl,
} from '../utils/listingFormat';

const UPCOMING_STATUSES = ['pending', 'pending_manager_approval', 'approved', 'confirmed', 'checked_in'];

export default function WorkerDashboard() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('find'); // 'find' | 'schedule' | 'transfers'
  const [listings, setListings] = useState([]);
  const [myShifts, setMyShifts] = useState([]);
  const [incomingTransfers, setIncomingTransfers] = useState([]);
  const [activeClockIns, setActiveClockIns] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [clockActionLoading, setClockActionLoading] = useState(null);
  const [transferActionLoading, setTransferActionLoading] = useState(null);
  const [withdrawingId, setWithdrawingId] = useState(null);
  const [notification, setNotification] = useState(null);

  // Phase 26.1: Find Shifts filters
  const [search, setSearch] = useState('');
  const [whenFilter, setWhenFilter] = useState('all'); // 'all' | 'today' | 'tomorrow' | 'week'
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [venueFilter, setVenueFilter] = useState('ALL');
  const [instantOnly, setInstantOnly] = useState(false);
  const [hideRequested, setHideRequested] = useState(false);

  // Modals state
  const [openListing, setOpenListing] = useState(null); // { eventId, initial }
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferShiftId, setTransferShiftId] = useState(null);
  const [activeDiscussionShift, setActiveDiscussionShift] = useState(null);
  const [shiftToDrop, setShiftToDrop] = useState(null);
  const [dropping, setDropping] = useState(false);

  const fetchWorkerData = async (showSpinner = true) => {
    try {
      if (showSpinner) setLoading(true);
      const [listingsRes, myRes, transfersRes, activeClocksRes] = await Promise.all([
        api.get('/listings'),
        api.get('/users/me/shifts'),
        api.get('/transfers/my-incoming'),
        api.get('/shifts/time-entries/active').catch(() => ({ data: [] })),
      ]);
      setListings(listingsRes.data || []);
      setMyShifts(myRes.data || []);
      setIncomingTransfers(transfersRes.data || []);

      const clockedIds = new Set((activeClocksRes.data || []).map((te) => te.shift_id));
      setActiveClockIns(clockedIds);
    } catch (err) {
      console.error('Error loading worker dashboard data:', err);
      setNotification({
        type: 'error',
        message: 'Failed to load shifts from backend server.',
      });
    } finally {
      if (showSpinner) setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkerData();
  }, []);

  // Phase 26.1: withdraw a request that is still waiting for approval
  const handleWithdraw = async (req) => {
    try {
      setWithdrawingId(req.id);
      await api.post(`/listings/requests/${req.id}/withdraw`);
      setNotification({ type: 'info', message: 'Request withdrawn.' });
      fetchWorkerData(false);
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to withdraw request.',
      });
    } finally {
      setWithdrawingId(null);
    }
  };

  // Hour tracking Clock In / Clock Out
  const handleClockIn = async (shiftId) => {
    try {
      setClockActionLoading(shiftId);
      await api.post(`/shifts/${shiftId}/clock-in`);
      setActiveClockIns((prev) => new Set([...prev, shiftId]));
      setNotification({
        type: 'success',
        message: '⏱️ Clocked in! Time tracking has commenced for this shift.',
      });
      fetchWorkerData();
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to clock in.',
      });
    } finally {
      setClockActionLoading(null);
    }
  };

  const handleClockOut = async (shiftId) => {
    try {
      setClockActionLoading(shiftId);
      await api.post(`/shifts/${shiftId}/clock-out`);
      setActiveClockIns((prev) => {
        const updated = new Set(prev);
        updated.delete(shiftId);
        return updated;
      });
      setNotification({
        type: 'success',
        message: '🏁 Clocked out! Shift hours recorded successfully.',
      });
      fetchWorkerData();
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to clock out.',
      });
    } finally {
      setClockActionLoading(null);
    }
  };

  // Shift Transfers (Accept / Reject)
  const handleAcceptTransfer = async (transferId) => {
    try {
      setTransferActionLoading(transferId);
      await api.post(`/transfers/${transferId}/accept`);
      setNotification({
        type: 'success',
        message: 'Shift transfer accepted! Awaiting Venue Manager approval.',
      });
      fetchWorkerData();
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to accept transfer.',
      });
    } finally {
      setTransferActionLoading(null);
    }
  };

  const handleRejectTransfer = async (transferId) => {
    try {
      setTransferActionLoading(transferId);
      await api.post(`/transfers/${transferId}/reject`);
      setNotification({
        type: 'info',
        message: 'Shift transfer proposal declined.',
      });
      fetchWorkerData();
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to decline transfer.',
      });
    } finally {
      setTransferActionLoading(null);
    }
  };

  // Phase 14: Shift Dropping
  const handleDropShift = async () => {
    if (!shiftToDrop) return;
    const targetShiftId = shiftToDrop.shift_id || shiftToDrop.shift?.id;
    try {
      setDropping(true);
      await api.post(`/shifts/${targetShiftId}/drop`);
      // Immediately remove the shift from the UI without requiring a page reload
      setMyShifts((prev) => prev.filter((s) => s.id !== shiftToDrop.id));
      setNotification({
        type: 'success',
        message: 'Shift dropped successfully. Capacity has been returned to the open marketplace.',
      });
      setShiftToDrop(null);
      fetchWorkerData();
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to drop shift.',
      });
    } finally {
      setDropping(false);
    }
  };

  const confirmedShifts = myShifts.filter((s) =>
    ['approved', 'checked_in', 'confirmed'].includes(String(s.status || '').toLowerCase())
  );

  // ---- Phase 26.1: Find Shifts (one card per event) ------------------------------------
  const openListingCount = listings.filter((l) => l.total_spots_left > 0 && !l.my_request).length;

  const roleOptions = useMemo(
    () =>
      Array.from(
        new Set(listings.flatMap((l) => l.positions.filter((p) => p.status === 'OPEN').map((p) => p.role_type)))
      ).sort(),
    [listings]
  );

  const venueOptions = useMemo(() => {
    const m = new Map();
    listings.forEach((l) => l.venue && m.set(l.venue.id, l.venue.name));
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [listings]);

  const filteredListings = useMemo(() => {
    const q = search.trim().toLowerCase();
    const weekEnd = Date.now() + 7 * 86400000;
    return listings.filter((l) => {
      const tz = l.venue?.timezone;
      if (q) {
        const hay = [l.title, l.venue?.name, l.venue?.address, ...l.positions.map((p) => p.role_type)]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (whenFilter === 'today' && !isOnDay(l.start_time, tz, 0)) return false;
      if (whenFilter === 'tomorrow' && !isOnDay(l.start_time, tz, 1)) return false;
      if (whenFilter === 'week' && new Date(l.start_time).getTime() > weekEnd) return false;
      if (roleFilter !== 'ALL' && !l.positions.some((p) => p.role_type === roleFilter && (p.status === 'OPEN' || p.my_status))) return false;
      if (venueFilter !== 'ALL' && l.venue?.id !== venueFilter) return false;
      if (instantOnly && !l.any_instant) return false;
      if (hideRequested && l.my_request) return false;
      return true;
    });
  }, [listings, search, whenFilter, roleFilter, venueFilter, instantOnly, hideRequested]);

  const listingGroups = useMemo(() => {
    const groups = [];
    filteredListings.forEach((l) => {
      const label = dayGroupLabel(l.start_time, l.venue?.timezone);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(l);
      else groups.push({ label, items: [l] });
    });
    return groups;
  }, [filteredListings]);

  const filtersActive =
    search || whenFilter !== 'all' || roleFilter !== 'ALL' || venueFilter !== 'ALL' || instantOnly || hideRequested;
  const clearFilters = () => {
    setSearch('');
    setWhenFilter('all');
    setRoleFilter('ALL');
    setVenueFilter('ALL');
    setInstantOnly(false);
    setHideRequested(false);
  };

  // ---- Phase 26.1: My Schedule split -------------------------------------------------------
  const nowMs = Date.now();
  const isUpcomingReq = (req) => {
    const st = String(req.status || '').toLowerCase();
    if (!UPCOMING_STATUSES.includes(st)) return false;
    if (st === 'checked_in') return true;
    const end = new Date(req.shift?.end_time).getTime();
    return Number.isNaN(end) ? true : end >= nowMs;
  };
  const upcomingRequests = myShifts
    .filter(isUpcomingReq)
    .sort((a, b) => new Date(a.shift?.start_time) - new Date(b.shift?.start_time));
  const historyRequests = myShifts
    .filter((r) => !isUpcomingReq(r))
    .sort((a, b) => new Date(b.shift?.start_time) - new Date(a.shift?.start_time));

  const addShiftToCalendar = (req) => {
    const shift = req.shift;
    if (!shift) return;
    downloadIcs({
      uid: `${req.id}@shiftboard`,
      title: `${shift.title} — ${shift.role_type || 'Shift'} (${shift.venue?.name || ''})`,
      start: shift.start_time,
      end: shift.end_time,
      location: shift.venue?.address,
      description: [shift.event_notes, shift.description, shift.venue?.arrival_instructions].filter(Boolean).join('\n\n'),
    });
  };

  const renderRequestCard = (req) => {
    const shift = req.shift;
    const shiftId = req.shift_id || shift?.id;
    const statusLower = String(req.status || '').toLowerCase();
    const isApproved = ['approved', 'confirmed'].includes(statusLower);
    const isCheckedIn = statusLower === 'checked_in' || activeClockIns.has(shiftId);
    const isCompleted = statusLower === 'completed';
    const isPending = PENDING_STATUSES.includes(statusLower);
    const isClockLoading = clockActionLoading === shiftId;

    return (
      <div
        key={req.id}
        className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
      >
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase ${
                isCheckedIn
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse'
                  : isApproved
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : isCompleted
                  ? 'bg-slate-800 text-slate-300 border border-slate-700'
                  : isPending
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                  : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
              }`}
            >
              {isCheckedIn ? 'CLOCKED IN' : STATUS_LABELS[statusLower] || req.status}
            </span>

            {req.approval_source && (
              <span className="text-xs text-slate-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                Via: {req.approval_source.replace(/_/g, ' ')}
              </span>
            )}
          </div>

          <h3 className="text-base font-bold text-white mt-1">{shift?.title}</h3>
          {req.status_reason && ['cancelled', 'removed', 'no_show', 'withdrawn'].includes(statusLower) && (
            <p className="text-xs text-rose-300">Reason: {req.status_reason}</p>
          )}
          <p className="text-xs text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-slate-300 font-medium">{shift?.venue?.name}</span>
            <span>•</span>
            <span>{shift?.role_type || shift?.role_required}</span>
            <span>•</span>
            <PayLabel rate={shift?.hourly_rate} rateMax={shift?.hourly_rate_max} />
            <TipBadge shift={shift} />
          </p>
          <p className="text-xs text-slate-500">
            {fmtDateTime(shift?.start_time, shift?.venue?.timezone)}
          </p>
          {req.notes && isPending && (
            <p className="text-[11px] text-slate-400">Your note: <span className="text-slate-300">{req.notes}</span></p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto justify-end">
          {shift?.event_id && (
            <button
              type="button"
              onClick={() => setOpenListing({ eventId: shift.event_id, initial: null })}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition flex items-center space-x-1"
            >
              <Info className="w-3.5 h-3.5 text-emerald-400" />
              <span>Details</span>
            </button>
          )}

          {(isApproved || isCheckedIn) && shift?.venue && (
            <a
              href={mapsUrl(shift.venue)}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition flex items-center space-x-1"
            >
              <Navigation className="w-3.5 h-3.5 text-emerald-400" />
              <span>Directions</span>
            </a>
          )}

          {isApproved && (
            <button
              type="button"
              onClick={() => addShiftToCalendar(req)}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition flex items-center space-x-1"
            >
              <CalendarPlus className="w-3.5 h-3.5 text-emerald-400" />
              <span>Calendar</span>
            </button>
          )}

          {/* Discussion Board button for confirmed shifts */}
          {(isApproved || isCheckedIn || isCompleted) && (
            <button
              type="button"
              onClick={() => setActiveDiscussionShift(shift)}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition flex items-center space-x-1"
            >
              <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
              <span>Board</span>
            </button>
          )}

          {/* Transfer Shift button */}
          {isApproved && !isCheckedIn && (
            <button
              type="button"
              onClick={() => {
                setTransferShiftId(shiftId);
                setTransferModalOpen(true);
              }}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 text-xs font-semibold transition flex items-center space-x-1"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span>Transfer</span>
            </button>
          )}

          {/* Drop Shift button (Phase 14) */}
          {isApproved && !isCheckedIn && !isCompleted && (() => {
            const shiftStartTime = new Date(shift?.start_time).getTime();
            const hoursRemaining = (shiftStartTime - Date.now()) / (1000 * 60 * 60);
            const canDrop = hoursRemaining >= 24;

            return (
              <div className="flex flex-col items-end">
                <button
                  type="button"
                  onClick={() => setShiftToDrop(req)}
                  disabled={!canDrop}
                  title={
                    !canDrop
                      ? 'Shifts cannot be dropped within 24 hours of the start time. Please request a transfer or contact the manager.'
                      : 'Drop this shift and return it to the open marketplace.'
                  }
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold transition text-red-600 border border-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  Drop Shift
                </button>
                {!canDrop && (
                  <span className="text-[10px] text-slate-500 italic mt-0.5">
                    &lt;24h to start (locked)
                  </span>
                )}
              </div>
            );
          })()}

          {/* Time Tracking Clock In / Clock Out Button */}
          {(isApproved || isCheckedIn) && (
            isCheckedIn ? (
              <button
                type="button"
                onClick={() => handleClockOut(shiftId)}
                disabled={isClockLoading}
                className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition flex items-center space-x-1.5 shadow-md shadow-rose-600/20 disabled:opacity-50"
              >
                <Timer className="w-3.5 h-3.5" />
                <span>{isClockLoading ? 'Saving...' : 'Clock Out'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleClockIn(shiftId)}
                disabled={isClockLoading}
                className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center space-x-1.5 shadow-md shadow-emerald-600/20 disabled:opacity-50"
              >
                <Timer className="w-3.5 h-3.5" />
                <span>{isClockLoading ? 'Saving...' : 'Clock In'}</span>
              </button>
            )
          )}

          {isCompleted && (
            <span className="px-3.5 py-1.5 rounded-xl bg-slate-800 text-emerald-400 border border-emerald-800/40 text-xs font-bold flex items-center space-x-1">
              <Check className="w-3.5 h-3.5" />
              <span>Completed</span>
            </span>
          )}

          {isPending && (
            <>
              <span className="text-xs text-amber-400 bg-amber-950/40 border border-amber-800/40 px-3.5 py-2 rounded-xl font-medium">
                Awaiting Venue Manager Review
              </span>
              <button
                type="button"
                onClick={() => handleWithdraw(req)}
                disabled={withdrawingId === req.id}
                className="px-3 py-1.5 rounded-xl border border-rose-500/50 text-rose-300 hover:bg-rose-500/10 text-xs font-semibold transition disabled:opacity-50"
              >
                {withdrawingId === req.id ? 'Withdrawing…' : 'Withdraw'}
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-16">
      {/* Header Profile Section */}
      <section className="bg-slate-900 border-b border-slate-800 py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-center space-x-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 font-black text-xl shadow-lg shadow-emerald-500/20">
              {user?.first_name?.[0] || 'W'}{user?.last_name?.[0] || 'K'}
            </div>
            <div>
              <div className="flex items-center space-x-2.5">
                <h1 className="text-2xl font-bold text-white">
                  {user?.first_name} {user?.last_name || 'Worker'}
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Worker
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {user?.bio || 'Ready for shifts across verified hospitality venues.'}
              </p>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="flex items-center space-x-3 bg-slate-950/80 px-4 py-2.5 rounded-2xl border border-slate-800">
            <div className="flex items-center space-x-1.5 text-amber-400 text-sm font-bold">
              <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
              <span>{Number(user?.aggregate_rating || user?.rating_average || 5.0).toFixed(1)}</span>
            </div>
            <span className="text-slate-700">•</span>
            <div className="text-xs text-slate-300">
              <span className="font-bold text-white">{confirmedShifts.length}</span> scheduled
            </div>
            <span className="text-slate-700">•</span>
            <div className="text-xs text-slate-300">
              <span className="font-bold text-white">{incomingTransfers.length}</span> transfers
            </div>
            <span className="text-slate-700">•</span>
            <div className="text-xs text-slate-300">
              <span className="font-bold text-white">{openListingCount}</span> open
            </div>
          </div>
        </div>
      </section>

      {/* Main Dashboard */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8">
        {notification && (
          <div
            className={`mb-6 p-4 rounded-xl border flex items-center justify-between transition ${
              notification.type === 'success'
                ? 'bg-emerald-950/80 border-emerald-700 text-emerald-200'
                : notification.type === 'error'
                ? 'bg-rose-950/80 border-rose-700 text-rose-200'
                : 'bg-indigo-950/80 border-indigo-700 text-indigo-200'
            }`}
          >
            <div className="flex items-center space-x-2.5">
              {notification.type === 'success' ? (
                <Check className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-indigo-400 flex-shrink-0" />
              )}
              <span className="text-sm font-medium">{notification.message}</span>
            </div>
            <button onClick={() => setNotification(null)} className="text-xs underline hover:opacity-80">
              Dismiss
            </button>
          </div>
        )}

        {/* Tab Selection */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-4 gap-4">
          <div className="flex space-x-3 overflow-x-auto whitespace-nowrap -mx-1 px-1">
            <button
              onClick={() => setActiveTab('find')}
              className={`px-5 py-2.5 rounded-xl text-xs font-bold transition ${
                activeTab === 'find'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              Find Shifts ({openListingCount})
            </button>
            <button
              onClick={() => setActiveTab('schedule')}
              className={`px-5 py-2.5 rounded-xl text-xs font-bold transition ${
                activeTab === 'schedule'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              My Schedule ({upcomingRequests.length})
            </button>
            <button
              onClick={() => setActiveTab('transfers')}
              className={`px-5 py-2.5 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 ${
                activeTab === 'transfers'
                  ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span>Pending Transfers ({incomingTransfers.length})</span>
            </button>
          </div>
        </div>

        {/* TAB 1: Find Shifts (Phase 26.1: one card per event) */}
        {activeTab === 'find' && (
          <div className="mt-6">
            {/* Filters */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-3 sm:p-4 space-y-3">
              <div className="flex flex-col lg:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search events, venues, positions"
                    className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1 overflow-x-auto">
                  {[
                    { id: 'all', label: 'All dates' },
                    { id: 'today', label: 'Today' },
                    { id: 'tomorrow', label: 'Tomorrow' },
                    { id: 'week', label: 'Next 7 days' },
                  ].map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => setWhenFilter(w.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                        whenFilter === w.id ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <Filter className="w-3.5 h-3.5" />
                </span>
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-medium text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="ALL">All positions</option>
                  {roleOptions.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <select
                  value={venueFilter}
                  onChange={(e) => setVenueFilter(e.target.value)}
                  className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-medium text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="ALL">All venues</option>
                  {venueOptions.map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setInstantOnly((v) => !v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border inline-flex items-center gap-1 transition ${
                    instantOnly
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                  }`}
                >
                  <Zap className="w-3.5 h-3.5" /> Instant book
                </button>
                <button
                  type="button"
                  onClick={() => setHideRequested((v) => !v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                    hideRequested
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                  }`}
                >
                  Hide ones I've requested
                </button>
                {filtersActive && (
                  <button type="button" onClick={clearFilters} className="text-xs text-slate-400 underline hover:text-white ml-auto">
                    Clear filters
                  </button>
                )}
              </div>
            </div>

            {loading ? (
              <div className="py-20 text-center text-slate-500 text-xs">Loading open shifts...</div>
            ) : filteredListings.length === 0 ? (
              <div className="mt-6 text-center py-20 bg-slate-900/40 rounded-2xl border border-slate-800">
                <Briefcase className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <h3 className="text-sm font-semibold text-slate-300">
                  {listings.length === 0 ? 'No shifts open right now' : 'Nothing matches these filters'}
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  {listings.length === 0 ? 'Check back soon as venue managers post new shifts.' : 'Try clearing a filter or two.'}
                </p>
              </div>
            ) : (
              <div className="mt-6 space-y-8">
                {listingGroups.map((g) => (
                  <section key={g.label}>
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
                      <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                      {g.label}
                      <span className="text-slate-600 font-semibold normal-case tracking-normal">
                        · {g.items.length} event{g.items.length === 1 ? '' : 's'}
                      </span>
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
                      {g.items.map((l) => (
                        <EventListingCard
                          key={l.event_id}
                          listing={l}
                          onOpen={(item) => setOpenListing({ eventId: item.event_id, initial: item })}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: My Schedule (Phase 26.1: upcoming first, history folded away) */}
        {activeTab === 'schedule' && (
          <div className="mt-6 space-y-4">
            {upcomingRequests.length === 0 ? (
              <div className="text-center py-16 bg-slate-900/40 rounded-2xl border border-slate-800">
                <Calendar className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <h3 className="text-sm font-semibold text-slate-300">Nothing coming up</h3>
                <p className="text-xs text-slate-500 mt-1">Browse "Find Shifts" to pick up your next shift.</p>
              </div>
            ) : (
              upcomingRequests.map(renderRequestCard)
            )}

            {historyRequests.length > 0 && (
              <details className="group pt-2">
                <summary className="cursor-pointer select-none text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-white">
                  Past & closed ({historyRequests.length})
                </summary>
                <div className="mt-4 space-y-4 opacity-80">
                  {historyRequests.map(renderRequestCard)}
                </div>
              </details>
            )}
          </div>
        )}

        {/* TAB 3: Pending Shift Transfers */}
        {activeTab === 'transfers' && (
          <div className="mt-6 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <ArrowRightLeft className="w-5 h-5 text-amber-400" />
                <h2 className="text-base font-bold text-white">
                  Incoming Shift Transfer Offers ({incomingTransfers.length})
                </h2>
              </div>
              <span className="text-xs text-slate-400">
                Peers proposing to transfer confirmed shifts to you
              </span>
            </div>

            {incomingTransfers.length === 0 ? (
              <div className="text-center py-20 bg-slate-900/40 rounded-2xl border border-slate-800">
                <ArrowRightLeft className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <h3 className="text-sm font-semibold text-slate-300">No incoming transfer offers</h3>
                <p className="text-xs text-slate-500 mt-1">
                  When other workers propose shift transfers to you, they will appear here.
                </p>
              </div>
            ) : (
              incomingTransfers.map((transfer) => {
                const shift = transfer.shift;
                const fromWorker = transfer.from_worker;
                const isActionLoading = transferActionLoading === transfer.id;

                return (
                  <div
                    key={transfer.id}
                    className="p-5 bg-slate-900 border border-slate-800 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xl"
                  >
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-bold uppercase px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">
                          Transfer Offer
                        </span>
                        <span className="text-xs text-slate-400">
                          From: <strong className="text-white">{fromWorker?.first_name} {fromWorker?.last_name}</strong> ({fromWorker?.email})
                        </span>
                      </div>

                      <h3 className="text-base font-bold text-white mt-1.5">{shift?.title}</h3>
                      <p className="text-xs text-slate-400 flex items-center space-x-2 mt-1">
                        <span className="text-slate-300 font-medium">{shift?.venue?.name}</span>
                        <span>•</span>
                        <span>{shift?.role_type}</span>
                        <span>•</span>
                        <PayLabel rate={shift?.hourly_rate} rateMax={shift?.hourly_rate_max} className="text-emerald-400 font-semibold" />
                        <TipBadge shift={shift} />
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        {fmtDateTime(shift?.start_time, shift?.venue?.timezone)}
                      </p>
                    </div>

                    <div className="flex items-center space-x-2.5 w-full md:w-auto justify-end">
                      <button
                        type="button"
                        onClick={() => handleAcceptTransfer(transfer.id)}
                        disabled={isActionLoading}
                        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center space-x-1.5 shadow-md shadow-emerald-600/20 disabled:opacity-50"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>{isActionLoading ? 'Processing...' : 'Accept Transfer'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRejectTransfer(transfer.id)}
                        disabled={isActionLoading}
                        className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-rose-950 text-slate-300 hover:text-rose-300 border border-slate-700 text-xs font-semibold transition disabled:opacity-50"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </main>

      {/* Phase 26.1: Event details + request modal */}
      {openListing && (
        <EventListingModal
          eventId={openListing.eventId}
          initial={openListing.initial}
          onClose={() => setOpenListing(null)}
          onChanged={() => fetchWorkerData(false)}
          onGoToSchedule={() => {
            setOpenListing(null);
            setActiveTab('schedule');
          }}
        />
      )}

      {/* Transfer Proposal Modal */}
      {transferModalOpen && (
        <TransferModal
          isOpen={transferModalOpen}
          onClose={() => setTransferModalOpen(false)}
          myConfirmedShifts={confirmedShifts}
          preselectedShiftId={transferShiftId}
          onTransferSuccess={() => {
            setNotification({
              type: 'success',
              message: 'Transfer proposal sent to peer worker! Awaiting their acceptance.',
            });
            fetchWorkerData();
          }}
        />
      )}

      {/* Shift Discussion Board Modal (Phase 25.3: always on top) */}
      {activeDiscussionShift && (
        <ShiftBoardModal
          shiftId={activeDiscussionShift.id}
          shiftTitle={`${activeDiscussionShift.title} (${activeDiscussionShift.venue?.name || ''})`}
          currentUserRole={user?.role}
          onClose={() => setActiveDiscussionShift(null)}
        />
      )}

      {/* Confirm Drop Modal (Phase 14) */}
      {shiftToDrop && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-800">
              <div className="flex items-center space-x-2 text-rose-500">
                <AlertCircle className="w-5 h-5" />
                <h3 className="text-base font-bold text-white">Confirm Drop Shift</h3>
              </div>
              <button
                type="button"
                onClick={() => setShiftToDrop(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-slate-300 leading-relaxed">
                Are you sure you want to drop this shift? This action cannot be undone, and the shift will be offered to other workers.
              </p>

              {shiftToDrop.shift && (
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs space-y-1">
                  <p className="font-bold text-white">{shiftToDrop.shift.title}</p>
                  <p className="text-slate-400">
                    {shiftToDrop.shift.venue?.name} • {shiftToDrop.shift.role_type} • <PayLabel rate={shiftToDrop.shift.hourly_rate} rateMax={shiftToDrop.shift.hourly_rate_max} />
                  </p>
                  <p className="text-slate-500 text-[11px]">
                    {fmtDateTime(shiftToDrop.shift.start_time, shiftToDrop.shift.venue?.timezone)}
                  </p>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShiftToDrop(null)}
                disabled={dropping}
                className="px-4 py-2 rounded-xl bg-slate-800 text-xs font-semibold text-slate-300 hover:bg-slate-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDropShift}
                disabled={dropping}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition shadow-md shadow-rose-600/20 disabled:opacity-50"
              >
                {dropping ? 'Dropping...' : 'Confirm Drop'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## 15. Frontend — `frontend/src/pages/VenueProfile.jsx` (EDITS)

### 15a. Import (under the `venueTime` import)
```jsx
import EventListingModal from '../components/EventListingModal';
```

### 15b. `MY_STATUS` map — add a `withdrawn` entry, and a constant after the map
Find:
```jsx
  transferred: { label: 'Handed off', cls: 'bg-slate-800 text-slate-400 border-slate-700' },
};
```
Replace with:
```jsx
  transferred: { label: 'Handed off', cls: 'bg-slate-800 text-slate-400 border-slate-700' },
  withdrawn: { label: 'Withdrawn', cls: 'bg-slate-800 text-slate-400 border-slate-700' },
};

const ACTIVE_MY_STATUSES = ['pending', 'pending_manager_approval', 'approved', 'confirmed', 'checked_in', 'completed'];
```

### 15c. State
Find:
```jsx
  const [requestingId, setRequestingId] = useState(null);
  const [notice, setNotice] = useState(null);
```
Replace with:
```jsx
  const [notice, setNotice] = useState(null);
  const [openEventId, setOpenEventId] = useState(null); // Phase 26.1
```

### 15d. Delete the whole `handleRequest` function
Delete everything from `  const handleRequest = async (shiftId) => {` down to (not including) `  if (loading && !profile) {`.

### 15e. Event header — add the "View & request" button
Find:
```jsx
                    <span className="text-xs text-slate-400 inline-flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" /> {ev.total_filled}/{ev.total_capacity} staffed
                    </span>
```
Replace with:
```jsx
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-400 inline-flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" /> {ev.total_filled}/{ev.total_capacity} staffed
                      </span>
                      {scope === 'upcoming' && isWorker && ev.event_id && (() => {
                        const hasMine = ev.positions.some((x) => ACTIVE_MY_STATUSES.includes(x.my_status));
                        const anyOpen = ev.positions.some((x) => x.status === 'OPEN' && x.spots_left > 0);
                        if (!hasMine && !anyOpen) return null;
                        return (
                          <button
                            type="button"
                            onClick={() => setOpenEventId(ev.event_id)}
                            className="px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold"
                          >
                            {hasMine ? 'View details' : 'View & request'}
                          </button>
                        );
                      })()}
                    </div>
```

### 15f. Remove the per-position "Pick up shift" button
Delete these two lines inside `ev.positions.map(...)`:
```jsx
                      const canRequest =
                        scope === 'upcoming' && isWorker && !p.my_status && p.status === 'OPEN' && p.spots_left > 0;
```
Then find:
```jsx
                            ) : canRequest ? (
                              <button
                                type="button"
                                onClick={() => handleRequest(p.shift_id)}
                                disabled={requestingId === p.shift_id}
                                className="px-4 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold disabled:opacity-50"
                              >
                                {requestingId === p.shift_id ? 'Sending…' : 'Pick up shift'}
                              </button>
                            ) : scope
```
Replace with:
```jsx
                            ) : scope
```

### 15g. Render the modal
At the very end of the component's JSX, find:
```jsx
        </div>
      </main>
    </div>
  );
}
```
Replace with:
```jsx
        </div>
      </main>

      {openEventId && (
        <EventListingModal
          eventId={openEventId}
          onClose={() => setOpenEventId(null)}
          onChanged={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
```

---

## 16. Frontend — `frontend/src/components/EventRosterModal.jsx` (EDIT)

In the **Requested** list, find:
```jsx
                              <div className="text-[11px] text-slate-400 mt-0.5">Requested {p.requested_at ? fmtDateTime(p.requested_at, timeZone) : ''}</div>
```
Add directly after it:
```jsx
                              {p.note && (
                                <div className="text-[11px] text-slate-300 mt-1 italic whitespace-pre-line">“{p.note}”</div>
                              )}
```

---

## 17. Behaviour summary

**One request per event**
* A worker can hold one active request (waiting or booked) per event.
* If they're **waiting** on Bartender and pick Server, the button reads **Switch to Server**. The Bartender request becomes `withdrawn` with the reason "Switched to Server", in the same transaction.
* If they're **booked**, other positions are disabled. They must drop (24h rule) or hand off from My Schedule first.

**Positions that can't be re-requested**
* A position the venue **declined** stays declined, but the worker may request a *different* position in that event.
* **Dropped**, **removed**, **no-show** and **handed-off** positions can't be re-requested from the listing.

**Automatic cleanup**
* When a manager approves one of a worker's requests, or approves a transfer to them, any other waiting request they have in that event is withdrawn automatically.

**Instant book label**
* The "Instant book" label is computed per viewer: position mode, venue policy, whitelist and rating threshold. It's the exact function the request uses.

**Hidden pay**
* Hidden pay stays hidden: it shows as "Pay shared when booked" and there's no earnings estimate.

**Listing contents**
* Listings show upcoming, not-cancelled events in the next 60 days with ≥1 open spot, plus events where the worker has an active request.
* Full events drop off the list; a waitlist comes in a later phase.

**Overlap warning**
* An event that overlaps one of the worker's booked shifts shows an amber warning, and requesting is disabled.

**Rate limiting and races**
* Double-tapping "Book instantly" is safe: the event row lock serializes the requests, and the second one gets "You're already booked on this position."

---

## 18. Rebuild & Verification

**No schema change.** Just rebuild:
```bash
docker compose up -d --build
```
If the browser shows a blank page or "Invalid hook call" after the rebuild, clear the Vite cache once:
```bash
docker compose exec frontend rm -rf node_modules/.vite && docker compose restart frontend
```
then hard-refresh (Ctrl+Shift+R).

**Checklist**
1. Log in as a worker, then open **Find Shifts**.
   * You should see one card per event, grouped under Today / Tomorrow / dates.
   * Each card lists its positions with pay, open spots and a ⚡ or shield icon.
2. Type in search, switch "Next 7 days", pick a position, and toggle "Instant book".
   * The cards filter.
   * "Clear filters" resets them.
3. Open a card and check the modal:
   * the left column shows the date, hours, venue, directions, dress code and notes
   * the right column has radio-style positions
4. Pick a **Needs approval** position, add a note, and press **Send request**.
   * You get "Request sent…".
   * The position shows "You: Waiting for approval", and the card shows "Requested · Bartender".
5. In the same modal pick another position.
   * The button reads **Switch to Server**, with an amber explanation.
   * Press it: the old request becomes Withdrawn and the new one is waiting.
6. Press **Withdraw request**.
   * Nothing is active any more.
   * You can request again.
7. Pick an **Instant book** position.
   * You get "You're booked!" and a green banner.
   * Other positions are disabled.
   * Add to calendar downloads a `.ics` file.
   * Go to My Schedule switches tabs.
8. In **My Schedule**:
   * booked shifts show Details, Directions, Calendar, Board, Transfer, Drop and Clock In
   * waiting requests show Withdraw
   * withdrawn and past items are under "Past & closed"
9. Log in as the manager, then open Posted Shifts → Details. The worker's note appears under "Requested".
10. Approve a request for a worker who also has a waiting request on another position in that event. The other request becomes Withdrawn ("Booked on another position for this event").
11. Open `/venues/<id>` as a worker. Events show **View & request**, which opens the same modal. There are no per-position "Pick up shift" buttons.
12. API: call `POST /api/listings/<event_id>/request` twice quickly with the same body. The first succeeds and the second returns 400 or 409, and `spots_filled` is never above capacity.