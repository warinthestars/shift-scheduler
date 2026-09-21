import logging
from typing import Tuple, Optional
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.models import Shift, Venue, VenueWhitelist, ShiftRequest, User, RequestStatus

logger = logging.getLogger("shiftboard.auto_confirm")

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
