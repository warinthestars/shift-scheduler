from uuid import UUID
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from src.database import get_db
from src.models import (
    Venue, VenueManager, VenueWhitelist, User, UserRole,
    Shift, ShiftRequest, RequestStatus
)
from src.schemas import (
    VenueCreate, VenueUpdateSettings, VenueResponse,
    WhitelistAddRequest, WhitelistResponse,
    ShiftResponse, ShiftRequestResponse
)
from src.auth import get_current_user, require_manager_or_admin, require_super_admin, normalize_role

router = APIRouter(prefix="/api/venues", tags=["Venues"])

async def verify_venue_manager_access(venue_id: UUID, user: User, db: AsyncSession) -> Venue:
    """Verify that user is either a SUPER_ADMIN or an assigned manager for this venue"""
    res = await db.execute(select(Venue).where(Venue.id == venue_id))
    venue = res.scalar_one_or_none()
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")

    user_role = normalize_role(user.role)
    if user_role in ("platform_admin", "super_admin"):
        return venue

    # Check venue_managers junction table
    mgr = await db.scalar(
        select(VenueManager).where(
            VenueManager.venue_id == venue_id,
            VenueManager.user_id == user.id
        )
    )
    if not mgr:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to manage this venue"
        )
    return venue

@router.get("", response_model=List[VenueResponse])
async def list_venues(db: AsyncSession = Depends(get_db)):
    """List all registered venues"""
    result = await db.execute(select(Venue).order_by(Venue.name))
    return result.scalars().all()

@router.post("", response_model=VenueResponse, status_code=status.HTTP_201_CREATED)
async def create_venue(
    venue_in: VenueCreate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Task 3: Create a new Venue profile.
    Accessible by Super Admin or Venue Managers.
    Automatically assigns the creator as manager in VenueManagers relation.
    """
    venue_dict = venue_in.model_dump(exclude={"manager_email", "initial_manager_email"})
    venue = Venue(**venue_dict)
    db.add(venue)
    await db.commit()
    await db.refresh(venue)

    # Check if a manager email was provided
    mgr_email = venue_in.manager_email or venue_in.initial_manager_email
    mgr_user = None
    if mgr_email:
        m_res = await db.execute(select(User).where(User.email == mgr_email.lower()))
        mgr_user = m_res.scalar_one_or_none()
        if not mgr_user:
            from src.auth import get_password_hash
            mgr_user = User(
                email=mgr_email.lower(),
                hashed_password=get_password_hash("Manager123!"),
                role=UserRole.VENUE_MANAGER,
                first_name="Venue",
                last_name="Manager",
                is_active=True
            )
            db.add(mgr_user)
            await db.commit()
            await db.refresh(mgr_user)
        else:
            mgr_user.role = UserRole.VENUE_MANAGER
            await db.commit()

    manager_user_id = mgr_user.id if mgr_user else current_user.id
    manager_entry = VenueManager(
        venue_id=venue.id,
        user_id=manager_user_id,
        is_primary=True
    )
    db.add(manager_entry)
    await db.commit()
    await db.refresh(venue)

    return venue

@router.get("/{venue_id}", response_model=VenueResponse)
async def get_venue(venue_id: UUID, db: AsyncSession = Depends(get_db)):
    """
    Task 3: Retrieve venue details by ID.
    """
    result = await db.execute(select(Venue).where(Venue.id == venue_id))
    venue = result.scalar_one_or_none()
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")
    return venue

@router.get("/{venue_id}/shifts", response_model=List[ShiftResponse])
async def get_venue_shifts(
    venue_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """Retrieve all shifts for a specific venue"""
    result = await db.execute(
        select(Shift)
        .options(selectinload(Shift.venue))
        .where(Shift.venue_id == venue_id)
        .order_by(Shift.start_time.asc())
    )
    return result.scalars().all()

@router.get("/{venue_id}/requests/pending", response_model=List[ShiftRequestResponse])
async def get_venue_pending_requests(
    venue_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """Retrieve pending shift requests for this venue's shifts"""
    await verify_venue_manager_access(venue_id, current_user, db)
    result = await db.execute(
        select(ShiftRequest)
        .join(Shift, ShiftRequest.shift_id == Shift.id)
        .options(
            selectinload(ShiftRequest.shift).selectinload(Shift.venue),
            selectinload(ShiftRequest.worker)
        )
        .where(Shift.venue_id == venue_id, ShiftRequest.status == RequestStatus.PENDING)
        .order_by(ShiftRequest.created_at.asc())
    )
    return result.scalars().all()

@router.put("/{venue_id}/settings", response_model=VenueResponse)
async def update_venue_settings(
    venue_id: UUID,
    settings_in: VenueUpdateSettings,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Task 3: Update auto_approve_rating_threshold and geofence parameters.
    Protected by role & venue manager assignment check.
    """
    venue = await verify_venue_manager_access(venue_id, current_user, db)

    update_data = settings_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(venue, field, value)

    await db.commit()
    await db.refresh(venue)
    return venue

@router.post("/{venue_id}/whitelist", response_model=WhitelistResponse)
async def add_worker_to_whitelist(
    venue_id: UUID,
    wl_in: WhitelistAddRequest,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Task 3: Add a worker's user ID to this venue's auto-approve whitelist.
    """
    await verify_venue_manager_access(venue_id, current_user, db)

    # Verify worker user exists
    w_res = await db.execute(select(User).where(User.id == wl_in.worker_id))
    worker = w_res.scalar_one_or_none()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker user not found")

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

@router.get("/{venue_id}/whitelist", response_model=List[WhitelistResponse])
async def get_venue_whitelist(
    venue_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """List active whitelisted workers for this venue"""
    await verify_venue_manager_access(venue_id, current_user, db)
    result = await db.execute(
        select(VenueWhitelist)
        .options(selectinload(VenueWhitelist.worker))
        .where(VenueWhitelist.venue_id == venue_id, VenueWhitelist.is_active == True)
    )
    return result.scalars().all()

@router.delete("/{venue_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_venue(
    venue_id: UUID,
    current_user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db)
):
    """Delete a venue (Super Admin only)"""
    result = await db.execute(select(Venue).where(Venue.id == venue_id))
    venue = result.scalar_one_or_none()
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")

    await db.delete(venue)
    await db.commit()
