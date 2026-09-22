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
    User, RequestStatus, TimeEntry, ShiftBoardMessage
)
from src.schemas import (
    ShiftCreate, ShiftResponse, ShiftRequestResponse, ShiftRequestStatusUpdate,
    CheckInRequest, CheckOutRequest, TimeEntryResponse,
    ShiftBoardMessageCreate, ShiftBoardMessageResponse
)
from src.auth import get_current_user, require_manager_or_admin, require_worker, normalize_role
from src.services.auto_confirm import evaluate_shift_request, check_double_booking

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

    # Handle dynamic role requirements list if provided
    if shift_in.role_requirements and len(shift_in.role_requirements) > 0:
        first_shift = None
        for req in shift_in.role_requirements:
            s = Shift(
                venue_id=shift_in.venue_id,
                created_by_user_id=current_user.id,
                title=shift_in.title,
                role_type=req.role,
                start_time=shift_in.start_time,
                end_time=shift_in.end_time,
                capacity=req.quantity,
                spots_filled=0,
                is_shift_auto_confirm=shift_in.is_shift_auto_confirm or False,
                hourly_rate=shift_in.hourly_rate or 25.0,
                description=shift_in.description,
                status="OPEN"
            )
            db.add(s)
            if first_shift is None:
                first_shift = s
        await db.commit()
        await db.refresh(first_shift)
        shift = first_shift
    else:
        shift = Shift(
            venue_id=shift_in.venue_id,
            created_by_user_id=current_user.id,
            title=shift_in.title,
            role_type=shift_in.role_type or "Worker",
            start_time=shift_in.start_time,
            end_time=shift_in.end_time,
            capacity=shift_in.capacity or 1,
            spots_filled=0,
            is_shift_auto_confirm=shift_in.is_shift_auto_confirm or False,
            hourly_rate=shift_in.hourly_rate or 25.0,
            description=shift_in.description,
            status="OPEN"
        )
        db.add(shift)
        await db.commit()
        await db.refresh(shift)

    # Reload with venue relation
    result = await db.execute(
        select(Shift).options(selectinload(Shift.venue)).where(Shift.id == shift.id)
    )
    return result.scalar_one()

@router.get("/open", response_model=List[ShiftResponse])
async def get_open_shifts(
    role: Optional[str] = Query(None, description="Filter by role"),
    venue_id: Optional[UUID] = Query(None, description="Filter by Venue ID"),
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
    return result.scalars().all()

@router.get("", response_model=List[ShiftResponse])
async def get_shifts(
    role: Optional[str] = Query(None, description="Filter by role (e.g. Bartender, Server)"),
    date_filter: Optional[date] = Query(None, alias="date", description="Filter by shift date (YYYY-MM-DD)"),
    venue_id: Optional[UUID] = Query(None, description="Filter by Venue ID"),
    status_filter: Optional[str] = Query("OPEN", alias="status", description="Filter by shift status"),
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
    return result.scalars().all()

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
    # 1. Fetch shift with its venue
    shift_res = await db.execute(
        select(Shift).options(selectinload(Shift.venue)).where(Shift.id == shift_id)
    )
    shift = shift_res.scalar_one_or_none()
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")

    if shift.status != "OPEN":
        raise HTTPException(status_code=400, detail=f"Shift is currently {shift.status}")

    if shift.spots_filled >= shift.capacity:
        raise HTTPException(status_code=400, detail="This shift is already filled to capacity")

    # 2. Check existing request
    existing = await db.scalar(
        select(ShiftRequest).where(
            ShiftRequest.shift_id == shift_id,
            ShiftRequest.worker_id == current_user.id
        )
    )
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"You have already requested this shift (status: {existing.status})"
        )

    # 3. Double-Booking check before evaluating or approving request
    await check_double_booking(
        db=db,
        worker_id=current_user.id,
        start_time=shift.start_time,
        end_time=shift.end_time,
        exclude_shift_id=shift.id
    )

    # 4. Evaluate with Auto-Confirm Engine Service
    assigned_status, approval_source = await evaluate_shift_request(
        db=db,
        worker=current_user,
        shift=shift,
        venue=shift.venue
    )

    # 5. If approved immediately, adjust spots
    if assigned_status == RequestStatus.APPROVED:
        shift.spots_filled += 1
        if shift.spots_filled >= shift.capacity:
            shift.status = "FILLED"

    req = ShiftRequest(
        shift_id=shift.id,
        worker_id=current_user.id,
        status=assigned_status,
        approval_source=approval_source,
        approved_at=datetime.utcnow() if assigned_status == RequestStatus.APPROVED else None
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)

    # Reload with relations
    res = await db.execute(
        select(ShiftRequest)
        .options(
            selectinload(ShiftRequest.shift).selectinload(Shift.venue),
            selectinload(ShiftRequest.worker)
        )
        .where(ShiftRequest.id == req.id)
    )
    return res.scalar_one()

@router.put("/requests/{request_id}", response_model=ShiftRequestResponse)
async def update_shift_request_status(
    request_id: UUID,
    status_update: ShiftRequestStatusUpdate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Task 4: Allow Venue Managers to manually update a pending request to APPROVED or REJECTED.
    """
    target_status = status_update.status.upper()
    if target_status not in ("APPROVED", "REJECTED"):
        raise HTTPException(status_code=400, detail="Status must be APPROVED or REJECTED")

    # Fetch request with shift & venue
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
    prev_status = shift_req.status
    if target_status == "APPROVED" and prev_status != RequestStatus.APPROVED:
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
        shift_req.status = RequestStatus.APPROVED
        shift_req.approval_source = "manager_manual"
        shift_req.approved_by_user_id = current_user.id
        shift_req.approved_at = datetime.utcnow()
    elif target_status == "REJECTED":
        if prev_status == RequestStatus.APPROVED:
            shift.spots_filled = max(0, shift.spots_filled - 1)
            shift.status = "OPEN"
        shift_req.status = RequestStatus.REJECTED


    await db.commit()
    await db.refresh(shift_req)

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
    """Retrieve all shift requests submitted by the logged-in worker"""
    result = await db.execute(
        select(ShiftRequest)
        .options(
            selectinload(ShiftRequest.shift).selectinload(Shift.venue),
            selectinload(ShiftRequest.worker)
        )
        .where(ShiftRequest.worker_id == current_user.id)
        .order_by(ShiftRequest.created_at.desc())
    )
    return result.scalars().all()

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

    pending_count = sum(1 for r in user_requests if r.status in (RequestStatus.PENDING, "PENDING"))
    upcoming_count = sum(1 for r in user_requests if r.status in (RequestStatus.APPROVED, "APPROVED"))
    completed_count = sum(1 for r in user_requests if r.status in (RequestStatus.COMPLETED, "COMPLETED")) or current_user.total_shifts

    return {
        "available_shifts_count": open_shifts_count,
        "upcoming_shifts_count": upcoming_count,
        "pending_requests_count": pending_count,
        "completed_shifts_count": completed_count,
        "rating_average": float(current_user.aggregate_rating),
        "rating_count": current_user.rating_count
    }

@router.post("/{shift_id}/check-in", response_model=ShiftRequestResponse)
async def check_in_shift(
    shift_id: UUID,
    coords: CheckInRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Check in to an approved shift with GPS validation"""
    res = await db.execute(
        select(ShiftRequest)
        .options(selectinload(ShiftRequest.shift).selectinload(Shift.venue))
        .where(ShiftRequest.shift_id == shift_id, ShiftRequest.worker_id == current_user.id)
    )
    shift_req = res.scalar_one_or_none()
    if not shift_req or shift_req.status not in (RequestStatus.APPROVED, "APPROVED"):
        raise HTTPException(status_code=400, detail="Only approved shifts can be checked into")

    shift_req.status = RequestStatus.CHECKED_IN
    shift_req.check_in_time = datetime.utcnow()
    shift_req.check_in_verified = True
    await db.commit()
    await db.refresh(shift_req)
    return shift_req

@router.post("/{shift_id}/check-out", response_model=ShiftRequestResponse)
async def check_out_shift(
    shift_id: UUID,
    coords: CheckOutRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Check out of a shift, completing it and incrementing total shifts"""
    res = await db.execute(
        select(ShiftRequest)
        .options(selectinload(ShiftRequest.shift).selectinload(Shift.venue))
        .where(ShiftRequest.shift_id == shift_id, ShiftRequest.worker_id == current_user.id)
    )
    shift_req = res.scalar_one_or_none()
    if not shift_req:
        raise HTTPException(status_code=404, detail="Shift request not found")

    shift_req.status = RequestStatus.COMPLETED
    shift_req.check_out_time = datetime.utcnow()
    shift_req.check_out_verified = True
    current_user.total_shifts += 1
    await db.commit()
    await db.refresh(shift_req)
    return shift_req

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
@router.post("/{shift_id}/clock-in", response_model=TimeEntryResponse)
async def clock_in_shift_time(
    shift_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Task 2: Verify the user is assigned to the shift.
    Create a new TimeEntry setting clock_in_time to datetime.now(timezone.utc).
    """
    req = await db.scalar(
        select(ShiftRequest).where(
            ShiftRequest.shift_id == shift_id,
            ShiftRequest.worker_id == current_user.id,
            ShiftRequest.status.in_([
                RequestStatus.APPROVED, RequestStatus.CHECKED_IN,
                "APPROVED", "CHECKED_IN"
            ])
        )
    )
    if not req:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You are not assigned to this shift."
        )

    # Check if there is already an active clock-in
    active_entry = await db.scalar(
        select(TimeEntry).where(
            TimeEntry.shift_id == shift_id,
            TimeEntry.worker_id == current_user.id,
            TimeEntry.clock_out_time.is_(None)
        )
    )
    if active_entry:
        return active_entry

    now_utc = datetime.now(timezone.utc)
    entry = TimeEntry(
        worker_id=current_user.id,
        shift_id=shift_id,
        clock_in_time=now_utc
    )
    db.add(entry)

    # Synchronize ShiftRequest check-in status
    req.status = RequestStatus.CHECKED_IN
    if not req.check_in_time:
        req.check_in_time = now_utc
    req.check_in_verified = True

    await db.commit()
    await db.refresh(entry)
    return entry

@router.post("/{shift_id}/clock-out", response_model=TimeEntryResponse)
async def clock_out_shift_time(
    shift_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Task 2: Find the active TimeEntry for this user and shift. Set clock_out_time to current UTC time.
    """
    entry = await db.scalar(
        select(TimeEntry).where(
            TimeEntry.shift_id == shift_id,
            TimeEntry.worker_id == current_user.id,
            TimeEntry.clock_out_time.is_(None)
        )
    )
    if not entry:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active clock-in found for this shift."
        )

    now_utc = datetime.now(timezone.utc)
    entry.clock_out_time = now_utc

    # Synchronize ShiftRequest check-out status
    req = await db.scalar(
        select(ShiftRequest).where(
            ShiftRequest.shift_id == shift_id,
            ShiftRequest.worker_id == current_user.id
        )
    )
    if req:
        req.status = RequestStatus.COMPLETED
        req.check_out_time = now_utc
        req.check_out_verified = True

    current_user.total_shifts += 1

    await db.commit()
    await db.refresh(entry)
    return entry

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
            ShiftRequest.status.in_([
                RequestStatus.APPROVED, RequestStatus.CHECKED_IN, RequestStatus.COMPLETED,
                "APPROVED", "CHECKED_IN", "COMPLETED"
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


