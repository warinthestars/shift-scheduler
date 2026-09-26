from uuid import UUID
from datetime import datetime, date, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from sqlalchemy.orm import selectinload
from src.database import get_db
from src.models import (
    Shift, ShiftRequest, Venue, VenueWhitelist, VenueManager,
    User, RequestStatus, TimeEntry, ShiftBoardMessage, ShiftEvent
)
from src.schemas import (
    ShiftCreate, ShiftResponse, ShiftRequestResponse, ShiftRequestStatusUpdate,
    CheckInRequest, CheckOutRequest, TimeEntryResponse,
    ShiftBoardMessageCreate, ShiftBoardMessageResponse,
    EventCreate, EventPositionInput,
    ClockBody, ClockResult,
)
from src.auth import get_current_user, require_manager_or_admin, require_worker, normalize_role
from src.services.auto_confirm import evaluate_shift_request, check_double_booking
from src.services.shift_events import create_event_with_positions
from src.services.shift_views import to_shift_responses
from src.services.booking import request_position, withdraw_other_pending_in_event
from src.services.clock import clock_in, clock_out, auto_close_open_entries
from src.services import notify_events

router = APIRouter(prefix="/api/shifts", tags=["Shifts"])


@router.post("", response_model=ShiftResponse, status_code=status.HTTP_201_CREATED)
async def create_shift(
    shift_in: ShiftCreate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Task 4: Allow Venue Managers to create shifts for their assigned venues.
    Super Admins can post shifts to any venue.
    """
    # 1. Verify venue exists
    v_res = await db.execute(select(Venue).where(Venue.id == shift_in.venue_id))
    venue = v_res.scalar_one_or_none()
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")

    # 2. Verify manager authorization for this venue
    user_role = normalize_role(current_user.role)
    if user_role not in ("platform_admin", "super_admin"):
        mgr = await db.scalar(
            select(VenueManager).where(
                VenueManager.venue_id == shift_in.venue_id,
                VenueManager.user_id == current_user.id
            )
        )
        if not mgr:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not authorized to create shifts for this venue"
            )

    try:
        if shift_in.role_requirements:
            positions = [
                EventPositionInput(
                    role_type=r.role,
                    capacity=max(1, r.quantity),
                    hourly_rate=r.hourly_rate if r.hourly_rate is not None else (shift_in.hourly_rate or 25.0),
                    hourly_rate_max=r.hourly_rate_max,
                    hide_rate=bool(r.hide_rate),
                    tips_eligible=bool(r.tips_eligible),
                    tip_pool=bool(r.tips_eligible and r.tip_pool),
                    role_notes=r.role_notes,
                    approval_mode=r.approval_mode or ("auto" if shift_in.is_shift_auto_confirm else "venue_default"),
                )
                for r in shift_in.role_requirements
            ]
        else:
            positions = [EventPositionInput(
                role_type=shift_in.role_type or "Worker",
                capacity=shift_in.capacity or 1,
                hourly_rate=shift_in.hourly_rate or 25.0,
                tips_eligible=bool(shift_in.tips_eligible),
                tip_pool=bool(shift_in.tips_eligible and shift_in.tip_pool),
                approval_mode="auto" if shift_in.is_shift_auto_confirm else "venue_default",
            )]
        event = await create_event_with_positions(db, venue, current_user, EventCreate(
            venue_id=shift_in.venue_id,
            title=shift_in.title,
            start_time=shift_in.start_time,
            end_time=shift_in.end_time,
            notes=shift_in.description,
            positions=positions,
        ))
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create shift: {str(e)}")

    first_id = await db.scalar(
        select(Shift.id).where(Shift.event_id == event.id).order_by(Shift.created_at.asc()).limit(1)
    )
    result = await db.execute(select(Shift).options(selectinload(Shift.venue)).where(Shift.id == first_id))
    return result.scalar_one()

@router.get("/open", response_model=List[ShiftResponse])
async def get_open_shifts(
    role: Optional[str] = Query(None, description="Filter by role"),
    venue_id: Optional[UUID] = Query(None, description="Filter by Venue ID"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Fetch all open shifts on the call-board"""
    query = select(Shift).options(selectinload(Shift.venue)).where(Shift.status == "OPEN")
    if venue_id:
        query = query.where(Shift.venue_id == venue_id)
    if role:
        query = query.where(Shift.role_type.ilike(f"%{role}%"))
    query = query.order_by(Shift.start_time.asc())
    result = await db.execute(query)
    return await to_shift_responses(db, result.scalars().all(), current_user, worker_view=True)

@router.get("", response_model=List[ShiftResponse])
async def get_shifts(
    role: Optional[str] = Query(None, description="Filter by role (e.g. Bartender, Server)"),
    date_filter: Optional[date] = Query(None, alias="date", description="Filter by shift date (YYYY-MM-DD)"),
    venue_id: Optional[UUID] = Query(None, description="Filter by Venue ID"),
    status_filter: Optional[str] = Query("OPEN", alias="status", description="Filter by shift status"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Task 4: Allow Workers to fetch available shifts.
    Filterable by role, date, and venue.
    """
    query = select(Shift).options(selectinload(Shift.venue))

    if status_filter:
        query = query.where(Shift.status == status_filter.upper())
    if venue_id:
        query = query.where(Shift.venue_id == venue_id)
    if role:
        query = query.where(Shift.role_type.ilike(f"%{role}%"))
    if date_filter:
        query = query.where(func.date(Shift.start_time) == date_filter)

    query = query.order_by(Shift.start_time.asc())
    result = await db.execute(query)
    return await to_shift_responses(db, result.scalars().all(), current_user)

@router.post("/{shift_id}/request", response_model=ShiftRequestResponse, status_code=status.HTTP_201_CREATED)
async def request_shift(
    shift_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Task 4: CRITICAL LOGIC - Shift Request with Auto-Confirm Engine
    
    Executes evaluate_shift_request service:
    1. Check if shift has is_shift_auto_confirm == true -> APPROVED.
    2. Check if worker is in VenueWhitelist -> APPROVED.
    3. Check if worker.aggregate_rating >= venue.auto_approve_rating_threshold -> APPROVED.
    4. Fallback -> PENDING.
    """
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
            worker_view=True,
        )
        resp.shift = shown[0]
    return resp

# ------------------------------------------------------------------------------
# Request Management Functions
# ------------------------------------------------------------------------------
async def update_shift_request_status(
    request_id: UUID,
    status_update: ShiftRequestStatusUpdate,
    current_user: User,
    db: AsyncSession
) -> ShiftRequest:
    """Core update handler for manual approval or rejection of shift requests"""
    target_status = status_update.status.upper()
    if target_status not in ("APPROVED", "REJECTED"):
        raise HTTPException(status_code=400, detail="Status must be APPROVED or REJECTED")

    query = await db.execute(
        select(ShiftRequest)
        .options(selectinload(ShiftRequest.shift).selectinload(Shift.venue))
        .where(ShiftRequest.id == request_id)
    )
    shift_req = query.scalar_one_or_none()
    if not shift_req:
        raise HTTPException(status_code=404, detail="Shift request not found")

    shift = shift_req.shift
    user_role = normalize_role(current_user.role)

    # Verify authorization
    if user_role not in ("platform_admin", "super_admin"):
        mgr = await db.scalar(
            select(VenueManager).where(
                VenueManager.venue_id == shift.venue_id,
                VenueManager.user_id == current_user.id
            )
        )
        if not mgr:
            raise HTTPException(status_code=403, detail="Not authorized to manage requests for this venue")

    # Apply manual update
    prev_status = str(shift_req.status).lower()
    target_clean = target_status.lower()
    if target_clean == "approved" and prev_status != "approved":
        # Check double-booking before approving
        await check_double_booking(
            db=db,
            worker_id=shift_req.worker_id,
            start_time=shift.start_time,
            end_time=shift.end_time,
            exclude_shift_id=shift.id
        )
        if shift.spots_filled >= shift.capacity:
            raise HTTPException(status_code=400, detail="Cannot approve: shift capacity is reached")
        shift.spots_filled += 1
        if shift.spots_filled >= shift.capacity:
            shift.status = "FILLED"
        shift_req.status = "approved"
        shift_req.approval_source = "manager_manual"
        shift_req.approved_by_user_id = current_user.id
        shift_req.approved_at = datetime.utcnow()
        # Phase 26.1: booked on this position -> close their other waiting requests in the event
        await withdraw_other_pending_in_event(
            db, shift_req.worker_id, shift.event_id, shift.id,
            "Booked on another position for this event",
        )
    elif target_clean == "rejected":
        if prev_status == "approved":
            shift.spots_filled = max(0, shift.spots_filled - 1)
            shift.status = "OPEN"
        shift_req.status = "rejected"


    await db.commit()
    await db.refresh(shift_req)

    # Phase 28: tell the worker (after commit; never raises)
    if target_clean == "approved" and prev_status != "approved":
        await notify_events.request_decided(shift_req.id, True)
    elif target_clean == "rejected" and prev_status != "rejected":
        await notify_events.request_decided(shift_req.id, False)

    res = await db.execute(
        select(ShiftRequest)
        .options(
            selectinload(ShiftRequest.shift).selectinload(Shift.venue),
            selectinload(ShiftRequest.worker)
        )
        .where(ShiftRequest.id == shift_req.id)
    )
    return res.scalar_one()

# ------------------------------------------------------------------------------
# Dashboard and Shift History Helper Endpoints
# ------------------------------------------------------------------------------
@router.get("/my-shifts", response_model=List[ShiftRequestResponse])
async def get_my_shifts(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Retrieve all shift requests submitted by the logged-in worker (Phase 26.3: hidden pay masked)"""
    result = await db.execute(
        select(ShiftRequest)
        .options(
            selectinload(ShiftRequest.shift).selectinload(Shift.venue),
            selectinload(ShiftRequest.worker)
        )
        .where(ShiftRequest.worker_id == current_user.id)
        .order_by(ShiftRequest.created_at.desc())
    )
    reqs = result.scalars().all()
    booked = ("approved", "confirmed", "checked_in", "completed")
    shifts = [r.shift for r in reqs if r.shift is not None]
    reveal = {r.shift_id for r in reqs if (r.status or "").lower() in booked}
    shown = {
        sr.id: sr for sr in await to_shift_responses(
            db, shifts, current_user, reveal_shift_ids=reveal, worker_view=True,
        )
    }
    out = []
    for r in reqs:
        item = ShiftRequestResponse.model_validate(r)
        if r.shift_id in shown:
            item.shift = shown[r.shift_id]
        out.append(item)
    return out

@router.get("/stats/worker")
async def get_worker_dashboard_stats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Metrics for Worker Dashboard header cards"""
    open_shifts_res = await db.execute(select(Shift).where(Shift.status == "OPEN"))
    open_shifts_count = len(open_shifts_res.scalars().all())

    user_requests_res = await db.execute(
        select(ShiftRequest).where(ShiftRequest.worker_id == current_user.id)
    )
    user_requests = user_requests_res.scalars().all()

    pending_count = sum(1 for r in user_requests if str(r.status).lower() in ("pending", "pending_manager_approval"))
    upcoming_count = sum(1 for r in user_requests if str(r.status).lower() in ("approved", "confirmed"))
    completed_count = sum(1 for r in user_requests if str(r.status).lower() in ("completed", "checked_in")) or current_user.total_shifts

    return {
        "available_shifts_count": open_shifts_count,
        "upcoming_shifts_count": upcoming_count,
        "pending_requests_count": pending_count,
        "completed_shifts_count": completed_count,
        "rating_average": float(current_user.aggregate_rating),
        "rating_count": current_user.rating_count
    }

async def _my_request_response(db: AsyncSession, shift_id: UUID, user: User) -> ShiftRequest:
    res = await db.execute(
        select(ShiftRequest)
        .options(selectinload(ShiftRequest.shift).selectinload(Shift.venue))
        .where(ShiftRequest.shift_id == shift_id, ShiftRequest.worker_id == user.id)
    )
    req = res.scalar_one_or_none()
    if req is None:
        raise HTTPException(status_code=404, detail="Shift request not found")
    return req


@router.post("/{shift_id}/check-in", response_model=ShiftRequestResponse)
async def check_in_shift(
    shift_id: UUID,
    coords: CheckInRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Legacy alias. Phase 27: same rules as /clock-in (window + opt-in geofence)."""
    await clock_in(db, current_user, shift_id, ClockBody(latitude=coords.latitude, longitude=coords.longitude))
    return await _my_request_response(db, shift_id, current_user)

@router.post("/{shift_id}/check-out", response_model=ShiftRequestResponse)
async def check_out_shift(
    shift_id: UUID,
    coords: CheckOutRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Legacy alias. Phase 27: same rules as /clock-out."""
    await clock_out(db, current_user, shift_id, ClockBody(latitude=coords.latitude, longitude=coords.longitude))
    return await _my_request_response(db, shift_id, current_user)

# ------------------------------------------------------------------------------
# Phase 14: Shift Dropping & Roster Reallocation
# ------------------------------------------------------------------------------
@router.post("/{shift_id}/drop")
async def drop_shift(
    shift_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Phase 14, 15, 17: Drop a confirmed shift.
    1. Verify current_user is assigned to the shift.
    2. Datetime Normalization: Compare start_time with now_utc.
    3. Explicitly execute shift.available_spots += 1 and update status to 'dropped'.
    """
    # 1. Fetch shift
    shift = await db.scalar(select(Shift).where(Shift.id == shift_id))
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")

    # 2. Query assignment for current user
    shift_req = await db.scalar(
        select(ShiftRequest).where(
            ShiftRequest.shift_id == shift_id,
            ShiftRequest.worker_id == current_user.id,
            func.lower(ShiftRequest.status).in_(["approved", "confirmed"])
        )
    )
    if not shift_req:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Shift assignment not found or not in approved status."
        )

    # 3. Datetime Normalization
    now_utc = datetime.now(timezone.utc)
    shift_start = shift.start_time
    if isinstance(shift_start, str):
        shift_start = datetime.fromisoformat(shift_start.replace("Z", "+00:00"))
    if shift_start.tzinfo is None:
        shift_start = shift_start.replace(tzinfo=timezone.utc)

    time_to_start = (shift_start - now_utc).total_seconds()
    if time_to_start < 86400:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot drop shift within 24 hours of start time."
        )

    # 4. Database Transaction
    try:
        # Step 1: Update status of worker's ShiftRequest record to "dropped"
        shift_req.status = "dropped"
        shift_req.dropped_at = now_utc

        # Step 2: Decrement spots_filled
        shift.spots_filled = max(0, (shift.spots_filled or 1) - 1)
        if shift.status == "FILLED":
            shift.status = "OPEN"

        # Step 3: Commit transaction
        await db.commit()
        await db.refresh(shift_req)
        await db.refresh(shift)
    except Exception as e:
        await db.rollback()
        print(f"Drop shift transaction error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "detail": "Shift successfully dropped.",
        "message": "Shift successfully dropped.",
        "shift_id": str(shift_id),
        "status": "dropped"
    }


# ------------------------------------------------------------------------------
# Requests Approval Queue Router
# ------------------------------------------------------------------------------
requests_router = APIRouter(prefix="/api/requests", tags=["Requests"])

@requests_router.post("/{request_id}/approve", response_model=ShiftRequestResponse)
@requests_router.put("/{request_id}/approve", response_model=ShiftRequestResponse)
async def approve_request_endpoint(
    request_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """Approve a pending shift request"""
    return await update_shift_request_status(
        request_id=request_id,
        status_update=ShiftRequestStatusUpdate(status="APPROVED"),
        current_user=current_user,
        db=db
    )

@requests_router.post("/{request_id}/deny", response_model=ShiftRequestResponse)
@requests_router.put("/{request_id}/deny", response_model=ShiftRequestResponse)
async def deny_request_endpoint(
    request_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """Deny a pending shift request"""
    return await update_shift_request_status(
        request_id=request_id,
        status_update=ShiftRequestStatusUpdate(status="REJECTED"),
        current_user=current_user,
        db=db
    )

# ------------------------------------------------------------------------------
# Phase 13: Hour Tracking (Clock In / Clock Out)
# ------------------------------------------------------------------------------
@router.post("/{shift_id}/clock-in", response_model=ClockResult)
async def clock_in_shift_time(
    shift_id: UUID,
    body: Optional[ClockBody] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Phase 27: Clock in. Allowed from venue.clock_in_early_minutes before start until the scheduled end.
    If the location check is on for this event, body must carry latitude/longitude:
    inside radius = on site, inside radius + buffer = accepted but flagged, beyond = blocked.
    """
    return await clock_in(db, current_user, shift_id, body)

@router.post("/{shift_id}/clock-out", response_model=ClockResult)
async def clock_out_shift_time(
    shift_id: UUID,
    body: Optional[ClockBody] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Phase 27: Clock out. Never blocked by location (only flagged). Under a minute = undo."""
    return await clock_out(db, current_user, shift_id, body)

@router.get("/{shift_id}/time-entry", response_model=Optional[TimeEntryResponse])
async def get_shift_time_entry(
    shift_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Retrieve active or latest time entry for the user and shift"""
    res = await db.execute(
        select(TimeEntry)
        .where(TimeEntry.shift_id == shift_id, TimeEntry.worker_id == current_user.id)
        .order_by(TimeEntry.clock_in_time.desc())
    )
    return res.scalar_one_or_none()

@router.get("/time-entries/active", response_model=List[TimeEntryResponse])
async def get_my_active_time_entries(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Retrieve all open clock-ins for current worker"""
    await auto_close_open_entries(db, worker_id=current_user.id)   # Phase 27
    res = await db.execute(
        select(TimeEntry)
        .where(
            TimeEntry.worker_id == current_user.id,
            TimeEntry.clock_out_time.is_(None)
        )
    )
    return res.scalars().all()

# ------------------------------------------------------------------------------
# Phase 13: Event-Specific Discussion Boards
# ------------------------------------------------------------------------------
async def verify_shift_message_access(shift: Shift, user: User, db: AsyncSession) -> None:
    """Ensure user is assigned to shift, or is a venue manager / super admin"""
    user_role = normalize_role(user.role)
    if user_role in ("platform_admin", "super_admin"):
        return

    if user_role == "venue_manager":
        mgr = await db.scalar(
            select(VenueManager).where(
                VenueManager.venue_id == shift.venue_id,
                VenueManager.user_id == user.id
            )
        )
        if mgr:
            return
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to view messages for this venue."
        )

    # Worker access: Must hold an assigned / confirmed request
    req = await db.scalar(
        select(ShiftRequest).where(
            ShiftRequest.shift_id == shift.id,
            ShiftRequest.worker_id == user.id,
            func.lower(ShiftRequest.status).in_([
                "approved", "checked_in", "completed", "confirmed"
            ])
        )
    )
    if not req:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only assigned workers and venue managers may access this shift discussion board."
        )

@router.get("/{shift_id}/messages", response_model=List[ShiftBoardMessageResponse])
async def get_shift_messages(
    shift_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Task 4: Return chronological list of messages for this shift.
    Authorization: User is assigned to shift, or is a venue manager for the parent venue.
    """
    shift = await db.scalar(select(Shift).where(Shift.id == shift_id))
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")

    await verify_shift_message_access(shift, current_user, db)

    res = await db.execute(
        select(ShiftBoardMessage)
        .options(selectinload(ShiftBoardMessage.author))
        .where(ShiftBoardMessage.shift_id == shift_id)
        .order_by(ShiftBoardMessage.created_at.asc())
    )
    return res.scalars().all()

@router.post("/{shift_id}/messages", response_model=ShiftBoardMessageResponse, status_code=status.HTTP_201_CREATED)
async def post_shift_message(
    shift_id: UUID,
    msg_in: ShiftBoardMessageCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Task 4: Post a new message to the shift's discussion board.
    """
    shift = await db.scalar(select(Shift).where(Shift.id == shift_id))
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")

    await verify_shift_message_access(shift, current_user, db)

    msg = ShiftBoardMessage(
        shift_id=shift_id,
        author_id=current_user.id,
        content=msg_in.content.strip()
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)

    res = await db.execute(
        select(ShiftBoardMessage)
        .options(selectinload(ShiftBoardMessage.author))
        .where(ShiftBoardMessage.id == msg.id)
    )
    return res.scalar_one()

@router.delete("/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
@router.delete("/{shift_id}/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_shift_message_from_shift(
    message_id: UUID,
    shift_id: Optional[UUID] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Delete a shift message (moderation)"""
    return await delete_shift_message(message_id=message_id, current_user=current_user, db=db)

# ------------------------------------------------------------------------------
# Messages Deletion Router (DELETE /api/messages/{message_id})
# ------------------------------------------------------------------------------
messages_router = APIRouter(prefix="/api/messages", tags=["Messages"])

@messages_router.delete("/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_shift_message(
    message_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Task 4: Allows Venue Managers (or Admins) to delete any message.
    """
    res = await db.execute(
        select(ShiftBoardMessage)
        .options(selectinload(ShiftBoardMessage.shift))
        .where(ShiftBoardMessage.id == message_id)
    )
    msg = res.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    user_role = normalize_role(current_user.role)
    if user_role not in ("platform_admin", "super_admin"):
        if user_role != "venue_manager":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only Venue Managers can delete messages."
            )
        mgr = await db.scalar(
            select(VenueManager).where(
                VenueManager.venue_id == msg.shift.venue_id,
                VenueManager.user_id == current_user.id
            )
        )
        if not mgr:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not manage the venue for this shift's board."
            )

    await db.delete(msg)
    await db.commit()


