"""
Phase 36: organizations and their owners.

An organization groups venues. Each of its OWNERS manages every venue in it.

How that works without touching any existing permission check: an owner gets an ordinary
venue_managers row for every venue in the organization, marked via_org = TRUE.
sync_managers() below is the ONLY place those rows are created or deleted. Call it (before the
commit) whenever one of these changes:
    * an owner is added to or removed from an organization
    * a venue is put into or taken out of an organization
    * an organization is deleted
    * an admin changes a user's role or rebuilds their venue list
Rows a manager already had before becoming an owner keep via_org = FALSE and are never deleted here,
so taking someone off an organization only removes what the organization gave them.

Rules:
    * Owners are manager accounts (users.role = 'venue_manager'). A worker or admin can't be an owner.
    * Venue sign-up doesn't exist yet: platform admins create organizations and put venues in them.
"""
import logging
from datetime import datetime, timezone
from typing import Iterable, List, Optional

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth import normalize_role
from src.models import Organization, OrganizationMember, OrgRole, User, Venue, VenueManager
from src.schemas import OrganizationDetail, OrgOverview, OrgOwner, OrgVenue, OrgVenueToday
from src.services.public_board import venue_city

logger = logging.getLogger("shiftboard.organizations")

OWNER = OrgRole.owner.value


async def sync_managers(db: AsyncSession) -> None:
    """
    Make venue_managers match organization ownership. Does NOT commit.
    wanted = every (venue, owner) pair where the venue is in an organization the user owns.
      * a via_org row that is no longer wanted is deleted
      * a wanted pair with no row gets one (via_org = TRUE)
      * a wanted pair that already has a direct row is left exactly as it is
    """
    await db.flush()
    wanted = set((await db.execute(
        select(Venue.id, OrganizationMember.user_id)
        .join(OrganizationMember, OrganizationMember.organization_id == Venue.organization_id)
        .join(User, User.id == OrganizationMember.user_id)
        .where(OrganizationMember.role == OWNER, func.lower(User.role) == "venue_manager")
    )).all())
    have = {(r.venue_id, r.user_id): r for r in (await db.execute(select(VenueManager))).scalars().all()}
    for key, row in have.items():
        if row.via_org and key not in wanted:
            await db.delete(row)
    for venue_id, user_id in wanted:
        if (venue_id, user_id) not in have:
            db.add(VenueManager(venue_id=venue_id, user_id=user_id, is_primary=False, via_org=True))
    await db.flush()


async def drop_memberships_unless_manager(db: AsyncSession, user: User) -> None:
    """Owners are manager accounts. Call after a role change, before sync_managers(). Does NOT commit."""
    if normalize_role(user.role) != "venue_manager":
        await db.execute(delete(OrganizationMember).where(OrganizationMember.user_id == user.id))


async def owned_org_ids(db: AsyncSession, user: User) -> List:
    return list((await db.execute(
        select(OrganizationMember.organization_id).where(
            OrganizationMember.user_id == user.id, OrganizationMember.role == OWNER,
        )
    )).scalars().all())


async def is_owner(db: AsyncSession, user: User, organization_id) -> bool:
    return bool(await db.scalar(
        select(OrganizationMember.user_id).where(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.user_id == user.id,
            OrganizationMember.role == OWNER,
        )
    ))


async def owner_org_of_venue(db: AsyncSession, user_id, venue_id) -> Optional[Organization]:
    """The organization that makes this user a manager of this venue, if any."""
    return await db.scalar(
        select(Organization)
        .join(Venue, Venue.organization_id == Organization.id)
        .join(OrganizationMember, OrganizationMember.organization_id == Organization.id)
        .where(Venue.id == venue_id, OrganizationMember.user_id == user_id, OrganizationMember.role == OWNER)
    )


async def load_org(db: AsyncSession, organization_id, user: User, admin_only: bool = False) -> Organization:
    """404 if it doesn't exist. Platform admins: always. Owners: unless admin_only."""
    org = await db.scalar(select(Organization).where(Organization.id == organization_id))
    if org is None:
        raise HTTPException(status_code=404, detail="Organization not found.")
    if normalize_role(user.role) in ("platform_admin", "super_admin"):
        return org
    if admin_only:
        raise HTTPException(status_code=403, detail="Only a platform admin can do that.")
    if not await is_owner(db, user, org.id):
        raise HTTPException(status_code=403, detail="You don't own this organization.")
    return org


def clean_name(name: Optional[str]) -> str:
    name = " ".join((name or "").split())[:255]
    if not name:
        raise HTTPException(status_code=400, detail="Give the organization a name.")
    return name


async def name_taken(db: AsyncSession, name: str, except_id=None) -> bool:
    q = select(Organization.id).where(func.lower(Organization.name) == name.lower())
    if except_id is not None:
        q = q.where(Organization.id != except_id)
    return bool(await db.scalar(q))


async def detail(db: AsyncSession, org: Organization, viewer: Optional[User] = None) -> OrganizationDetail:
    owners = (await db.execute(
        select(OrganizationMember, User)
        .join(User, User.id == OrganizationMember.user_id)
        .where(OrganizationMember.organization_id == org.id, OrganizationMember.role == OWNER)
        .order_by(User.first_name.asc(), User.last_name.asc(), User.email.asc())
    )).all()
    venues = (await db.execute(
        select(Venue).where(Venue.organization_id == org.id).order_by(Venue.name.asc())
    )).scalars().all()
    direct = dict((await db.execute(
        select(VenueManager.venue_id, func.count(VenueManager.user_id))
        .where(VenueManager.venue_id.in_([v.id for v in venues] or [None]), VenueManager.via_org == False)
        .group_by(VenueManager.venue_id)
    )).all()) if venues else {}
    viewer_id = viewer.id if viewer is not None else None
    return OrganizationDetail(
        id=org.id,
        name=org.name,
        owners=[
            OrgOwner(
                user_id=u.id, first_name=u.first_name or "", last_name=u.last_name or "", email=u.email,
                phone=u.phone, venue_alerts=bool(m.venue_alerts), is_you=u.id == viewer_id,
            )
            for m, u in owners
        ],
        venues=[
            OrgVenue(
                id=v.id, name=v.name, city=venue_city(v), timezone=v.timezone or "America/New_York",
                managers=int(direct.get(v.id, 0)), public_board=bool(v.public_board),
            )
            for v in venues
        ],
        is_owner=any(u.id == viewer_id for _m, u in owners),
        created_at=org.created_at,
    )


async def venues_without_manager(db: AsyncSession, venue_ids: Iterable) -> List[str]:
    """Names of these venues that now have nobody managing them (for a warning, not an error)."""
    ids = [v for v in venue_ids if v]
    if not ids:
        return []
    managed = set((await db.execute(
        select(VenueManager.venue_id).where(VenueManager.venue_id.in_(ids)).distinct()
    )).scalars().all())
    names = (await db.execute(
        select(Venue.name).where(Venue.id.in_([v for v in ids if v not in managed] or [None])).order_by(Venue.name)
    )).scalars().all()
    return [f"{n} has no manager now. Add one in Admin → Venues." for n in names]


async def overview(db: AsyncSession, org: Organization) -> OrgOverview:
    """Every venue in the organization, side by side: today and the week ahead."""
    from src.services.tonight import build_tonight        # imported here: tonight imports a lot

    now = datetime.now(timezone.utc)
    venues = (await db.execute(
        select(Venue).where(Venue.organization_id == org.id).order_by(Venue.name.asc())
    )).scalars().all()
    cards = []
    for v in venues:
        t = await build_tonight(db, v)
        c = t.counts or {}
        week_events = [e for d in t.week for e in d.events if e.status != "draft"]
        upcoming = sorted((e for e in week_events if e.start_time > now), key=lambda e: e.start_time)
        cards.append(OrgVenueToday(
            venue_id=v.id,
            name=v.name,
            city=venue_city(v),
            timezone=t.timezone,
            events_today=int(c.get("events", 0)),
            live_now=sum(1 for e in t.events if e.state == "live"),
            booked_today=int(c.get("booked", 0)),
            clocked_in=int(c.get("clocked_in", 0)),
            late=int(c.get("late", 0)) + int(c.get("missed", 0)),
            open_spots_today=int(c.get("open_spots", 0)),
            open_spots_week=sum(e.open_spots for e in week_events),
            requests_waiting=sum(e.requested for e in week_events),
            events_week=len(week_events),
            next_event_title=upcoming[0].title if upcoming else None,
            next_event_start=upcoming[0].start_time if upcoming else None,
        ))
    keys = ("events_today", "live_now", "booked_today", "clocked_in", "late",
            "open_spots_today", "open_spots_week", "requests_waiting", "events_week")
    return OrgOverview(
        organization_id=org.id, name=org.name, now=now, venues=cards,
        totals={k: sum(getattr(c, k) for c in cards) for k in keys},
    )
