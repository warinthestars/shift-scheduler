import math
from uuid import UUID
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_
from sqlalchemy.orm import selectinload
from src.database import get_db
from src.models import Shift, ShiftRequest, Venue, VenueWhitelist, User
from src.schemas import (
    ShiftCreate, ShiftUpdate, ShiftResponse, ShiftRequestResponse,
    CheckInRequest, CheckOutRequest
)
from src.auth import get_current_user, require_manager_or_admin

router = APIRouter(prefix="/api/shifts", tags=["Shifts"])

def haversine_distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great-circle distance between two points on the Earth in meters"""
    r = 6371000.0  # Earth radius in meters
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (math.sin(d_lat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(d_lon / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r * c

@router.get("", response_model=List[ShiftResponse])
async def list_shifts(
    venue_id: Optional[UUID] = None,
    role_required: Optional[str] = None,
    status_filter: Optional[str] = "open",
    db: AsyncSession = Depends(get_db)
):
    """List open and scheduled shifts with venue details"""
    query = select(Shift).options(selectinload(Shift.venue))
    if venue_id:
        query = query.where(Shift.venue_id == venue_id)
    if role_required:
        query = query.where(Shift.role_required.ilike(f"%{role_required}%"))
    if status_filter:
        query = query.where(Shift.status == status_filter)

    query = query.order_by(Shift.start_time.asc())
    result = await db.execute(query)
    return result.scalars().all()

@router.get("/my-shifts", response_model=List[ShiftRequestResponse])
async def get_my_shifts(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Retrieve all shift applications and assignments for the current worker"""
    result = await db.execute(
        select(ShiftRequest)
        .options(
            selectinload(ShiftRequest.shift).selectinload(Shift.venue)
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
    """Dynamic counts and summary metrics for Worker Dashboard"""
    now = datetime.utcnow()

    # Total open shifts available on the board
    open_shifts_result = await db.execute(
        select(Shift).where(Shift.status == "open", Shift.start_time > now)
    )
    open_shifts_count = len(open_shifts_result.scalars().all())

    # User shift requests
    requests_result = await db.execute(
        select(ShiftRequest).where(ShiftRequest.worker_id == current_user.id)
    )
    user_requests = requests_result.scalars().all()

    pending_count = sum(1 for r in user_requests if r.status == "pending")
    approved_upcoming_count = sum(1 for r in user_requests if r.status == "approved")
    completed_count = sum(1 for r in user_requests if r.status == "completed") or current_user.total_shifts_completed

    return {
        "available_shifts_count": open_shifts_count,
        "upcoming_shifts_count": approved_upcoming_count,
        "pending_requests_count": pending_count,
        "completed_shifts_count": completed_count,
        "rating_average": float(current_user.rating_average),
        "rating_count": current_user.rating_count
    }

@router.post("", response_model=ShiftResponse, status_code=status.HTTP_201_CREATED)
async def create_shift(
    shift_in: ShiftCreate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """Post a new shift to the call-board (Venue Managers / Super Admin)"""
    # Verify venue exists
    v_res = await db.execute(select(Venue).where(Venue.id == shift_in.venue_id))
    venue = v_res.scalar_one_or_none()
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")

    shift = Shift(
        **shift_in.model_dump(),
        created_by_user_id=current_user.id
    )
    db.add(shift)
    await db.commit()
    await db.refresh(shift)

    # Load relationship for response
    result = await db.execute(
        select(Shift).options(selectinload(Shift.venue)).where(Shift.id == shift.id)
    )
    return result.scalar_one()

@router.get("/{shift_id}", response_model=ShiftResponse)
async def get_shift(shift_id: UUID, db: AsyncSession = Depends(get_db)):
    """Retrieve details for a single shift"""
    result = await db.execute(
        select(Shift).options(selectinload(Shift.venue)).where(Shift.id == shift_id)
    )
    shift = result.scalar_one_or_none()
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")
    return shift

@router.put("/{shift_id}", response_model=ShiftResponse)
async def update_shift(
    shift_id: UUID,
    shift_in: ShiftUpdate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """Update shift details"""
    result = await db.execute(select(Shift).where(Shift.id == shift_id))
    shift = result.scalar_one_or_none()
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")

    update_data = shift_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(shift, field, value)

    await db.commit()

    reloaded = await db.execute(
        select(Shift).options(selectinload(Shift.venue)).where(Shift.id == shift_id)
    )
    return reloaded.scalar_one()

# ------------------------------------------------------------------------------
# The Auto-Confirm Engine
# ------------------------------------------------------------------------------
@router.post("/{shift_id}/request", response_model=ShiftRequestResponse, status_code=status.HTTP_201_CREATED)
async def request_shift(
    shift_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Request a shift with the Auto-Confirm Engine:
    1. Check if shift is auto-confirm -> assign (APPROVED).
    2. Check if user is on venue whitelist -> assign (APPROVED).
    3. Check if user rating >= venue auto-approve threshold -> assign (APPROVED).
    4. Fallback -> set status to PENDING.
    """
    # 1. Fetch shift and associated venue
    shift_res = await db.execute(
        select(Shift).options(selectinload(Shift.venue)).where(Shift.id == shift_id)
    )
    shift = shift_res.scalar_one_or_none()
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")

    if shift.status in ("filled", "completed", "cancelled"):
        raise HTTPException(status_code=400, detail=f"Shift is currently {shift.status}")

    if shift.spots_filled >= shift.spots_needed:
        raise HTTPException(status_code=400, detail="This shift is already fully staffed")

    # 2. Check existing request
    existing_req = await db.scalar(
        select(ShiftRequest).where(
            ShiftRequest.shift_id == shift_id,
            ShiftRequest.worker_id == current_user.id
        )
    )
    if existing_req:
        raise HTTPException(
            status_code=400,
            detail=f"You already have a request for this shift (status: {existing_req.status})"
        )

    venue = shift.venue
    is_approved = False
    approval_source = None

    # --------------------------------------------------------------------------
    # Step 1: Shift-Level Auto-Confirm
    # --------------------------------------------------------------------------
    if shift.auto_confirm_anyone:
        is_approved = True
        approval_source = "shift_auto_confirm"

    # --------------------------------------------------------------------------
    # Step 2: Venue Whitelist
    # --------------------------------------------------------------------------
    if not is_approved and venue:
        whitelist_match = await db.scalar(
            select(VenueWhitelist).where(
                VenueWhitelist.venue_id == venue.id,
                VenueWhitelist.worker_id == current_user.id,
                VenueWhitelist.is_active == True
            )
        )
        if whitelist_match:
            is_approved = True
            approval_source = "venue_whitelist"

    # --------------------------------------------------------------------------
    # Step 3: Rating Threshold
    # --------------------------------------------------------------------------
    if not is_approved and venue:
        threshold = shift.min_rating_override or venue.global_auto_approve_min_rating
        if threshold is not None:
            if float(current_user.rating_average) >= float(threshold):
                is_approved = True
                approval_source = "rating_threshold"

    # --------------------------------------------------------------------------
    # Step 4: Fallback
    # --------------------------------------------------------------------------
    req_status = "approved" if is_approved else "pending"

    # If approved, update shift spots
    if is_approved:
        shift.spots_filled += 1
        if shift.spots_filled >= shift.spots_needed:
            shift.status = "filled"

    new_request = ShiftRequest(
        shift_id=shift.id,
        worker_id=current_user.id,
        status=req_status,
        approval_source=approval_source,
        approved_by_user_id=None if is_approved else None,
        approved_at=datetime.utcnow() if is_approved else None
    )
    db.add(new_request)
    await db.commit()
    await db.refresh(new_request)

    # Return request with shift & venue populated
    response_query = await db.execute(
        select(ShiftRequest)
        .options(selectinload(ShiftRequest.shift).selectinload(Shift.venue))
        .where(ShiftRequest.id == new_request.id)
    )
    return response_query.scalar_one()

# ------------------------------------------------------------------------------
# Check-In / Check-Out with Geofence Validation
# ------------------------------------------------------------------------------
@router.post("/{shift_id}/check-in", response_model=ShiftRequestResponse)
async def check_in_shift(
    shift_id: UUID,
    coords: CheckInRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Check in to an approved shift validating worker GPS coordinates against venue geofence"""
    res = await db.execute(
        select(ShiftRequest)
        .options(selectinload(ShiftRequest.shift).selectinload(Shift.venue))
        .where(ShiftRequest.shift_id == shift_id, ShiftRequest.worker_id == current_user.id)
    )
    shift_req = res.scalar_one_or_none()
    if not shift_req:
        raise HTTPException(status_code=404, detail="No shift request found")

    if shift_req.status != "approved":
        raise HTTPException(status_code=400, detail="Only approved shifts can be checked into")

    venue = shift_req.shift.venue
    dist_meters = haversine_distance_meters(
        coords.latitude, coords.longitude,
        venue.latitude, venue.longitude
    )

    is_verified = dist_meters <= venue.geofence_radius_meters

    shift_req.check_in_time = datetime.utcnow()
    shift_req.check_in_lat = coords.latitude
    shift_req.check_in_lng = coords.longitude
    shift_req.check_in_verified = is_verified
    shift_req.shift.status = "in_progress"

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
    """Check out of a shift with GPS coordinates and complete shift"""
    res = await db.execute(
        select(ShiftRequest)
        .options(selectinload(ShiftRequest.shift).selectinload(Shift.venue))
        .where(ShiftRequest.shift_id == shift_id, ShiftRequest.worker_id == current_user.id)
    )
    shift_req = res.scalar_one_or_none()
    if not shift_req:
        raise HTTPException(status_code=404, detail="No shift request found")

    venue = shift_req.shift.venue
    dist_meters = haversine_distance_meters(
        coords.latitude, coords.longitude,
        venue.latitude, venue.longitude
    )

    is_verified = dist_meters <= venue.geofence_radius_meters

    shift_req.check_out_time = datetime.utcnow()
    shift_req.check_out_lat = coords.latitude
    shift_req.check_out_lng = coords.longitude
    shift_req.check_out_verified = is_verified
    shift_req.status = "completed"
    shift_req.shift.status = "completed"

    current_user.total_shifts_completed += 1

    await db.commit()
    await db.refresh(shift_req)
    return shift_req
