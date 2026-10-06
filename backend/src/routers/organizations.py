"""
Phase 36: organizations (a group of venues) and their owners.

  GET    /api/organizations                                   admin: all · owner: the ones they own
  POST   /api/organizations                                   admin   create (name + venues)
  GET    /api/organizations/{org_id}
  PATCH  /api/organizations/{org_id}                          owner / admin   rename
  DELETE /api/organizations/{org_id}                          admin   the venues stay; they just stop being grouped
  POST   /api/organizations/{org_id}/owners                   owner / admin   add an owner by email
  DELETE /api/organizations/{org_id}/owners/{user_id}         owner / admin
  POST   /api/organizations/{org_id}/venues                   admin   put a venue in
  DELETE /api/organizations/{org_id}/venues/{venue_id}        admin   take a venue out
  PATCH  /api/organizations/{org_id}/me                       owner   my own settings (venue alerts)
  GET    /api/organizations/{org_id}/overview                 every venue side by side
  GET    /api/organizations/{org_id}/people?q=                everyone on any of its venues' teams
  POST   /api/organizations/{org_id}/people/{worker_id}/share copy or move a person to other venues

There is no venue sign-up yet: only platform admins create organizations and decide which venues
are in them. An owner manages every venue in the organization through ordinary venue_managers
rows (via_org = TRUE) kept in step by services/organizations.sync_managers().
"""
import logging
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth import get_password_hash, normalize_role, require_admin, require_manager_or_admin
from src.database import get_db
from src.models import (
    Organization, OrganizationMember, User, Venue, VenuePosition, VenueWhitelist,
)
from src.routers.admin import _generate_temp_password
from src.routers.team import build_team
from src.schemas import (
    OrganizationCreate, OrganizationDetail, OrganizationUpdate, OrgChangeResult, OrgMyUpdate,
    OrgOverview, OrgOwnerAdd, OrgPerson, OrgPersonVenue, OrgShareBody, OrgShareResult, OrgShareSkip,
    OrgVenueAdd,
)
from src.services import activity, admin_audit, notify_events
from src.services import organizations as orgs
from src.services.invites import valid_email
from src.services.team import set_membership

logger = logging.getLogger("shiftboard.organizations")

router = APIRouter(prefix="/api/organizations", tags=["Organizations"])


def _is_admin(user: User) -> bool:
    return normalize_role(user.role) in ("platform_admin", "super_admin")


async def _result(db, org, user, message="Saved.", warnings=None, **kw) -> OrgChangeResult:
    return OrgChangeResult(
        organization=await orgs.detail(db, org, user), message=message, warnings=warnings or [], **kw
    )


# ---------------------------------------------------------------------------------------------
# Organizations
# ---------------------------------------------------------------------------------------------
@router.get("", response_model=List[OrganizationDetail])
async def list_organizations(
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    q = select(Organization).order_by(func.lower(Organization.name))
    if not _is_admin(current_user):
        mine = await orgs.owned_org_ids(db, current_user)
        if not mine:
            return []
        q = q.where(Organization.id.in_(mine))
    rows = (await db.execute(q)).scalars().all()
    return [await orgs.detail(db, o, current_user) for o in rows]


@router.post("", response_model=OrgChangeResult, status_code=status.HTTP_201_CREATED)
async def create_organization(
    body: OrganizationCreate,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    name = orgs.clean_name(body.name)
    if await orgs.name_taken(db, name):
        raise HTTPException(status_code=409, detail="An organization with that name already exists.")
    venue_ids = list(dict.fromkeys(body.venue_ids or []))
    venues = []
    if venue_ids:
        venues = (await db.execute(select(Venue).where(Venue.id.in_(venue_ids)))).scalars().all()
        if len(venues) != len(venue_ids):
            raise HTTPException(status_code=400, detail="One of those venues doesn't exist.")
        taken = [v.name for v in venues if v.organization_id is not None]
        if taken:
            raise HTTPException(
                status_code=409,
                detail=f"{', '.join(taken)} already belong{'s' if len(taken) == 1 else ''} to an organization. Take them out of it first.",
            )
    try:
        org = Organization(name=name, created_by_user_id=current_user.id)
        db.add(org)
        await db.flush()
        for v in venues:
            v.organization_id = org.id
        await orgs.sync_managers(db)
        await db.commit()
    except Exception as e:
        await db.rollback()
        logger.exception("create_organization failed")
        raise HTTPException(status_code=500, detail=f"Could not create the organization: {e}")
    await db.refresh(org)
    await admin_audit.record(current_user.id, "org_created", f"Created the organization {name}",
                             target_type="organization", target_id=org.id)
    return await _result(db, org, current_user, "Organization created. Add an owner next.")


@router.get("/{org_id}", response_model=OrganizationDetail)
async def get_organization(
    org_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    org = await orgs.load_org(db, org_id, current_user)
    return await orgs.detail(db, org, current_user)


@router.patch("/{org_id}", response_model=OrgChangeResult)
async def rename_organization(
    org_id: UUID,
    body: OrganizationUpdate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    org = await orgs.load_org(db, org_id, current_user)
    name = orgs.clean_name(body.name)
    if await orgs.name_taken(db, name, except_id=org.id):
        raise HTTPException(status_code=409, detail="An organization with that name already exists.")
    old = org.name
    try:
        org.name = name
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not rename it: {e}")
    await db.refresh(org)
    if _is_admin(current_user) and old != name:
        await admin_audit.record(current_user.id, "org_updated", f"Renamed the organization {old} to {name}",
                                 target_type="organization", target_id=org.id)
    return await _result(db, org, current_user)


@router.delete("/{org_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_organization(
    org_id: UUID,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """The venues, their managers, teams and history are untouched. Owners lose the venues they only had through it."""
    org = await orgs.load_org(db, org_id, current_user, admin_only=True)
    name = org.name
    try:
        for v in (await db.execute(select(Venue).where(Venue.organization_id == org.id))).scalars().all():
            v.organization_id = None
        await db.execute(delete(OrganizationMember).where(OrganizationMember.organization_id == org.id))
        await db.delete(org)
        await orgs.sync_managers(db)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not delete it: {e}")
    await admin_audit.record(current_user.id, "org_deleted", f"Deleted the organization {name}",
                             target_type="organization", target_id=org_id)
    return None


# ---------------------------------------------------------------------------------------------
# Owners
# ---------------------------------------------------------------------------------------------
@router.post("/{org_id}/owners", response_model=OrgChangeResult, status_code=status.HTTP_201_CREATED)
async def add_owner(
    org_id: UUID,
    body: OrgOwnerAdd,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """An existing manager account is linked. No account -> a manager account is created with a temporary
    password (returned once). Worker and admin accounts are refused."""
    org = await orgs.load_org(db, org_id, current_user)
    email = (body.email or "").strip().lower()
    if not valid_email(email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    temp = None
    created = False
    try:
        user = await db.scalar(select(User).where(func.lower(User.email) == email))
        if user is not None:
            role = normalize_role(user.role)
            if role == "platform_admin":
                raise HTTPException(status_code=400, detail="That's a platform admin; they can already manage every venue.")
            if role != "venue_manager":
                raise HTTPException(
                    status_code=409,
                    detail="That email belongs to a worker account. Owners need a manager account: ask a platform admin to change it, or use a different email.",
                )
            if not user.is_active:
                raise HTTPException(status_code=400, detail="That account is deactivated. Ask an admin to reactivate it.")
            if await orgs.is_owner(db, user, org.id):
                raise HTTPException(status_code=400, detail="They already own this organization.")
        else:
            first = (body.first_name or "").strip()[:100]
            if not first:
                raise HTTPException(status_code=400, detail="First name is required for a new account.")
            temp = _generate_temp_password()
            user = User(
                email=email, hashed_password=get_password_hash(temp), role="venue_manager",
                first_name=first, last_name=(body.last_name or "").strip()[:100],
                phone=(body.phone or "").strip()[:30] or None,
                skills=[], aggregate_rating=5.0, rating_count=0, total_shifts=0, is_active=True,
            )
            db.add(user)
            await db.flush()
            created = True
        who = admin_audit.person(user)
        db.add(OrganizationMember(organization_id=org.id, user_id=user.id, role=orgs.OWNER, venue_alerts=False))
        await orgs.sync_managers(db)
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.exception("add_owner failed")
        raise HTTPException(status_code=500, detail=f"Could not add the owner: {e}")
    await db.refresh(org)
    await admin_audit.record(current_user.id, "org_owner", f"Made {who} an owner of {org.name}",
                             target_type="organization", target_id=org.id)
    return await _result(
        db, org, current_user,
        ("Owner account created. Give them this temporary password; it's shown only once." if created
         else "Added. They manage every venue in this organization from their next page load."),
        created=created, temporary_password=temp,
    )


@router.delete("/{org_id}/owners/{user_id}", response_model=OrgChangeResult)
async def remove_owner(
    org_id: UUID,
    user_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    org = await orgs.load_org(db, org_id, current_user)
    admin = _is_admin(current_user)
    row = await db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == org.id, OrganizationMember.user_id == user_id,
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail="They don't own this organization.")
    if not admin:
        if user_id == current_user.id:
            raise HTTPException(status_code=400, detail="You can't remove yourself. Ask another owner or a platform admin.")
    target = await db.scalar(select(User).where(User.id == user_id))
    who = admin_audit.person(target)
    venue_ids = list((await db.execute(select(Venue.id).where(Venue.organization_id == org.id))).scalars().all())
    try:
        await db.delete(row)
        await orgs.sync_managers(db)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not remove the owner: {e}")
    await db.refresh(org)
    await admin_audit.record(current_user.id, "org_owner", f"Removed {who} as an owner of {org.name}",
                             target_type="organization", target_id=org.id)
    return await _result(db, org, current_user, "Removed. They keep any venue they manage directly.",
                         warnings=await orgs.venues_without_manager(db, venue_ids))


@router.patch("/{org_id}/me", response_model=OrgChangeResult)
async def update_my_membership(
    org_id: UUID,
    body: OrgMyUpdate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    org = await orgs.load_org(db, org_id, current_user)
    row = await db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == org.id, OrganizationMember.user_id == current_user.id,
        )
    )
    if row is None:
        raise HTTPException(status_code=400, detail="Only an owner of this organization has this setting.")
    try:
        row.venue_alerts = bool(body.venue_alerts)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save: {e}")
    return await _result(
        db, org, current_user,
        "You'll get each venue's manager alerts." if body.venue_alerts
        else "Venue alerts off. You still get them for venues you manage directly, and for a venue with no other manager.",
    )


# ---------------------------------------------------------------------------------------------
# Venues (platform admin only: there is no venue sign-up yet)
# ---------------------------------------------------------------------------------------------
@router.post("/{org_id}/venues", response_model=OrgChangeResult)
async def add_venue(
    org_id: UUID,
    body: OrgVenueAdd,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    org = await orgs.load_org(db, org_id, current_user, admin_only=True)
    venue = await db.scalar(select(Venue).where(Venue.id == body.venue_id))
    if venue is None:
        raise HTTPException(status_code=404, detail="Venue not found.")
    if venue.organization_id == org.id:
        raise HTTPException(status_code=400, detail="That venue is already in this organization.")
    if venue.organization_id is not None:
        other = await db.scalar(select(Organization.name).where(Organization.id == venue.organization_id))
        raise HTTPException(status_code=409, detail=f"{venue.name} belongs to {other}. Take it out of that organization first.")
    vname = venue.name
    try:
        venue.organization_id = org.id
        await orgs.sync_managers(db)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not add the venue: {e}")
    await db.refresh(org)
    await admin_audit.record(current_user.id, "org_venue", f"Put {vname} into {org.name}",
                             target_type="organization", target_id=org.id)
    return await _result(db, org, current_user, f"{vname} is in {org.name}. Its owners manage it now.")


@router.delete("/{org_id}/venues/{venue_id}", response_model=OrgChangeResult)
async def remove_venue(
    org_id: UUID,
    venue_id: UUID,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    org = await orgs.load_org(db, org_id, current_user, admin_only=True)
    venue = await db.scalar(select(Venue).where(Venue.id == venue_id, Venue.organization_id == org.id))
    if venue is None:
        raise HTTPException(status_code=404, detail="That venue isn't in this organization.")
    vname = venue.name
    try:
        venue.organization_id = None
        await orgs.sync_managers(db)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not take the venue out: {e}")
    await db.refresh(org)
    await admin_audit.record(current_user.id, "org_venue", f"Took {vname} out of {org.name}",
                             target_type="organization", target_id=org.id)
    return await _result(db, org, current_user, f"{vname} is on its own again.",
                         warnings=await orgs.venues_without_manager(db, [venue_id]))


# ---------------------------------------------------------------------------------------------
# The combined view
# ---------------------------------------------------------------------------------------------
@router.get("/{org_id}/overview", response_model=OrgOverview)
async def organization_overview(
    org_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    org = await orgs.load_org(db, org_id, current_user)
    return await orgs.overview(db, org)


async def _people(db: AsyncSession, org: Organization, only_ids: Optional[List[UUID]] = None) -> List[OrgPerson]:
    """Everyone with a team row at any venue of the organization (any status), one line per person."""
    venues = (await db.execute(
        select(Venue).where(Venue.organization_id == org.id).order_by(Venue.name.asc())
    )).scalars().all()
    leads = set((await db.execute(
        select(VenueWhitelist.venue_id, VenueWhitelist.worker_id).where(
            VenueWhitelist.venue_id.in_([v.id for v in venues] or [None]),
            VenueWhitelist.is_lead == True, VenueWhitelist.is_active == True,
        )
    )).all()) if venues else set()
    people = {}
    for v in venues:
        for m in await build_team(db, v.id, only_ids=only_ids):
            if not m.on_list and m.status == "none":
                continue
            p = people.get(m.worker_id)
            if p is None:
                p = people[m.worker_id] = OrgPerson(
                    worker_id=m.worker_id, first_name=m.first_name, last_name=m.last_name, email=m.email,
                    phone=m.phone, aggregate_rating=m.aggregate_rating, rating_count=m.rating_count, venues=[],
                )
            p.venues.append(OrgPersonVenue(
                venue_id=v.id, venue_name=v.name, status=m.status, positions=m.positions,
                is_lead=(v.id, m.worker_id) in leads, shifts_worked=m.shifts_worked, upcoming=m.upcoming,
                works_through=m.works_through,
            ))
    out = list(people.values())
    out.sort(key=lambda p: ((p.first_name or "").lower(), (p.last_name or "").lower()))
    return out


@router.get("/{org_id}/people", response_model=List[OrgPerson])
async def organization_people(
    org_id: UUID,
    q: Optional[str] = Query(None, max_length=100),
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    org = await orgs.load_org(db, org_id, current_user)
    people = await _people(db, org)
    needle = (q or "").strip().lower()
    if needle:
        people = [
            p for p in people
            if needle in f"{p.first_name} {p.last_name}".lower() or needle in (p.email or "").lower()
            or needle in (p.phone or "")
        ]
    return people


@router.post("/{org_id}/people/{worker_id}/share", response_model=OrgShareResult)
async def share_person(
    org_id: UUID,
    worker_id: UUID,
    body: OrgShareBody,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    copy: put this person on other venues' teams in the organization.
    move: the same, and take them off the from venue's team (their bookings there are not touched).
    Their positions come along where the other venue has a position with the same name, and their
    staffing company comes along where the other venue has none recorded. A venue that blocked them
    is skipped: unblock them there first.
    """
    org = await orgs.load_org(db, org_id, current_user)
    mode = (body.mode or "copy").strip().lower()
    if mode not in ("copy", "move"):
        raise HTTPException(status_code=400, detail="Choose copy or move.")
    target_ids = list(dict.fromkeys(body.to_venue_ids or []))
    if not target_ids:
        raise HTTPException(status_code=400, detail="Pick at least one venue.")
    if mode == "move" and body.from_venue_id is None:
        raise HTTPException(status_code=400, detail="Say which venue you're moving them from.")
    if body.from_venue_id is not None and body.from_venue_id in target_ids:
        raise HTTPException(status_code=400, detail="The venue they're coming from can't also be where they're going.")
    wanted = target_ids + ([body.from_venue_id] if body.from_venue_id is not None else [])
    venues = {
        v.id: v for v in (await db.execute(
            select(Venue).where(Venue.id.in_(wanted), Venue.organization_id == org.id)
        )).scalars().all()
    }
    if len(venues) != len(wanted):
        raise HTTPException(status_code=400, detail="All of the venues must be in this organization.")
    worker = await db.scalar(select(User).where(User.id == worker_id))
    if worker is None or normalize_role(worker.role) != "worker":
        raise HTTPException(status_code=404, detail="Worker not found.")
    if not worker.is_active:
        raise HTTPException(status_code=400, detail="That account is deactivated. Ask an admin to reactivate it.")
    name = f"{worker.first_name or ''} {worker.last_name or ''}".strip() or worker.email

    source = None
    if body.from_venue_id is not None:
        source = await db.scalar(
            select(VenueWhitelist).where(
                VenueWhitelist.venue_id == body.from_venue_id, VenueWhitelist.worker_id == worker_id,
            )
        )
        if source is None or (source.status or "active") != "active":
            raise HTTPException(status_code=400, detail=f"{name} isn't on {venues[body.from_venue_id].name}'s team.")
    source_positions = list(source.positions or []) if source is not None else []
    source_name = venues[body.from_venue_id].name if body.from_venue_id is not None else None

    added, added_ids, skipped = [], [], []
    try:
        for vid in target_ids:
            v = venues[vid]
            row = await db.scalar(
                select(VenueWhitelist).where(VenueWhitelist.venue_id == vid, VenueWhitelist.worker_id == worker_id)
            )
            if row is not None and (row.status or "active") == "blocked":
                skipped.append(OrgShareSkip(venue_name=v.name, reason="Blocked at this venue. Unblock them on its Team page first."))
                continue
            if row is not None and (row.status or "active") == "active":
                skipped.append(OrgShareSkip(venue_name=v.name, reason="Already on this team."))
                continue
            names = {
                (n or "").lower(): n for n in (await db.execute(
                    select(VenuePosition.name).where(VenuePosition.venue_id == vid, VenuePosition.is_active == True)
                )).scalars().all()
            }
            positions = [names[p.lower()] for p in source_positions if p and p.lower() in names]
            row = await set_membership(db, vid, worker_id, status="active", source="manager",
                                       positions=positions, added_by=current_user.id)
            if source is not None and not row.works_through and source.works_through:
                row.works_through = source.works_through
            added.append(v.name)
            added_ids.append(vid)
        moved = False
        if mode == "move" and added:
            source.status = "removed"
            source.is_active = False
            source.is_lead = False
            moved = True
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.exception("share_person failed")
        raise HTTPException(status_code=500, detail=f"Could not share them: {e}")

    for vid in added_ids:
        await activity.for_worker(
            "team_added", vid, worker_id, current_user.id,
            "Added {name} to the team" + (f" (from {source_name})".replace("{", "{{").replace("}", "}}") if source_name else ""),
        )
        await notify_events.team_added(vid, worker_id)
    if moved:
        await activity.for_worker("team_status", body.from_venue_id, worker_id, current_user.id,
                                  "Moved {name} to another venue in the organization")

    if not added:
        message = f"Nothing changed for {name}."
    elif moved:
        message = f"Moved {name} from {source_name} to {', '.join(added)}. Shifts they're already booked on at {source_name} are not changed."
    else:
        message = f"{name} is now on the team at {', '.join(added)}."
    people = await _people(db, org, only_ids=[worker_id])
    return OrgShareResult(added=added, skipped=skipped, moved=moved, message=message,
                          person=people[0] if people else None)
