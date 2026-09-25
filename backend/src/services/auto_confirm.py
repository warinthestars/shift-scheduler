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
