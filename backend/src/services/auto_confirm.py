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

async def evaluate_shift_request(
    db: AsyncSession,
    worker: User,
    shift: Shift,
    venue: Venue
) -> Tuple[RequestStatus, Optional[str]]:
    """
    ShiftBoard Auto-Confirm Engine
    
    Evaluates shift application conditions in strict hierarchical order:
    1. Condition 1: Shift-Level Auto-Confirm: Is shift.is_shift_auto_confirm == True?
       -> Result: APPROVED, source: "shift_auto_confirm"
    2. Condition 2: Venue Whitelist: Is worker active in VenueWhitelist?
       -> Result: APPROVED, source: "venue_whitelist"
    3. Condition 3: Rating Threshold: Does worker.aggregate_rating >= venue.auto_approve_rating_threshold?
       -> Result: APPROVED, source: "rating_threshold"
    4. Condition 4: Fallback: None of the above matched.
       -> Result: PENDING, source: None
    
    Returns:
        Tuple[RequestStatus, Optional[str]]: (Assigned status, Approval source)
    """
    logger.info(
        f"[Auto-Confirm Engine] Evaluating Worker {worker.id} ({worker.email}) "
        f"for Shift {shift.id} ('{shift.title}') at Venue {venue.id} ('{venue.name}')"
    )

    # --------------------------------------------------------------------------
    # Condition 1: Shift-Level Auto-Confirm
    # --------------------------------------------------------------------------
    if shift.is_shift_auto_confirm:
        logger.info(f"[Auto-Confirm Engine] Condition 1 MET: Shift is set to auto-confirm anyone.")
        await check_double_booking(db, worker.id, shift.start_time, shift.end_time, exclude_shift_id=shift.id)
        return RequestStatus.APPROVED, "shift_auto_confirm"

    # --------------------------------------------------------------------------
    # Condition 2: Venue Whitelist
    # --------------------------------------------------------------------------
    whitelist_entry = await db.scalar(
        select(VenueWhitelist).where(
            VenueWhitelist.venue_id == venue.id,
            VenueWhitelist.worker_id == worker.id,
            VenueWhitelist.is_active == True
        )
    )
    if whitelist_entry:
        logger.info(f"[Auto-Confirm Engine] Condition 2 MET: Worker is on Venue's trusted whitelist.")
        await check_double_booking(db, worker.id, shift.start_time, shift.end_time, exclude_shift_id=shift.id)
        return RequestStatus.APPROVED, "venue_whitelist"

    # --------------------------------------------------------------------------
    # Condition 3: Rating Threshold
    # --------------------------------------------------------------------------
    if venue.auto_approve_rating_threshold is not None:
        worker_rating = float(worker.aggregate_rating or 0.0)
        threshold = float(venue.auto_approve_rating_threshold)
        if worker_rating >= threshold:
            logger.info(
                f"[Auto-Confirm Engine] Condition 3 MET: Worker rating {worker_rating:.2f} >= "
                f"Venue threshold {threshold:.2f}."
            )
            await check_double_booking(db, worker.id, shift.start_time, shift.end_time, exclude_shift_id=shift.id)
            return RequestStatus.APPROVED, "rating_threshold"
        else:
            logger.info(
                f"[Auto-Confirm Engine] Condition 3 NOT MET: Worker rating {worker_rating:.2f} < "
                f"Venue threshold {threshold:.2f}."
            )

    # --------------------------------------------------------------------------
    # Condition 4: Fallback -> Pending Manager Review
    # --------------------------------------------------------------------------
    logger.info("[Auto-Confirm Engine] Condition 4: Fallback to PENDING review by Venue Manager.")
    return RequestStatus.PENDING, None

