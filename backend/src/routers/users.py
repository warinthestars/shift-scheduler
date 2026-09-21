from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Optional
from src.database import get_db
from src.models import User
from src.schemas import UserResponse, UserUpdateProfile, UserBrief
from src.auth import get_current_user, require_admin

router = APIRouter(prefix="/api/users", tags=["Users"])

@router.get("/profile", response_model=UserResponse)
async def get_my_profile(current_user: User = Depends(get_current_user)):
    """Retrieve logged in worker/manager profile with ratings and stats"""
    return current_user

@router.put("/profile", response_model=UserResponse)
async def update_my_profile(
    profile_update: UserUpdateProfile,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Update profile details (bio, skills, phone, avatar)"""
    update_data = profile_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(current_user, field, value)

    await db.commit()
    await db.refresh(current_user)
    return current_user

@router.get("", response_model=List[UserBrief])
async def list_users(
    role: Optional[str] = Query(None, description="Filter users by role"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """List users, filtered by role (e.g., workers or managers)"""
    query = select(User)
    if role:
        query = query.where(User.role == role)
    query = query.order_by(User.first_name, User.last_name)

    result = await db.execute(query)
    users = result.scalars().all()
    return users
