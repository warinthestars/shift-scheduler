"""
Phase 24: Who counts as a venue's "team", and who can take over a given shift.
Team = active workers who are on the venue whitelist OR have worked/been booked there before.
All subqueries use an aliased Shift table so correlation is unambiguous.

Phase 29: a team-list row now has a status (active | removed | blocked).
* 'active'  row -> on the team.
* 'removed' / 'blocked' row -> NOT on the team, even if they worked here before.
* 'blocked' also stops them requesting, being offered or assigned this venue's shifts.
"""
from typing import List
from uuid import UUID

from sqlalchemy import select, func, or_, and_, exists
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import User, Shift, ShiftRequest, VenueWhitelist

WORKED_STATUSES = ("approved", "confirmed", "checked_in", "completed", "transferred")
ACTIVE_BOOKING_STATUSES = ("approved", "confirmed", "checked_in")
ACTIVE_REQUEST_STATUSES = ("pending", "pending_manager_approval", "approved", "confirmed", "checked_in")


TEAM_STATUSES = ("active", "removed", "blocked")
EXCLUDED_STATUSES = ("removed", "blocked")


def _team_filter(venue_id: UUID):
    S = aliased(Shift)
    on_whitelist = (
        select(VenueWhitelist.id)
        .where(
            VenueWhitelist.venue_id == venue_id,
            VenueWhitelist.worker_id == User.id,
            VenueWhitelist.is_active == True,
        )
        .exists()
    )
    excluded = (
        select(VenueWhitelist.id)
        .where(
            VenueWhitelist.venue_id == venue_id,
            VenueWhitelist.worker_id == User.id,
            VenueWhitelist.status.in_(EXCLUDED_STATUSES),
        )
        .exists()
    )
    worked_there = (
        select(ShiftRequest.id)
        .join(S, ShiftRequest.shift_id == S.id)
        .where(
            ShiftRequest.worker_id == User.id,
            S.venue_id == venue_id,
            func.lower(ShiftRequest.status).in_(WORKED_STATUSES),
        )
        .exists()
    )
    return or_(on_whitelist, and_(worked_there, ~excluded))


async def is_blocked(db: AsyncSession, venue_id: UUID, worker_id: UUID) -> bool:
    """Phase 29: the venue blocked this person (no requests, offers or assignments)."""
    return bool(await db.scalar(
        select(VenueWhitelist.id).where(
            VenueWhitelist.venue_id == venue_id,
            VenueWhitelist.worker_id == worker_id,
            VenueWhitelist.status == "blocked",
        )
    ))


async def blocked_venue_ids(db: AsyncSession, worker_id: UUID) -> set:
    """Phase 29: venues that blocked this worker."""
    return set((await db.execute(
        select(VenueWhitelist.venue_id).where(
            VenueWhitelist.worker_id == worker_id,
            VenueWhitelist.status == "blocked",
        )
    )).scalars().all())


async def set_membership(
    db: AsyncSession,
    venue_id: UUID,
    worker_id: UUID,
    *,
    status: str = "active",
    source: str = "manager",
    positions: List[str] = None,
    added_by: UUID = None,
    merge_positions: bool = True,
) -> VenueWhitelist:
    """
    Phase 29: create or update this person's team-list row. Does NOT commit.
    positions: merged into the existing list (merge_positions=True) or replace it.
    """
    row = await db.scalar(
        select(VenueWhitelist).where(VenueWhitelist.venue_id == venue_id, VenueWhitelist.worker_id == worker_id)
    )
    clean = [p.strip()[:100] for p in (positions or []) if p and p.strip()]
    if row is None:
        row = VenueWhitelist(
            venue_id=venue_id, worker_id=worker_id, status=status, is_active=(status == "active"),
            source=source, positions=clean, added_by_user_id=added_by,
        )
        db.add(row)
    else:
        row.status = status
        row.is_active = status == "active"
        if positions is not None:
            if merge_positions:
                row.positions = list(dict.fromkeys(list(row.positions or []) + clean))
            else:
                row.positions = clean
    await db.flush()
    return row

async def get_venue_team(db: AsyncSession, venue_id: UUID, exclude_user_id: UUID = None) -> List[User]:
    q = select(User).where(
        func.lower(User.role) == "worker",
        User.is_active == True,
        _team_filter(venue_id),
    )
    if exclude_user_id:
        q = q.where(User.id != exclude_user_id)
    q = q.order_by(User.first_name.asc(), User.last_name.asc())
    return list((await db.execute(q)).scalars().all())


async def get_transfer_candidates(db: AsyncSession, shift: Shift, exclude_user_id: UUID) -> List[User]:
    """Venue team members who are free during the shift and not already on/requesting it."""
    S2 = aliased(Shift)
    overlapping_booking = (
        select(ShiftRequest.id)
        .join(S2, ShiftRequest.shift_id == S2.id)
        .where(
            ShiftRequest.worker_id == User.id,
            func.lower(ShiftRequest.status).in_(ACTIVE_BOOKING_STATUSES),
            S2.start_time < shift.end_time,
            S2.end_time > shift.start_time,
        )
        .exists()
    )
    already_on_this_shift = (
        select(ShiftRequest.id)
        .where(
            ShiftRequest.worker_id == User.id,
            ShiftRequest.shift_id == shift.id,
            func.lower(ShiftRequest.status).in_(ACTIVE_REQUEST_STATUSES),
        )
        .exists()
    )
    q = (
        select(User)
        .where(
            func.lower(User.role) == "worker",
            User.is_active == True,
            User.id != exclude_user_id,
            _team_filter(shift.venue_id),
            ~overlapping_booking,
            ~already_on_this_shift,
        )
        .order_by(User.first_name.asc(), User.last_name.asc())
    )
    return list((await db.execute(q)).scalars().all())
