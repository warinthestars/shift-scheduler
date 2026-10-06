"""
Phase 36: who may do what at a venue.

  manage = a platform admin, or anyone with a venue_managers row for the venue. Organization owners
           have a row for every venue in their organization (services/organizations.py keeps those
           rows in step), so every existing manager check already covers them.
  floor  = manage, OR an active shift lead at the venue. A shift lead is a WORKER account whose
           team row has is_lead = TRUE.

Floor access is: the Today board, clocking people in and out, marking no-shows, fixing clock
times, the shift chat, and filling open spots from the team.
Floor access is NEVER: pay rates, tips, pay periods, exports, venue settings, the team list,
posting or editing events, or approving requests. Lead screens read through routers/lead.py,
whose response models have no pay fields.
"""
from typing import Iterable, List, Set
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth import normalize_role
from src.models import User, VenueWhitelist
from src.services.team import _team_filter
from src.services.venue_public import can_manage_venue

MANAGER = "manager"
LEAD = "lead"
NOT_FLOOR = "You don't run shifts at this venue."


async def is_shift_lead(db: AsyncSession, user: User, venue_id) -> bool:
    if normalize_role(user.role) != "worker" or not user.is_active:
        return False
    return bool(await db.scalar(
        select(VenueWhitelist.id).where(
            VenueWhitelist.venue_id == venue_id,
            VenueWhitelist.worker_id == user.id,
            VenueWhitelist.is_active == True,
            VenueWhitelist.is_lead == True,
        )
    ))


async def lead_venue_ids(db: AsyncSession, user: User) -> List:
    if normalize_role(user.role) != "worker" or not user.is_active:
        return []
    return list((await db.execute(
        select(VenueWhitelist.venue_id).where(
            VenueWhitelist.worker_id == user.id,
            VenueWhitelist.is_active == True,
            VenueWhitelist.is_lead == True,
        )
    )).scalars().all())


async def floor_access(db: AsyncSession, user: User, venue_id) -> str:
    """Returns MANAGER or LEAD. Raises 403 for everyone else."""
    if await can_manage_venue(db, user, venue_id):
        return MANAGER
    if await is_shift_lead(db, user, venue_id):
        return LEAD
    if normalize_role(user.role) == "worker":
        raise HTTPException(status_code=403, detail=NOT_FLOOR)
    raise HTTPException(status_code=403, detail="You don't manage this venue.")


async def team_ids(db: AsyncSession, venue_id, worker_ids: Iterable) -> Set[UUID]:
    """Which of these people are on the venue's team (on the list, or worked here and not removed / blocked)."""
    ids = [w for w in worker_ids if w]
    if not ids:
        return set()
    return set((await db.execute(
        select(User.id).where(User.id.in_(ids), _team_filter(venue_id))
    )).scalars().all())
