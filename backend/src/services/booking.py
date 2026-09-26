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
from src.services import notify_events
from src.services import activity
from src.services.team import is_blocked

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
        if await is_blocked(db, shift.venue_id, worker.id):          # Phase 29
            raise HTTPException(status_code=403, detail="This venue isn't taking requests from you right now.")

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
    await activity.for_request("instant_booked" if status_val == "approved" else "request_created", req_id, worker.id)   # Phase 29.1
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
