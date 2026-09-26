import secrets
from typing import List, Dict, Any, Optional
from uuid import UUID
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func, distinct
from sqlalchemy.orm import selectinload
from src.database import get_db
from src.models import Venue, Shift, User, ShiftRequest, UserRole, VenueManager, VenueWhitelist, TimeEntry
from src.schemas import VenueResponse, UserResponse, UserCreateAdmin, UserUpdateAdmin, AdminPasswordReset, AdminPasswordResetResponse
from src.auth import require_admin, get_password_hash, normalize_role
from src.serializers import auth_source_for
from src.services.always_admin import is_always_admin_email

router = APIRouter(prefix="/api/admin", tags=["Admin"])
VALID_ROLES = ("worker", "venue_manager", "platform_admin")

# No 0/O, 1/l/I so it's easy to read aloud or copy by hand
_TEMP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"


def _generate_temp_password(length: int = 12) -> str:
    return "".join(secrets.choice(_TEMP_ALPHABET) for _ in range(length))

def _build_user_response(user: User, venue_ids: list, venue_names: list) -> UserResponse:
    """Build UserResponse from column attributes only. Never touches ORM relationships."""
    return UserResponse(
        id=user.id,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        role=user.role,
        phone=user.phone,
        avatar_url=user.avatar_url,
        bio=user.bio,
        skills=user.skills or [],
        venue_id=str(venue_ids[0]) if venue_ids else None,
        venue_ids=venue_ids,
        venue_names=venue_names,
        aggregate_rating=float(user.aggregate_rating or 0.0),
        rating_count=int(user.rating_count or 0),
        total_shifts=int(user.total_shifts or 0),
        is_active=bool(user.is_active),
        created_at=user.created_at,
        auth_source=auth_source_for(user),
        has_password=bool(user.hashed_password),
    )

@router.get("/venues", response_model=List[VenueResponse])
async def get_admin_venues(
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Retrieve all venues with counts of total shifts, managers, and assigned workers.
    """
    venues = (await db.execute(select(Venue).order_by(Venue.name))).scalars().all()

    # Gather metrics for each venue
    response_venues = []
    for v in venues:
        # Shift count
        shift_count = await db.scalar(
            select(func.count(Shift.id)).where(Shift.venue_id == v.id)
        ) or 0

        # Manager count
        mgr_count = await db.scalar(
            select(func.count(VenueManager.user_id)).where(VenueManager.venue_id == v.id)
        ) or 0

        # Distinct assigned workers (either whitelisted or with approved/confirmed shifts)
        worker_count = await db.scalar(
            select(func.count(distinct(ShiftRequest.worker_id)))
            .join(Shift, ShiftRequest.shift_id == Shift.id)
            .where(
                Shift.venue_id == v.id,
                func.lower(ShiftRequest.status).in_(["approved", "confirmed", "checked_in", "completed"])
            )
        ) or 0

        response_venues.append(VenueResponse(
            id=v.id,
            name=v.name,
            address=v.address,
            lat=float(v.lat or 40.7128),
            lng=float(v.lng or -74.0060),
            geofence_radius_meters=v.geofence_radius_meters,
            auto_approve_rating_threshold=v.auto_approve_rating_threshold,
            description=v.description,
            logo_url=v.logo_url,
            timezone=v.timezone or "America/New_York",
            phone=v.phone,
            arrival_instructions=v.arrival_instructions,
            dress_code=v.dress_code,
            default_shift_notes=v.default_shift_notes,
            approval_policy=v.approval_policy or "team_auto",
            show_rates_publicly=bool(v.show_rates_publicly),
            created_at=v.created_at,
            updated_at=v.updated_at,
            total_shifts=shift_count,
            total_managers=mgr_count,
            assigned_workers_count=worker_count,
            total_assigned_workers=worker_count,
        ))

    return response_venues

@router.get("/users", response_model=List[UserResponse])
async def get_admin_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Phase 20: Query all users with pagination and venue affiliations.
    """
    result = await db.execute(
        select(User)
        .order_by(User.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    users = result.scalars().all()

    response_users = []
    for u in users:
        u_role = normalize_role(u.role)
        venue_ids = []
        venue_names = []

        if u_role == "venue_manager":
            mgr_entries = (await db.execute(
                select(VenueManager.venue_id, Venue.name)
                .join(Venue, VenueManager.venue_id == Venue.id)
                .where(VenueManager.user_id == u.id)
            )).all()
            venue_ids = [m[0] for m in mgr_entries]
            venue_names = [m[1] for m in mgr_entries]
        elif u_role == "worker":
            wl_entries = (await db.execute(
                select(VenueWhitelist.venue_id, Venue.name)
                .join(Venue, VenueWhitelist.venue_id == Venue.id)
                .where(VenueWhitelist.worker_id == u.id, VenueWhitelist.is_active == True)
            )).all()
            venue_ids = [w[0] for w in wl_entries]
            venue_names = [w[1] for w in wl_entries]

        response_users.append(_build_user_response(u, venue_ids, venue_names))

    return response_users

@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_admin_user(
    user_in: UserCreateAdmin,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Phase 20: Provision a new user with venue affiliations.
    """
    email_clean = user_in.email.lower().strip()
    venue_ids = []
    venue_names = []
    try:
        # 1. Validate email is unique
        existing = await db.scalar(select(User).where(User.email == email_clean))
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"A user with email '{email_clean}' already exists."
            )

        # 2. Hash password
        hashed = get_password_hash(user_in.password)

        # 3. Create user
        role_clean = normalize_role(user_in.role)
        new_user = User(
            email=email_clean,
            hashed_password=hashed,
            first_name=user_in.first_name.strip(),
            last_name=user_in.last_name.strip(),
            phone=user_in.phone.strip() if user_in.phone else None,
            role=role_clean,
            is_active=True
        )
        db.add(new_user)
        await db.flush()

        # 4. If venue_manager, assign venue_managers
        if user_in.venue_ids:
            for vid in user_in.venue_ids:
                v = await db.scalar(select(Venue).where(Venue.id == vid))
                if v:
                    venue_ids.append(v.id)
                    venue_names.append(v.name)
                    if role_clean == "venue_manager":
                        db.add(VenueManager(venue_id=v.id, user_id=new_user.id, is_primary=False))
                    elif role_clean == "worker":
                        db.add(VenueWhitelist(venue_id=v.id, worker_id=new_user.id, is_active=True))

        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create user: {str(e)}")

    await db.refresh(new_user)
    return _build_user_response(new_user, venue_ids, venue_names)

@router.patch("/users/{user_id}", response_model=UserResponse)
async def update_admin_user(
    user_id: UUID,
    user_update: UserUpdateAdmin,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """Phase 23: Update role, active status, profile fields, and venue assignments."""
    try:
        user = await db.scalar(select(User).where(User.id == user_id))
        if not user:
            raise HTTPException(status_code=404, detail="User not found.")

        old_role = normalize_role(user.role)
        new_role = normalize_role(user_update.role) if user_update.role is not None else old_role
        if new_role not in VALID_ROLES:
            raise HTTPException(status_code=400, detail=f"Invalid role '{user_update.role}'.")
        role_changed = new_role != old_role
        is_self = user.id == current_user.id

        if is_self and role_changed:
            raise HTTPException(status_code=400, detail="You cannot change your own role.")
        if is_self and user_update.is_active is False:
            raise HTTPException(status_code=400, detail="You cannot deactivate your own account.")
        if is_always_admin_email(user.email) and (new_role != "platform_admin" or user_update.is_active is False):
            raise HTTPException(
                status_code=400,
                detail="This account is listed in ALWAYS_ADMIN_EMAILS and must stay an active Platform Admin. Remove it from the secrets file first."
            )

        losing_admin = old_role == "platform_admin" and (role_changed or user_update.is_active is False)
        if losing_admin:
            admin_count = await db.scalar(
                select(func.count(User.id)).where(
                    func.lower(User.role).in_(["platform_admin", "super_admin"]),
                    User.is_active == True
                )
            )
            if (admin_count or 0) <= 1:
                raise HTTPException(status_code=400, detail="Cannot remove the last active platform admin.")

        # Venue assignments are rebuilt whenever the role changes or venue_ids is sent.
        rebuild_venues = role_changed or user_update.venue_ids is not None
        target_ids = []
        if rebuild_venues and new_role != "platform_admin":
            seen = set()
            for vid in (user_update.venue_ids or []):
                if vid not in seen:
                    seen.add(vid)
                    target_ids.append(vid)
            if target_ids:
                found = (await db.execute(select(Venue.id).where(Venue.id.in_(target_ids)))).scalars().all()
                missing = [str(v) for v in target_ids if v not in set(found)]
                if missing:
                    raise HTTPException(status_code=400, detail=f"Unknown venue id(s): {', '.join(missing)}")
            if new_role == "venue_manager" and not target_ids:
                raise HTTPException(
                    status_code=400,
                    detail="Assign at least one venue when making someone a Venue Manager."
                )

        user.role = new_role
        if user_update.is_active is not None:
            user.is_active = user_update.is_active
        if user_update.first_name is not None:
            user.first_name = user_update.first_name.strip()
        if user_update.last_name is not None:
            user.last_name = user_update.last_name.strip()
        if user_update.phone is not None:
            user.phone = user_update.phone.strip()

        if rebuild_venues:
            await db.execute(delete(VenueManager).where(VenueManager.user_id == user.id))
            await db.execute(delete(VenueWhitelist).where(VenueWhitelist.worker_id == user.id))
            for idx, vid in enumerate(target_ids):
                if new_role == "venue_manager":
                    db.add(VenueManager(venue_id=vid, user_id=user.id, is_primary=(idx == 0)))
                elif new_role == "worker":
                    db.add(VenueWhitelist(venue_id=vid, worker_id=user.id, is_active=True))

        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update user: {str(e)}")

    await db.refresh(user)

    # Build affiliations
    u_role = normalize_role(user.role)
    venue_ids = []
    venue_names = []
    if u_role == "venue_manager":
        mgr_entries = (await db.execute(
            select(VenueManager.venue_id, Venue.name)
            .join(Venue, VenueManager.venue_id == Venue.id)
            .where(VenueManager.user_id == user.id)
        )).all()
        venue_ids = [m[0] for m in mgr_entries]
        venue_names = [m[1] for m in mgr_entries]
    elif u_role == "worker":
        wl_entries = (await db.execute(
            select(VenueWhitelist.venue_id, Venue.name)
            .join(Venue, VenueWhitelist.venue_id == Venue.id)
            .where(VenueWhitelist.worker_id == user.id, VenueWhitelist.is_active == True)
        )).all()
        venue_ids = [w[0] for w in wl_entries]
        venue_names = [w[1] for w in wl_entries]

    return _build_user_response(user, venue_ids, venue_names)

@router.post("/users/{user_id}/reset-password", response_model=AdminPasswordResetResponse)
async def admin_reset_password(
    user_id: UUID,
    body: AdminPasswordReset,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Phase 25.4: Reset a LOCAL password. Firebase-only accounts are refused (their password is in Firebase).
    If new_password is omitted, a 12-character temporary password is generated and returned once.
    """
    user = await db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if not user.hashed_password:
        raise HTTPException(
            status_code=400,
            detail="This person signs in with Firebase, so there's no ShiftBoard password to reset. "
                   "They can use 'Forgot password' on the login page, or you can reset it in the Firebase Console."
        )

    generated = body.new_password is None or body.new_password.strip() == ""
    new_password = _generate_temp_password() if generated else body.new_password
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")

    try:
        user.hashed_password = get_password_hash(new_password)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to reset password: {str(e)}")

    return AdminPasswordResetResponse(
        user_id=user.id,
        generated=generated,
        temporary_password=new_password if generated else None,
    )

@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_admin_user(
    user_id: UUID,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Phase 21: Hard-delete a user. Blocked if the user has payroll history (time entries);
    in that case the admin should deactivate instead. DB-level ON DELETE CASCADE removes
    venue_managers, venue_whitelists, shift_requests, transfers, messages and ratings.
    """
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account.")

    user = await db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if is_always_admin_email(user.email):
        raise HTTPException(
            status_code=400,
            detail="This account is listed in ALWAYS_ADMIN_EMAILS and cannot be deleted. Remove it from the secrets file first."
        )

    if normalize_role(user.role) == "platform_admin":
        admin_count = await db.scalar(
            select(func.count(User.id)).where(
                func.lower(User.role).in_(["platform_admin", "super_admin"]),
                User.is_active == True
            )
        )
        if (admin_count or 0) <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last active platform admin.")

    te_count = await db.scalar(select(func.count(TimeEntry.id)).where(TimeEntry.worker_id == user_id))
    if te_count and te_count > 0:
        raise HTTPException(
            status_code=409,
            detail=f"User has {te_count} time entries (payroll history). Deactivate this user instead of deleting."
        )

    try:
        now_utc = datetime.now(timezone.utc)
        # Free up spots on future shifts this worker was confirmed for
        future_shift_ids = (await db.execute(
            select(ShiftRequest.shift_id)
            .join(Shift, ShiftRequest.shift_id == Shift.id)
            .where(
                ShiftRequest.worker_id == user_id,
                func.lower(ShiftRequest.status).in_(["approved", "confirmed", "checked_in"]),
                Shift.start_time > now_utc
            )
        )).scalars().all()
        for sid in future_shift_ids:
            shift = await db.scalar(select(Shift).where(Shift.id == sid))
            if shift:
                shift.spots_filled = max(0, (shift.spots_filled or 1) - 1)
                if shift.status == "FILLED":
                    shift.status = "OPEN"

        # Core delete — do NOT use db.delete(user) (lazy-load -> MissingGreenlet)
        await db.execute(delete(User).where(User.id == user_id))
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete user: {str(e)}")
    return None

@router.get("/stats")
async def get_admin_stats(
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """Retrieve system overview statistics"""
    venues = (await db.execute(select(Venue))).scalars().all()
    shifts = (await db.execute(select(Shift))).scalars().all()
    users = (await db.execute(select(User))).scalars().all()
    requests = (await db.execute(select(ShiftRequest))).scalars().all()

    workers_count = sum(1 for u in users if u.role in (UserRole.worker, "worker"))
    managers_count = sum(1 for u in users if u.role in (UserRole.venue_manager, "venue_manager"))
    open_shifts = sum(1 for s in shifts if s.status == "OPEN")
    pending_requests = sum(1 for r in requests if str(r.status).lower() in ("pending", "pending_manager_approval"))

    return {
        "total_venues": len(venues),
        "total_shifts": len(shifts),
        "open_shifts": open_shifts,
        "total_workers": workers_count,
        "total_managers": managers_count,
        "total_requests": len(requests),
        "pending_requests": pending_requests
    }
