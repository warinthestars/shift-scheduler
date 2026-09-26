"""
Phase 29: The venue's Team page, co-managers and ratings.

Everything here requires the venue's manager (or a platform admin).

  GET    /api/venues/{venue_id}/team?status=active|removed|blocked|all
  POST   /api/venues/{venue_id}/team                     add an existing worker by email
  POST   /api/venues/{venue_id}/team/accounts            create a worker account (temporary password, shown once)
  PATCH  /api/venues/{venue_id}/team/{worker_id}         status / positions / private notes
  GET    /api/venues/{venue_id}/managers
  POST   /api/venues/{venue_id}/managers                 add a co-manager (existing manager account, or a new one)
  DELETE /api/venues/{venue_id}/managers/{user_id}
  PUT    /api/venues/{venue_id}/ratings/{request_id}     rate a finished shift (1-5 + would book again)
  DELETE /api/venues/{venue_id}/ratings/{request_id}
"""
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import (
    User, Venue, VenueManager, VenueWhitelist, Shift, ShiftRequest, ShiftOffer, Rating,
)
from src.schemas import (
    TeamMember, TeamMemberUpdate, TeamMemberUpdateResult, TeamAddExisting, TeamCreateWorker,
    AccountCreateResult, VenueManagerItem, ManagerCreate, WorkerReliability, RatingInput, RatingResponse,
)
from src.auth import require_manager_or_admin, get_password_hash, normalize_role
from src.routers.venues import verify_venue_manager_access
from src.routers.admin import _generate_temp_password
from src.services.team import set_membership, TEAM_STATUSES
from src.services.reliability import compute_reliability
from src.services.invites import valid_email

logger = logging.getLogger("shiftboard.team")

router = APIRouter(prefix="/api/venues", tags=["Team"])

WORKED_STATUSES = ("approved", "confirmed", "checked_in", "completed", "transferred")
FINISHED_STATUSES = ("approved", "confirmed", "checked_in", "completed")
BOOKED_STATUSES = ("approved", "confirmed", "checked_in")
RATEABLE_STATUSES = ("approved", "confirmed", "checked_in", "completed")


def _clean_positions(values: Optional[List[str]]) -> List[str]:
    out = []
    for v in values or []:
        v = (v or "").strip()[:100]
        if v and v.lower() not in [o.lower() for o in out]:
            out.append(v)
    return out


# ---------------------------------------------------------------------------------------------
# Team list
# ---------------------------------------------------------------------------------------------
async def build_team(db: AsyncSession, venue_id: UUID, only_ids: Optional[List[UUID]] = None) -> List[TeamMember]:
    """Everyone on the list (any status) + everyone who has worked / been booked here."""
    now = datetime.now(timezone.utc)
    wl_q = select(VenueWhitelist).where(VenueWhitelist.venue_id == venue_id)
    if only_ids is not None:
        wl_q = wl_q.where(VenueWhitelist.worker_id.in_(only_ids))
    rows = {r.worker_id: r for r in (await db.execute(wl_q)).scalars().all()}

    worked_q = (
        select(ShiftRequest.worker_id)
        .join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(Shift.venue_id == venue_id, func.lower(ShiftRequest.status).in_(WORKED_STATUSES))
        .distinct()
    )
    if only_ids is not None:
        worked_q = worked_q.where(ShiftRequest.worker_id.in_(only_ids))
    worked_ids = set((await db.execute(worked_q)).scalars().all())

    ids = set(rows.keys()) | worked_ids
    if not ids:
        return []
    users = {u.id: u for u in (await db.execute(
        select(User).where(User.id.in_(ids), func.lower(User.role) == "worker", User.is_active == True)
    )).scalars().all()}
    ids = list(users.keys())
    if not ids:
        return []

    finished = {}
    for wid, n, last in (await db.execute(
        select(ShiftRequest.worker_id, func.count(ShiftRequest.id), func.max(Shift.start_time))
        .join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(
            Shift.venue_id == venue_id, ShiftRequest.worker_id.in_(ids), Shift.end_time < now,
            func.lower(ShiftRequest.status).in_(FINISHED_STATUSES),
        )
        .group_by(ShiftRequest.worker_id)
    )).all():
        finished[wid] = (int(n), last)
    upcoming = dict((await db.execute(
        select(ShiftRequest.worker_id, func.count(ShiftRequest.id))
        .join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(
            Shift.venue_id == venue_id, ShiftRequest.worker_id.in_(ids), Shift.end_time >= now,
            func.lower(ShiftRequest.status).in_(BOOKED_STATUSES),
        )
        .group_by(ShiftRequest.worker_id)
    )).all())
    vr = {}
    for wid, avg, n, yes, no in (await db.execute(
        select(
            Rating.worker_id, func.avg(Rating.rating), func.count(Rating.id),
            func.count(Rating.id).filter(Rating.would_book_again == True),
            func.count(Rating.id).filter(Rating.would_book_again == False),
        )
        .where(Rating.venue_id == venue_id, Rating.worker_id.in_(ids))
        .group_by(Rating.worker_id)
    )).all():
        vr[wid] = (round(float(avg), 2) if avg is not None else None, int(n), int(yes), int(no))
    rel = await compute_reliability(db, ids)

    out = []
    for wid, u in users.items():
        row = rows.get(wid)
        n_done, last = finished.get(wid, (0, None))
        v_avg, v_n, yes, no = vr.get(wid, (None, 0, 0, 0))
        r = rel.get(wid)
        out.append(TeamMember(
            worker_id=wid,
            first_name=u.first_name or "",
            last_name=u.last_name or "",
            email=u.email,
            phone=u.phone,
            avatar_url=u.avatar_url,
            status=(row.status or "active") if row is not None else "active",
            on_list=row is not None,
            source=(row.source if row is not None else "worked"),
            positions=list(row.positions or []) if row is not None else [],
            notes=row.notes if row is not None else None,
            shifts_worked=n_done,
            upcoming=int(upcoming.get(wid, 0)),
            last_worked=last,
            aggregate_rating=float(u.aggregate_rating or 0.0),
            rating_count=int(u.rating_count or 0),
            venue_rating=v_avg,
            venue_rating_count=v_n,
            would_book_again_yes=yes,
            would_book_again_no=no,
            reliability=WorkerReliability(worker_id=wid, **r) if r else None,
            added_at=row.created_at if row is not None else None,
        ))
    out.sort(key=lambda m: ((m.first_name or "").lower(), (m.last_name or "").lower()))
    return out


async def _one_member(db: AsyncSession, venue_id: UUID, worker_id: UUID) -> TeamMember:
    found = await build_team(db, venue_id, only_ids=[worker_id])
    if not found:
        raise HTTPException(status_code=404, detail="That person isn't on this team.")
    return found[0]


@router.get("/{venue_id}/team", response_model=List[TeamMember])
async def get_team(
    venue_id: UUID,
    status_filter: str = Query("active", alias="status", pattern="^(active|removed|blocked|all)$"),
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await verify_venue_manager_access(venue_id, current_user, db)
    members = await build_team(db, venue_id)
    if status_filter != "all":
        members = [m for m in members if m.status == status_filter]
    return members


@router.post("/{venue_id}/team", response_model=TeamMember)
async def add_existing_worker(
    venue_id: UUID,
    body: TeamAddExisting,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await verify_venue_manager_access(venue_id, current_user, db)
    email = (body.email or "").strip().lower()
    if not valid_email(email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    user = await db.scalar(select(User).where(func.lower(User.email) == email))
    if user is None:
        raise HTTPException(status_code=404, detail="No ShiftBoard account uses that email. Create an account for them, or send an invite.")
    if normalize_role(user.role) != "worker":
        raise HTTPException(status_code=400, detail="That account is a manager or admin account, not a worker.")
    if not user.is_active:
        raise HTTPException(status_code=400, detail="That account is deactivated. Ask an admin to reactivate it.")
    try:
        await set_membership(db, venue_id, user.id, status="active", source="manager",
                             positions=_clean_positions(body.positions), added_by=current_user.id)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not add them: {e}")
    return await _one_member(db, venue_id, user.id)


@router.post("/{venue_id}/team/accounts", response_model=AccountCreateResult, status_code=status.HTTP_201_CREATED)
async def create_worker_account(
    venue_id: UUID,
    body: TeamCreateWorker,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Creates a WORKER account with a temporary password (returned once) and adds it to this team.
    If a worker account with that email already exists, it's just added to the team."""
    await verify_venue_manager_access(venue_id, current_user, db)
    email = (body.email or "").strip().lower()
    first = (body.first_name or "").strip()[:100]
    if not first:
        raise HTTPException(status_code=400, detail="First name is required.")
    if not valid_email(email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    positions = _clean_positions(body.positions)
    try:
        existing = await db.scalar(select(User).where(func.lower(User.email) == email))
        if existing is not None:
            if normalize_role(existing.role) != "worker":
                raise HTTPException(status_code=409, detail="That email belongs to a manager or admin account.")
            await set_membership(db, venue_id, existing.id, status="active", source="manager",
                                 positions=positions, added_by=current_user.id)
            await db.commit()
            return AccountCreateResult(
                user_id=existing.id, created=False,
                message=f"{email} already has an account, so they were added to your team. They sign in as usual.",
            )
        temp = _generate_temp_password()
        user = User(
            email=email,
            hashed_password=get_password_hash(temp),
            role="worker",
            first_name=first,
            last_name=(body.last_name or "").strip()[:100],
            phone=(body.phone or "").strip()[:30] or None,
            skills=[],
            aggregate_rating=5.0,
            rating_count=0,
            total_shifts=0,
            is_active=True,
        )
        db.add(user)
        await db.flush()
        user_id = user.id
        await set_membership(db, venue_id, user_id, status="active", source="manager",
                             positions=positions, added_by=current_user.id)
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.exception("create_worker_account failed")
        raise HTTPException(status_code=500, detail=f"Could not create the account: {e}")
    return AccountCreateResult(
        user_id=user_id, created=True, temporary_password=temp,
        message="Account created. Give them this temporary password; it's shown only once.",
    )


@router.patch("/{venue_id}/team/{worker_id}", response_model=TeamMemberUpdateResult)
async def update_member(
    venue_id: UUID,
    worker_id: UUID,
    body: TeamMemberUpdate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await verify_venue_manager_access(venue_id, current_user, db)
    data = body.model_dump(exclude_unset=True)
    new_status = data.get("status")
    if new_status is not None and new_status not in TEAM_STATUSES:
        raise HTTPException(status_code=400, detail="Status must be active, removed or blocked.")
    user = await db.scalar(select(User).where(User.id == worker_id))
    if user is None or normalize_role(user.role) != "worker":
        raise HTTPException(status_code=404, detail="Worker not found.")

    now = datetime.now(timezone.utc)
    booked_upcoming = 0
    message = "Saved."
    try:
        row = await db.scalar(
            select(VenueWhitelist).where(VenueWhitelist.venue_id == venue_id, VenueWhitelist.worker_id == worker_id)
        )
        if row is None:
            row = await set_membership(db, venue_id, worker_id, status=new_status or "active",
                                       source="manager", positions=[], added_by=current_user.id)
        elif new_status is not None:
            row.status = new_status
            row.is_active = new_status == "active"
        if "positions" in data and data["positions"] is not None:
            row.positions = _clean_positions(data["positions"])
        if "notes" in data:
            row.notes = (data["notes"] or "").strip()[:2000] or None

        if new_status == "blocked":
            # Waiting requests at this venue are declined; open offers are withdrawn.
            pending = (await db.execute(
                select(ShiftRequest)
                .join(Shift, Shift.id == ShiftRequest.shift_id)
                .where(
                    Shift.venue_id == venue_id, ShiftRequest.worker_id == worker_id,
                    func.lower(ShiftRequest.status).in_(("pending", "pending_manager_approval")),
                )
            )).scalars().all()
            for r in pending:
                r.status = "rejected"
                r.status_reason = "Not selected"
            await db.execute(
                update(ShiftOffer)
                .where(ShiftOffer.venue_id == venue_id, ShiftOffer.worker_id == worker_id, ShiftOffer.status == "pending")
                .values(status="cancelled", responded_at=now)
            )
            message = "Blocked. They can't request, be offered or be assigned your shifts."
        elif new_status == "removed":
            message = "Removed from the team. They can still request your open shifts; they just aren't on the team."
        elif new_status == "active":
            message = "On the team."
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save: {e}")

    if new_status in ("blocked", "removed"):
        booked_upcoming = int(await db.scalar(
            select(func.count(ShiftRequest.id))
            .join(Shift, Shift.id == ShiftRequest.shift_id)
            .where(
                Shift.venue_id == venue_id, ShiftRequest.worker_id == worker_id, Shift.end_time >= now,
                func.lower(ShiftRequest.status).in_(BOOKED_STATUSES),
            )
        ) or 0)
        if booked_upcoming:
            message += f" They're still booked on {booked_upcoming} upcoming shift{'s' if booked_upcoming != 1 else ''}; remove them from those shifts if needed."
    return TeamMemberUpdateResult(member=await _one_member(db, venue_id, worker_id), message=message, booked_upcoming=booked_upcoming)


# ---------------------------------------------------------------------------------------------
# Co-managers
# ---------------------------------------------------------------------------------------------
async def _managers(db: AsyncSession, venue_id: UUID, me: User) -> List[VenueManagerItem]:
    rows = (await db.execute(
        select(VenueManager, User)
        .join(User, User.id == VenueManager.user_id)
        .where(VenueManager.venue_id == venue_id)
        .order_by(VenueManager.is_primary.desc(), User.first_name.asc())
    )).all()
    return [
        VenueManagerItem(
            user_id=u.id, first_name=u.first_name or "", last_name=u.last_name or "", email=u.email,
            phone=u.phone, is_primary=bool(vm.is_primary), is_you=u.id == me.id,
        )
        for vm, u in rows
    ]


@router.get("/{venue_id}/managers", response_model=List[VenueManagerItem])
async def list_managers(
    venue_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await verify_venue_manager_access(venue_id, current_user, db)
    return await _managers(db, venue_id, current_user)


@router.post("/{venue_id}/managers", response_model=AccountCreateResult, status_code=status.HTTP_201_CREATED)
async def add_manager(
    venue_id: UUID,
    body: ManagerCreate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Adds a co-manager. Existing manager account -> linked. No account -> a manager account is created
    with a temporary password (returned once). Worker and admin accounts are refused (an admin changes roles)."""
    await verify_venue_manager_access(venue_id, current_user, db)
    email = (body.email or "").strip().lower()
    if not valid_email(email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    try:
        user = await db.scalar(select(User).where(func.lower(User.email) == email))
        temp = None
        created = False
        if user is not None:
            role = normalize_role(user.role)
            if role == "platform_admin":
                raise HTTPException(status_code=400, detail="That's a platform admin; they can already manage every venue.")
            if role != "venue_manager":
                raise HTTPException(
                    status_code=409,
                    detail="That email belongs to a worker account. Ask a platform admin to change it to a manager account, or use a different email.",
                )
            if not user.is_active:
                raise HTTPException(status_code=400, detail="That account is deactivated. Ask an admin to reactivate it.")
            already = await db.scalar(
                select(VenueManager).where(VenueManager.venue_id == venue_id, VenueManager.user_id == user.id)
            )
            if already is not None:
                raise HTTPException(status_code=400, detail="They already manage this venue.")
        else:
            first = (body.first_name or "").strip()[:100]
            if not first:
                raise HTTPException(status_code=400, detail="First name is required for a new account.")
            temp = _generate_temp_password()
            user = User(
                email=email,
                hashed_password=get_password_hash(temp),
                role="venue_manager",
                first_name=first,
                last_name=(body.last_name or "").strip()[:100],
                phone=(body.phone or "").strip()[:30] or None,
                skills=[],
                aggregate_rating=5.0,
                rating_count=0,
                total_shifts=0,
                is_active=True,
            )
            db.add(user)
            await db.flush()
            created = True
        user_id = user.id
        db.add(VenueManager(venue_id=venue_id, user_id=user_id, is_primary=False))
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.exception("add_manager failed")
        raise HTTPException(status_code=500, detail=f"Could not add the manager: {e}")
    return AccountCreateResult(
        user_id=user_id, created=created, temporary_password=temp,
        message=("Manager account created. Give them this temporary password; it's shown only once."
                 if created else "Added. They'll see this venue next time they sign in."),
    )


@router.delete("/{venue_id}/managers/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_manager(
    venue_id: UUID,
    user_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await verify_venue_manager_access(venue_id, current_user, db)
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="You can't remove yourself. Ask another manager or an admin.")
    count = int(await db.scalar(select(func.count(VenueManager.user_id)).where(VenueManager.venue_id == venue_id)) or 0)
    row = await db.scalar(select(VenueManager).where(VenueManager.venue_id == venue_id, VenueManager.user_id == user_id))
    if row is None:
        raise HTTPException(status_code=404, detail="They don't manage this venue.")
    if count <= 1:
        raise HTTPException(status_code=400, detail="A venue needs at least one manager.")
    try:
        await db.delete(row)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not remove the manager: {e}")
    return None


# ---------------------------------------------------------------------------------------------
# Ratings
# ---------------------------------------------------------------------------------------------
async def recompute_rating(db: AsyncSession, worker_id: UUID) -> User:
    """users.aggregate_rating / rating_count from the ratings table. Does NOT commit."""
    avg, n = (await db.execute(
        select(func.avg(Rating.rating), func.count(Rating.id)).where(Rating.worker_id == worker_id)
    )).one()
    user = await db.scalar(select(User).where(User.id == worker_id))
    user.rating_count = int(n or 0)
    user.aggregate_rating = round(float(avg), 2) if n else 5.0
    await db.flush()
    return user


async def _rateable_request(db: AsyncSession, venue_id: UUID, request_id: UUID) -> ShiftRequest:
    row = (await db.execute(
        select(ShiftRequest, Shift).join(Shift, Shift.id == ShiftRequest.shift_id).where(ShiftRequest.id == request_id)
    )).first()
    if row is None or row[1].venue_id != venue_id:
        raise HTTPException(status_code=404, detail="Booking not found at this venue.")
    req, shift = row
    if (req.status or "").lower() not in RATEABLE_STATUSES:
        raise HTTPException(status_code=400, detail="Only people who worked the shift can be rated.")
    end = shift.end_time if shift.end_time.tzinfo else shift.end_time.replace(tzinfo=timezone.utc)
    if end > datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="You can rate once the shift has ended.")
    return req


@router.put("/{venue_id}/ratings/{request_id}", response_model=RatingResponse)
async def rate_shift(
    venue_id: UUID,
    request_id: UUID,
    body: RatingInput,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await verify_venue_manager_access(venue_id, current_user, db)
    req = await _rateable_request(db, venue_id, request_id)
    worker_id = req.worker_id
    try:
        rating = await db.scalar(select(Rating).where(Rating.shift_request_id == request_id))
        if rating is None:
            rating = Rating(shift_request_id=request_id, venue_id=venue_id, worker_id=worker_id)
            db.add(rating)
        rating.rating = int(body.rating)
        rating.would_book_again = body.would_book_again
        rating.review = (body.review or "").strip()[:1000] or None
        rating.rated_by_user_id = current_user.id
        rating.updated_at = datetime.now(timezone.utc)
        await db.flush()
        user = await recompute_rating(db, worker_id)
        resp = RatingResponse(
            request_id=request_id, worker_id=worker_id, rating=rating.rating,
            would_book_again=rating.would_book_again, review=rating.review,
            aggregate_rating=float(user.aggregate_rating), rating_count=int(user.rating_count),
        )
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save the rating: {e}")
    return resp


@router.delete("/{venue_id}/ratings/{request_id}", response_model=RatingResponse)
async def delete_rating(
    venue_id: UUID,
    request_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await verify_venue_manager_access(venue_id, current_user, db)
    rating = await db.scalar(select(Rating).where(Rating.shift_request_id == request_id, Rating.venue_id == venue_id))
    if rating is None:
        raise HTTPException(status_code=404, detail="No rating to remove.")
    worker_id = rating.worker_id
    try:
        await db.delete(rating)
        await db.flush()
        user = await recompute_rating(db, worker_id)
        resp = RatingResponse(
            request_id=request_id, worker_id=worker_id, rating=None,
            aggregate_rating=float(user.aggregate_rating), rating_count=int(user.rating_count),
        )
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not remove the rating: {e}")
    return resp
