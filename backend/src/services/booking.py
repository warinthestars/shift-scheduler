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
* Phase 29.4: a worker who DROPPED a position in this event can ask to come back (same or another
  position). They must say why, it always waits for a manager, and the request carries
  previous_drop_at + rebook_reason. dropped_at is kept on the row so the drop still counts for
  reliability unless they end up working the shift.
"""
import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.models import Shift, ShiftEvent, ShiftRequest, User, Venue
from src.services.auto_confirm import evaluate_shift_request, check_double_booking
from src.services import notify_events
from src.services import activity
from src.services.team import is_blocked
from src.services.fit import load_fit, load_requirements, required_for, tz_of
from src.services.departments import load_dept_context   # Phase 32.2

logger = logging.getLogger("shiftboard.booking")

PENDING_STATUSES = ("pending", "pending_manager_approval")
BOOKED_STATUSES = ("approved", "confirmed", "checked_in")
ASSIGNED_STATUSES = ("approved", "confirmed", "checked_in", "completed")
ACTIVE_STATUSES = PENDING_STATUSES + ASSIGNED_STATUSES
REREQUESTABLE_STATUSES = ("withdrawn", "dropped")      # Phase 29.4: dropped = ask to come back
BLOCKED_MESSAGES = {
    "rejected": "The venue already passed on your request for this position. You can request a different position.",
    "removed": "The venue removed you from this shift.",
    "no_show": "You were marked as a no-show for this shift.",
    "cancelled": "This position was cancelled.",
    "transferred": "You handed this shift off earlier.",
}
NOTE_MAX = 500


REBOOK_REASON_MIN = 5


async def prior_drop_in_event(db: AsyncSession, worker_id, shift: Shift) -> Optional[datetime]:
    """Phase 29.4: the latest time this worker dropped a position in this event (or this shift), if ever."""
    q = (
        select(func.max(ShiftRequest.dropped_at))
        .join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(ShiftRequest.worker_id == worker_id, ShiftRequest.dropped_at.isnot(None))
    )
    q = q.where(Shift.event_id == shift.event_id) if shift.event_id else q.where(Shift.id == shift.id)
    return await db.scalar(q)


async def require_certs(db: AsyncSession, worker: User, shift: Shift, you: bool = True, who: str = "") -> None:
    """Phase 32: 400 when the position needs certificates this person doesn't have (or that expired / weren't accepted)."""
    required = required_for(await load_requirements(db, [shift.venue_id]), shift)
    if not required:
        return
    venue = await db.scalar(select(Venue).where(Venue.id == shift.venue_id))
    tz = tz_of(venue.timezone if venue is not None else None)
    missing = (await load_fit(db, [worker.id]))[worker.id].missing(required, shift.start_time, shift.end_time, tz)
    if missing:
        where = f" at {venue.name}" if venue is not None else ""
        if you:
            raise HTTPException(status_code=400, detail=f"{shift.role_type}{where} needs: {', '.join(missing)}. "
                                                        "Add it on your Profile page, then try again.")
        raise HTTPException(status_code=400, detail=f"{who or 'They'} can't take this: {shift.role_type}{where} needs {', '.join(missing)}.")


async def refuse_if_blocked(db: AsyncSession, worker: User, shift: Shift, who: str = "") -> None:
    """Phase 32.1: nobody else can book a worker into their own time-off block (manager assign, hand-offs).
    A waiting request the worker made themselves for this position is their choice, so approving it is allowed."""
    own_request = await db.scalar(
        select(ShiftRequest.id).where(
            ShiftRequest.shift_id == shift.id, ShiftRequest.worker_id == worker.id,
            func.lower(ShiftRequest.status).in_(PENDING_STATUSES),
        )
    )
    if own_request is not None:
        return
    venue = await db.scalar(select(Venue).where(Venue.id == shift.venue_id))
    block = (await load_fit(db, [worker.id]))[worker.id].off_block(
        shift.start_time, shift.end_time, tz_of(venue.timezone if venue is not None else None))
    if block is not None:
        why = f" ({block.reason})" if block.reason else ""
        raise HTTPException(status_code=409, detail=f"{who or 'They'} blocked off this time{why}. Ask them to change their time off first.")


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
        if shift_status == "DRAFT":                                                   # Phase 29.3
            raise HTTPException(status_code=400, detail="This event isn't open for requests.")
        if as_utc(shift.start_time) <= datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="This shift has already started.")
        if await is_blocked(db, shift.venue_id, worker.id):          # Phase 29
            raise HTTPException(status_code=403, detail="This venue isn't taking requests from you right now.")
        await require_certs(db, worker, shift, you=True)              # Phase 32

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

        # --- Phase 29.4: coming back after a drop needs a reason and a manager ---------------
        prior_drop = await prior_drop_in_event(db, worker.id, shift)
        clean_note = _clean_note(note)
        if prior_drop is not None and (not clean_note or len(clean_note) < REBOOK_REASON_MIN):
            raise HTTPException(
                status_code=400,
                detail="You dropped a shift at this event earlier. Tell the manager why you can make it now. "
                       "They have to approve it.",
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
                raise HTTPException(status_code=400, detail="You're already on this position.")

        # --- Capacity (checked under the lock) -------------------------------------------
        if shift_status != "OPEN" or (shift.spots_filled or 0) >= (shift.capacity or 1):
            raise HTTPException(status_code=400, detail="This position just filled up.")
        # Phase 34: a spot offered to someone on the waitlist is held for them until the offer runs out
        from src.services.waitlist import held_by_offers
        if (shift.spots_filled or 0) + await held_by_offers(db, shift.id, exclude_worker_id=worker.id) >= (shift.capacity or 1):
            raise HTTPException(status_code=400, detail="This position just filled up.")

        await check_double_booking(db, worker.id, shift.start_time, shift.end_time, exclude_shift_id=shift.id)

        decision, source = await evaluate_shift_request(db=db, worker=worker, shift=shift, venue=shift.venue)
        status_val = (decision.value if hasattr(decision, "value") else str(decision)).lower()
        if prior_drop is not None:                     # Phase 29.4: never instant after a drop
            status_val, source = "pending", None
        # Phase 32.2: outside their departments -> always waits for a manager, and is flagged
        outside = (await load_dept_context(db, [worker.id], [shift.venue_id])).match(worker.id, shift) == "outside"
        if outside:
            status_val, source = "pending", None
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
            # Phase 29.4: dropped_at is kept (the drop still counts unless they work the shift)
            req.status_reason = None
            req.pay_rate = None
            req.notes = _clean_note(note)
            req.previous_drop_at = prior_drop
            req.rebook_reason = clean_note if prior_drop is not None else None
            req.outside_department = outside
            req.created_at = now
        else:
            req = ShiftRequest(
                shift_id=shift.id,
                worker_id=worker.id,
                status=status_val,
                approval_source=source,
                approved_at=now if status_val == "approved" else None,
                notes=_clean_note(note),
                previous_drop_at=prior_drop,                                    # Phase 29.4
                rebook_reason=clean_note if prior_drop is not None else None,
                outside_department=outside,                                      # Phase 32.2
            )
            db.add(req)

        await db.flush()
        req_id = req.id          # read before commit (commit may expire attributes)
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.exception("request_position failed")
        raise HTTPException(status_code=500, detail=f"Could not request this position: {e}")

    # Phase 28: tell the venue's managers a request is waiting (runs after the commit; never raises)
    if status_val != "approved":
        await notify_events.request_pending(req_id)
    extra = f"asking back after dropping · “{clean_note}”" if prior_drop is not None else ""
    if outside:                                                                             # Phase 32.2
        extra = f"{extra} · outside their departments" if extra else "outside their departments"
    await activity.for_request("instant_booked" if status_val == "approved" else "request_created", req_id, worker.id,
                               extra)   # Phase 29.1 / 29.4 / 32.2
    return req_id


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
                detail="Only requests that are still waiting for approval can be withdrawn. Booked shifts can be dropped or handed off from My shifts.",
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
