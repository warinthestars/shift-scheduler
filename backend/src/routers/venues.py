from uuid import UUID
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from src.database import get_db
from src.models import Venue, VenueManager, VenueWhitelist, User
from src.schemas import (
    VenueCreate, VenueUpdate, VenueResponse,
    VenueManagerAssign, WhitelistCreate, WhitelistResponse
)
from src.auth import get_current_user, require_admin, require_manager_or_admin

router = APIRouter(prefix="/api/venues", tags=["Venues"])

@router.get("", response_model=List[VenueResponse])
async def list_venues(db: AsyncSession = Depends(get_db)):
    """List all registered venues"""
    result = await db.execute(select(Venue).order_by(Venue.name))
    return result.scalars().all()

@router.post("", response_model=VenueResponse, status_code=status.HTTP_201_CREATED)
async def create_venue(
    venue_in: VenueCreate,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """Create a new venue (Super Admin restricted)"""
    venue = Venue(**venue_in.model_dump())
    db.add(venue)
    await db.commit()
    await db.refresh(venue)

    # Automatically assign the creator as a manager
    manager = VenueManager(venue_id=venue.id, user_id=current_user.id, is_primary=True)
    db.add(manager)
    await db.commit()

    return venue

@router.get("/{venue_id}", response_model=VenueResponse)
async def get_venue(venue_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get venue details by ID"""
    result = await db.execute(select(Venue).where(Venue.id == venue_id))
    venue = result.scalar_one_or_none()
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")
    return venue

@router.put("/{venue_id}", response_model=VenueResponse)
async def update_venue(
    venue_id: UUID,
    venue_in: VenueUpdate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """Update venue settings (auto-approve threshold, radius, details)"""
    result = await db.execute(select(Venue).where(Venue.id == venue_id))
    venue = result.scalar_one_or_none()
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")

    update_data = venue_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(venue, field, value)

    await db.commit()
    await db.refresh(venue)
    return venue

@router.delete("/{venue_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_venue(
    venue_id: UUID,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """Delete a venue (Super Admin restricted)"""
    result = await db.execute(select(Venue).where(Venue.id == venue_id))
    venue = result.scalar_one_or_none()
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")

    await db.delete(venue)
    await db.commit()

@router.post("/{venue_id}/managers", status_code=status.HTTP_200_OK)
async def assign_venue_manager(
    venue_id: UUID,
    assign_in: VenueManagerAssign,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """Assign a manager to a venue (Super Admin restricted)"""
    # Verify venue
    v_res = await db.execute(select(Venue).where(Venue.id == venue_id))
    if not v_res.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Venue not found")

    # Verify target user
    u_res = await db.execute(select(User).where(User.id == assign_in.user_id))
    target_user = u_res.scalar_one_or_none()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    # Update role to venue_manager if currently worker
    if target_user.role == "worker":
        target_user.role = "venue_manager"

    manager = VenueManager(
        venue_id=venue_id,
        user_id=assign_in.user_id,
        is_primary=assign_in.is_primary
    )
    db.add(manager)
    await db.commit()
    return {"message": f"Assigned {target_user.email} as manager to venue"}

@router.get("/{venue_id}/whitelist", response_model=List[WhitelistResponse])
async def get_venue_whitelist(
    venue_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """Get active whitelisted workers for this venue"""
    result = await db.execute(
        select(VenueWhitelist)
        .options(selectinload(VenueWhitelist.worker))
        .where(VenueWhitelist.venue_id == venue_id, VenueWhitelist.is_active == True)
    )
    return result.scalars().all()

@router.post("/{venue_id}/whitelist", response_model=WhitelistResponse)
async def add_worker_to_whitelist(
    venue_id: UUID,
    wl_in: WhitelistCreate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """Add a worker to the venue's trusted whitelist (Condition 2 of hierarchy)"""
    existing = await db.scalar(
        select(VenueWhitelist).where(
            VenueWhitelist.venue_id == venue_id,
            VenueWhitelist.worker_id == wl_in.worker_id
        )
    )
    if existing:
        existing.is_active = True
        existing.notes = wl_in.notes or existing.notes
        await db.commit()
        await db.refresh(existing)
        return existing

    new_entry = VenueWhitelist(
        venue_id=venue_id,
        worker_id=wl_in.worker_id,
        notes=wl_in.notes
    )
    db.add(new_entry)
    await db.commit()
    await db.refresh(new_entry)
    return new_entry
