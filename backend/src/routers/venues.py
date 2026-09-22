import csv
import io
from uuid import UUID
from typing import List, Optional
from datetime import datetime, timezone, timedelta
from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func
from sqlalchemy.orm import selectinload
from src.database import get_db
from src.models import (
    Venue, VenueManager, VenueWhitelist, User, UserRole,
    Shift, ShiftRequest, RequestStatus, TimeEntry
)
from src.schemas import (
    VenueCreate, VenueUpdateSettings, VenueResponse,
    WhitelistAddRequest, WhitelistResponse,
    ShiftResponse, ShiftRequestResponse,
    WorkerContactSchema, ShiftRosterResponse
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
                role="venue_manager",
                first_name="Venue",
                last_name="Manager",
                is_active=True
            )
            db.add(mgr_user)
            await db.commit()
            await db.refresh(mgr_user)
        else:
            mgr_user.role = "venue_manager"
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
        .where(
            Shift.venue_id == venue_id,
            func.lower(ShiftRequest.status).in_([
                "pending", "pending_manager_approval"
            ])
        )
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

@router.get("/{venue_id}/export-hours")
async def export_venue_hours_csv(
    venue_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Task 2: Query all TimeEntry records for the venue. Join with the User and Shift tables.
    Use the Python csv module and io.StringIO to format columns:
    Worker Name, Shift Date, Role, Clock In, Clock Out, Total Hours.
    Return a FastAPI StreamingResponse with media_type="text/csv" and a Content-Disposition header.
    """
    await verify_venue_manager_access(venue_id, current_user, db)

    query = (
        select(TimeEntry, User, Shift)
        .join(Shift, TimeEntry.shift_id == Shift.id)
        .join(User, TimeEntry.worker_id == User.id)
        .where(Shift.venue_id == venue_id)
        .order_by(TimeEntry.clock_in_time.desc())
    )
    result = await db.execute(query)
    records = result.all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Worker Name", "Shift Date", "Role", "Clock In", "Clock Out", "Total Hours"])

    for entry, worker, shift in records:
        worker_name = f"{worker.first_name} {worker.last_name}".strip() or worker.email
        shift_date = shift.start_time.strftime("%Y-%m-%d") if shift.start_time else ""
        role = shift.role_type or ""
        clock_in = entry.clock_in_time.strftime("%Y-%m-%d %H:%M:%S") if entry.clock_in_time else ""
        clock_out = entry.clock_out_time.strftime("%Y-%m-%d %H:%M:%S") if entry.clock_out_time else "In Progress"

        if entry.clock_in_time and entry.clock_out_time:
            diff_seconds = (entry.clock_out_time - entry.clock_in_time).total_seconds()
            total_hours = f"{diff_seconds / 3600.0:.2f}"
        else:
            total_hours = "0.00"

        writer.writerow([worker_name, shift_date, role, clock_in, clock_out, total_hours])

    output.seek(0)
    filename = f"venue_{venue_id}_hours.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

@router.get("/{venue_id}/roster", response_model=List[ShiftRosterResponse])
async def get_venue_roster(
    venue_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Phase 16 & 17: Venue Manager Roster Endpoint.
    Aggregates shift data with contact details of approved/confirmed workers.
    Does not expose sensitive user data.
    """
    await verify_venue_manager_access(venue_id, current_user, db)

    try:
        # 1. Query future and recent past shifts for this venue
        now_utc = datetime.now(timezone.utc)
        recent_cutoff = now_utc - timedelta(days=60)

        shifts_query = (
            select(Shift)
            .options(selectinload(Shift.venue))
            .where(Shift.venue_id == venue_id, Shift.start_time >= recent_cutoff)
            .order_by(Shift.start_time.asc())
        )
        result = await db.execute(shifts_query)
        shifts = result.scalars().all()

        # Fallback to all shifts if none found within cutoff
        if not shifts:
            fallback_query = (
                select(Shift)
                .options(selectinload(Shift.venue))
                .where(Shift.venue_id == venue_id)
                .order_by(Shift.start_time.asc())
            )
            shifts = (await db.execute(fallback_query)).scalars().all()

        if not shifts:
            return []

        shift_ids = [s.id for s in shifts]

        # 2. Query approved / confirmed worker assignments
        assignments_query = (
            select(ShiftRequest, User)
            .join(User, ShiftRequest.worker_id == User.id)
            .where(
                ShiftRequest.shift_id.in_(shift_ids),
                func.lower(ShiftRequest.status).in_([
                    "approved", "confirmed", "checked_in", "completed"
                ])
            )
        )
        assignments_res = await db.execute(assignments_query)
        workers_by_shift = defaultdict(list)
        for req, worker in assignments_res.all():
            rating = 5.0
            if worker.aggregate_rating is not None:
                try:
                    rating = float(worker.aggregate_rating)
                except (ValueError, TypeError):
                    rating = 5.0

            contact = WorkerContactSchema(
                id=worker.id,
                first_name=worker.first_name or "",
                last_name=worker.last_name or "",
                email=worker.email,
                phone=worker.phone,
                avatar_url=worker.avatar_url,
                bio=worker.bio,
                aggregate_rating=rating
            )
            workers_by_shift[req.shift_id].append(contact)

        # 3. Construct and return list of ShiftRosterResponse
        roster = []
        for s in shifts:
            rate = 25.0
            if s.hourly_rate is not None:
                try:
                    rate = float(s.hourly_rate)
                except (ValueError, TypeError):
                    rate = 25.0

            roster_item = ShiftRosterResponse(
                id=s.id,
                venue_id=s.venue_id,
                title=s.title or "Shift",
                name=s.title or "Shift",
                role_type=s.role_type or "Worker",
                start_time=s.start_time,
                end_time=s.end_time,
                capacity=s.capacity if s.capacity is not None else 1,
                spots_filled=s.spots_filled if s.spots_filled is not None else 0,
                available_spots=s.available_spots,
                is_shift_auto_confirm=bool(s.is_shift_auto_confirm),
                hourly_rate=rate,
                description=s.description,
                status=s.status or "OPEN",
                created_at=s.created_at,
                venue=s.venue,
                assigned_workers=workers_by_shift[s.id]
            )
            roster.append(roster_item)

        return roster
    except Exception as e:
        print(f"Roster Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


