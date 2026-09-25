import csv
import io
from uuid import UUID
from typing import List, Optional, Dict
from datetime import datetime, timezone, timedelta
from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func, distinct
from sqlalchemy.orm import selectinload
from src.database import get_db
from src.models import (
    Venue, VenueManager, VenueWhitelist, User, UserRole,
    Shift, ShiftRequest, RequestStatus, TimeEntry, VenuePosition
)
from src.schemas import (
    VenueCreate, VenueUpdateSettings, VenueResponse,
    WhitelistAddRequest, WhitelistResponse,
    ShiftResponse, ShiftRequestResponse,
    WorkerContactSchema, ShiftRosterResponse, UserBrief,
    WorkerReliability, VenueEventResponse, EventPosition, RosterPerson,
    VenuePositionCreate, VenuePositionUpdate, VenuePositionResponse,
    VenueDirectoryItem, VenueProfileResponse, PublicVenueEvent
)
from src.auth import get_current_user, require_manager_or_admin, require_super_admin, normalize_role
from src.services.reliability import compute_reliability
from src.services.team import get_venue_team
from src.services.venue_positions import ensure_default_positions, clean_venue_payload
from src.services.venue_public import build_directory, build_profile, build_public_events

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

@router.get("/managed", response_model=List[VenueResponse])
async def list_managed_venues(
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """Phase 23: Venues the current user can manage (platform admins: all venues)."""
    if normalize_role(current_user.role) in ("platform_admin", "super_admin"):
        result = await db.execute(select(Venue).order_by(Venue.name))
    else:
        result = await db.execute(
            select(Venue)
            .join(VenueManager, VenueManager.venue_id == Venue.id)
            .where(VenueManager.user_id == current_user.id)
            .order_by(Venue.name)
        )
    return result.scalars().all()

@router.get("/directory", response_model=List[VenueDirectoryItem])
async def venue_directory(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Phase 25.1: Worker-facing list of venues with open spots and (optional) pay ranges."""
    return await build_directory(db)

@router.post("", response_model=VenueResponse, status_code=status.HTTP_201_CREATED)
async def create_venue(
    venue_in: VenueCreate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Phase 24: Create a venue.
    - If a manager email is given, that user MUST already exist (no auto-created accounts).
      A 'worker' is promoted to 'venue_manager'; admins/managers keep their role.
    - If no email is given and the creator is a venue_manager, the creator manages it.
      Platform admins are omnipresent and are NOT added as managers.
    """
    mgr_email = (venue_in.manager_email or venue_in.initial_manager_email or "").lower().strip()
    mgr_user = None
    if mgr_email:
        mgr_user = await db.scalar(select(User).where(func.lower(User.email) == mgr_email))
        if not mgr_user:
            raise HTTPException(
                status_code=400,
                detail=f"No account exists for {mgr_email}. Create the user first (Admin Panel → Users) "
                       f"or have them sign up, then assign them as manager."
            )
        if not mgr_user.is_active:
            raise HTTPException(status_code=400, detail=f"{mgr_email} is deactivated. Reactivate them first.")

    try:
        venue_dict = venue_in.model_dump(exclude={"manager_email", "initial_manager_email"})
        venue_dict = clean_venue_payload({k: v for k, v in venue_dict.items() if v is not None or k == "auto_approve_rating_threshold"})
        venue = Venue(**venue_dict)
        db.add(venue)
        await db.flush()
        await ensure_default_positions(db, venue.id)

        manager_id = None
        if mgr_user:
            if normalize_role(mgr_user.role) == "worker":
                mgr_user.role = "venue_manager"
            manager_id = mgr_user.id
        elif normalize_role(current_user.role) == "venue_manager":
            manager_id = current_user.id

        if manager_id:
            db.add(VenueManager(venue_id=venue.id, user_id=manager_id, is_primary=True))

        await db.commit()
        await db.refresh(venue)
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create venue: {str(e)}")

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

@router.get("/{venue_id}/reliability", response_model=Dict[str, WorkerReliability])
async def get_venue_reliability(
    venue_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """Phase 21: Reliability scores for every worker who has requested a shift at this venue."""
    await verify_venue_manager_access(venue_id, current_user, db)
    worker_ids = (await db.execute(
        select(distinct(ShiftRequest.worker_id))
        .join(Shift, ShiftRequest.shift_id == Shift.id)
        .where(Shift.venue_id == venue_id)
    )).scalars().all()
    data = await compute_reliability(db, list(worker_ids))
    return {str(wid): WorkerReliability(worker_id=wid, **vals) for wid, vals in data.items()}

@router.put("/{venue_id}/settings", response_model=VenueResponse)
@router.patch("/{venue_id}/settings", response_model=VenueResponse)
async def update_venue_settings(
    venue_id: UUID,
    settings_in: VenueUpdateSettings,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """Phase 25: Edit the venue profile. Admins: any venue. Managers: venues they manage."""
    venue = await verify_venue_manager_access(venue_id, current_user, db)
    data = clean_venue_payload(settings_in.model_dump(exclude_unset=True))
    try:
        for field, value in data.items():
            setattr(venue, field, value)
        await db.commit()
        await db.refresh(venue)
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update venue: {str(e)}")
    return venue


# ------------------------------------------------------------------------------
# Phase 25: Venue positions (roles + default pay)
# ------------------------------------------------------------------------------
@router.get("/{venue_id}/positions", response_model=List[VenuePositionResponse])
async def list_venue_positions(
    venue_id: UUID,
    include_inactive: bool = Query(False),
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    await verify_venue_manager_access(venue_id, current_user, db)
    q = select(VenuePosition).where(VenuePosition.venue_id == venue_id)
    if not include_inactive:
        q = q.where(VenuePosition.is_active == True)
    q = q.order_by(VenuePosition.sort_order.asc(), VenuePosition.name.asc())
    return (await db.execute(q)).scalars().all()


@router.post("/{venue_id}/positions", response_model=VenuePositionResponse, status_code=status.HTTP_201_CREATED)
async def create_venue_position(
    venue_id: UUID,
    pos_in: VenuePositionCreate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    await verify_venue_manager_access(venue_id, current_user, db)
    name = (pos_in.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Position name can't be empty.")
    if pos_in.default_rate is None or pos_in.default_rate <= 0:
        raise HTTPException(status_code=400, detail="Default rate must be greater than $0.")

    existing = await db.scalar(
        select(VenuePosition).where(
            VenuePosition.venue_id == venue_id,
            func.lower(VenuePosition.name) == name.lower()
        )
    )
    if existing:
        if existing.is_active:
            raise HTTPException(status_code=409, detail=f"'{existing.name}' already exists at this venue.")
        # Re-activate a previously removed position instead of duplicating it
        try:
            existing.is_active = True
            existing.default_rate = pos_in.default_rate
            existing.tips_eligible = bool(pos_in.tips_eligible)
            existing.tip_pool = bool(pos_in.tips_eligible and pos_in.tip_pool)
            await db.commit()
            await db.refresh(existing)
        except Exception as e:
            await db.rollback()
            raise HTTPException(status_code=500, detail=f"Failed to restore position: {str(e)}")
        return existing

    try:
        max_order = await db.scalar(
            select(func.coalesce(func.max(VenuePosition.sort_order), -1)).where(VenuePosition.venue_id == venue_id)
        )
        pos = VenuePosition(
            venue_id=venue_id,
            name=name[:100],
            default_rate=pos_in.default_rate,
            tips_eligible=bool(pos_in.tips_eligible),
            tip_pool=bool(pos_in.tips_eligible and pos_in.tip_pool),
            sort_order=int(max_order) + 1,
            is_active=True,
        )
        db.add(pos)
        await db.commit()
        await db.refresh(pos)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to add position: {str(e)}")
    return pos


@router.patch("/{venue_id}/positions/{position_id}", response_model=VenuePositionResponse)
async def update_venue_position(
    venue_id: UUID,
    position_id: UUID,
    pos_in: VenuePositionUpdate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    await verify_venue_manager_access(venue_id, current_user, db)
    pos = await db.scalar(
        select(VenuePosition).where(VenuePosition.id == position_id, VenuePosition.venue_id == venue_id)
    )
    if not pos:
        raise HTTPException(status_code=404, detail="Position not found.")

    data = pos_in.model_dump(exclude_unset=True)
    if "name" in data:
        new_name = (data["name"] or "").strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="Position name can't be empty.")
        clash = await db.scalar(
            select(VenuePosition).where(
                VenuePosition.venue_id == venue_id,
                func.lower(VenuePosition.name) == new_name.lower(),
                VenuePosition.id != position_id
            )
        )
        if clash:
            raise HTTPException(status_code=409, detail=f"'{clash.name}' already exists at this venue.")
        data["name"] = new_name[:100]
    if "default_rate" in data and (data["default_rate"] is None or data["default_rate"] <= 0):
        raise HTTPException(status_code=400, detail="Default rate must be greater than $0.")

    try:
        for field, value in data.items():
            if value is None and field in ("tips_eligible", "tip_pool", "is_active", "sort_order"):
                continue
            setattr(pos, field, value)
        if not pos.tips_eligible:
            pos.tip_pool = False
        await db.commit()
        await db.refresh(pos)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update position: {str(e)}")
    return pos


@router.delete("/{venue_id}/positions/{position_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_venue_position(
    venue_id: UUID,
    position_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """Soft-remove: hides the position from the Create Shift list. Existing shifts are untouched."""
    await verify_venue_manager_access(venue_id, current_user, db)
    pos = await db.scalar(
        select(VenuePosition).where(VenuePosition.id == position_id, VenuePosition.venue_id == venue_id)
    )
    if not pos:
        raise HTTPException(status_code=404, detail="Position not found.")
    try:
        pos.is_active = False
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to remove position: {str(e)}")
    return None


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
        existing.worker = worker
        return existing

    new_entry = VenueWhitelist(
        venue_id=venue_id,
        worker_id=wl_in.worker_id,
        notes=wl_in.notes
    )
    db.add(new_entry)
    await db.commit()
    await db.refresh(new_entry)
    new_entry.worker = worker
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

@router.get("/{venue_id}/payroll/export")
async def export_venue_payroll_csv(
    venue_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Phase 19: Hour Tracking & Payroll CSV Export.
    Calculates hours worked for workers at this venue.
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
    writer.writerow(["Worker Name", "Email", "Shift Title", "Role", "Date", "Clock In", "Clock Out", "Total Hours", "Hourly Rate", "Gross Pay", "Tips Eligible", "Tip Pool"])

    for entry, worker, shift in records:
        worker_name = f"{worker.first_name} {worker.last_name}".strip() or worker.email
        email = worker.email or ""
        shift_title = shift.title or ""
        shift_date = shift.start_time.strftime("%Y-%m-%d") if shift.start_time else ""
        clock_in = entry.clock_in_time.strftime("%Y-%m-%d %H:%M:%S") if entry.clock_in_time else ""
        clock_out = entry.clock_out_time.strftime("%Y-%m-%d %H:%M:%S") if entry.clock_out_time else "Did not clock out"

        rate = float(shift.hourly_rate) if shift.hourly_rate is not None else 0.0
        if entry.clock_in_time and entry.clock_out_time:
            hours = (entry.clock_out_time - entry.clock_in_time).total_seconds() / 3600.0
        else:
            hours = 0.0
        writer.writerow([
            worker_name, email, shift_title, shift.role_type or "", shift_date, clock_in, clock_out,
            f"{hours:.2f}", f"{rate:.2f}", f"{hours * rate:.2f}",
            "Yes" if shift.tips_eligible else "No",
            "Yes" if shift.tip_pool else "No",
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=payroll.csv"}
    )

@router.get("/{venue_id}/workers", response_model=List[UserBrief])
async def get_venue_workers(
    venue_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Phase 24: Active workers on this venue's team (whitelisted or worked here before)."""
    v = await db.scalar(select(Venue).where(Venue.id == venue_id))
    if not v:
        raise HTTPException(status_code=404, detail="Venue not found")

    return await get_venue_team(db, venue_id, exclude_user_id=current_user.id)

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
                tips_eligible=bool(s.tips_eligible),
                tip_pool=bool(s.tip_pool),
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


ASSIGNED_STATUSES = ("approved", "confirmed", "checked_in", "completed")
REQUESTED_STATUSES = ("pending", "pending_manager_approval")


@router.get("/{venue_id}/events", response_model=List[VenueEventResponse])
async def get_venue_events(
    venue_id: UUID,
    scope: str = Query("upcoming", pattern="^(upcoming|past|all)$"),
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Phase 23: Posted shifts grouped into events. One "Create Shift" submission creates one
    Shift row per role; rows sharing (title, start_time, end_time) are one event.
    Each position lists assigned workers and pending requests.
    """
    await verify_venue_manager_access(venue_id, current_user, db)
    now_utc = datetime.now(timezone.utc)

    q = select(Shift).where(Shift.venue_id == venue_id)
    if scope == "upcoming":
        q = q.where(Shift.end_time >= now_utc).order_by(Shift.start_time.asc(), Shift.role_type.asc())
    elif scope == "past":
        q = q.where(Shift.end_time < now_utc).order_by(Shift.start_time.desc(), Shift.role_type.asc()).limit(500)
    else:
        q = q.order_by(Shift.start_time.asc(), Shift.role_type.asc())
    shifts = (await db.execute(q)).scalars().all()
    if not shifts:
        return []

    shift_ids = [s.id for s in shifts]

    req_rows = (await db.execute(
        select(ShiftRequest, User)
        .join(User, ShiftRequest.worker_id == User.id)
        .where(
            ShiftRequest.shift_id.in_(shift_ids),
            func.lower(ShiftRequest.status).in_(ASSIGNED_STATUSES + REQUESTED_STATUSES)
        )
        .order_by(ShiftRequest.created_at.asc())
    )).all()

    te_rows = (await db.execute(
        select(
            TimeEntry.shift_id,
            TimeEntry.worker_id,
            func.count(TimeEntry.id),
            func.count(TimeEntry.clock_out_time),
        )
        .where(TimeEntry.shift_id.in_(shift_ids))
        .group_by(TimeEntry.shift_id, TimeEntry.worker_id)
    )).all()
    clock_state = {(sid, wid): (n > 0, n_out > 0 and n_out >= n) for sid, wid, n, n_out in te_rows}

    assigned_by_shift = defaultdict(list)
    requested_by_shift = defaultdict(list)
    for req, worker in req_rows:
        clocked_in, clocked_out = clock_state.get((req.shift_id, req.worker_id), (False, False))
        person = RosterPerson(
            request_id=req.id,
            worker_id=worker.id,
            first_name=worker.first_name or "",
            last_name=worker.last_name or "",
            email=worker.email,
            phone=worker.phone,
            aggregate_rating=float(worker.aggregate_rating) if worker.aggregate_rating is not None else 5.0,
            status=(req.status or "").lower(),
            requested_at=req.created_at,
            clocked_in=clocked_in or req.check_in_time is not None,
            clocked_out=clocked_out or req.check_out_time is not None,
        )
        if person.status in ASSIGNED_STATUSES:
            assigned_by_shift[req.shift_id].append(person)
        else:
            requested_by_shift[req.shift_id].append(person)

    events = {}
    order = []
    for s in shifts:
        key = f"{s.title}|{s.start_time.isoformat()}|{s.end_time.isoformat()}"
        if key not in events:
            events[key] = {
                "event_key": key,
                "title": s.title or "Shift",
                "start_time": s.start_time,
                "end_time": s.end_time,
                "description": s.description,
                "positions": [],
            }
            order.append(key)
        events[key]["positions"].append(EventPosition(
            shift_id=s.id,
            role_type=s.role_type or "Worker",
            hourly_rate=float(s.hourly_rate) if s.hourly_rate is not None else 0.0,
            tips_eligible=bool(s.tips_eligible),
            tip_pool=bool(s.tip_pool),
            capacity=s.capacity if s.capacity is not None else 1,
            spots_filled=s.spots_filled if s.spots_filled is not None else 0,
            status=s.status or "OPEN",
            assigned=assigned_by_shift[s.id],
            requested=requested_by_shift[s.id],
        ))

    result = []
    for key in order:
        ev = events[key]
        positions = ev["positions"]
        result.append(VenueEventResponse(
            **ev,
            total_capacity=sum(p.capacity for p in positions),
            total_assigned=sum(len(p.assigned) for p in positions),
            total_requested=sum(len(p.requested) for p in positions),
        ))
    return result


@router.get("/{venue_id}/profile", response_model=VenueProfileResponse)
async def venue_public_profile(
    venue_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Phase 25.1: Public venue profile (no worker PII)."""
    venue = await db.scalar(select(Venue).where(Venue.id == venue_id))
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")
    return await build_profile(db, venue, current_user)


@router.get("/{venue_id}/public-events", response_model=List[PublicVenueEvent])
async def venue_public_events(
    venue_id: UUID,
    scope: str = Query("upcoming", pattern="^(upcoming|past)$"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Phase 25.1: Upcoming or past (90 days) shifts grouped by event, with fill counts only."""
    venue = await db.scalar(select(Venue).where(Venue.id == venue_id))
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")
    return await build_public_events(db, venue, current_user, scope)
