from typing import List, Optional, Any, Dict
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from src.database import get_db
from src.models import User, ShiftRequest, Shift, Venue, Rating
from src.schemas import UserResponse, UserUpdateMe, UserBrief
from src.auth import get_current_user

router = APIRouter(prefix="/api/users", tags=["Users"])

@router.get("/me")
async def get_my_profile_and_experience(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Task 2: Return the logged-in user's profile and experience history
    (completed shifts, venues worked, and ratings received).
    """
    # Load completed shift history
    shifts_query = await db.execute(
        select(ShiftRequest)
        .options(
            selectinload(ShiftRequest.shift).selectinload(Shift.venue),
            selectinload(ShiftRequest.rating)
        )
        .where(ShiftRequest.worker_id == current_user.id)
        .order_by(ShiftRequest.created_at.desc())
    )
    shift_requests = shifts_query.scalars().all()

    experience_history = []
    past_venues_set = set()

    for req in shift_requests:
        venue_name = req.shift.venue.name if req.shift and req.shift.venue else "Unknown Venue"
        if req.status in ("COMPLETED", "completed"):
            past_venues_set.add(venue_name)

        experience_history.append({
            "request_id": str(req.id),
            "shift_id": str(req.shift_id),
            "shift_title": req.shift.title if req.shift else "Shift",
            "venue_name": venue_name,
            "role_type": req.shift.role_type if req.shift else "",
            "status": req.status.value if hasattr(req.status, "value") else str(req.status),
            "approval_source": req.approval_source,
            "start_time": req.shift.start_time.isoformat() if req.shift and req.shift.start_time else None,
            "end_time": req.shift.end_time.isoformat() if req.shift and req.shift.end_time else None,
            "check_in_time": req.check_in_time.isoformat() if req.check_in_time else None,
            "check_out_time": req.check_out_time.isoformat() if req.check_out_time else None,
            "rating_given": req.rating.rating if req.rating else None,
            "review": req.rating.review if req.rating else None,
        })

    user_data = UserResponse.model_validate(current_user).model_dump()
    user_data["experience_history"] = experience_history
    user_data["past_venues"] = list(past_venues_set)
    return user_data

@router.put("/me", response_model=UserResponse)
async def update_my_profile(
    profile_update: UserUpdateMe,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Task 2: Allow updating bio, avatar (placeholder for R2), and basic info.
    """
    update_data = profile_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(current_user, field, value)

    await db.commit()
    await db.refresh(current_user)
    return current_user

# Aliases for Phase 2 compatibility
@router.get("/profile", response_model=UserResponse)
async def get_profile_alias(current_user: User = Depends(get_current_user)):
    return current_user

@router.put("/profile", response_model=UserResponse)
async def update_profile_alias(
    profile_update: UserUpdateMe,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    return await update_my_profile(profile_update, current_user, db)

@router.get("", response_model=List[UserBrief])
async def list_users(
    role: Optional[str] = Query(None, description="Filter users by role"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """List registered users (for manager assignments or worker search)"""
    query = select(User)
    if role:
        query = query.where(User.role == role.upper())
    query = query.order_by(User.first_name, User.last_name)

    result = await db.execute(query)
    return result.scalars().all()
