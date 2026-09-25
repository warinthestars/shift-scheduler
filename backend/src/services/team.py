"""
Phase 24: Who counts as a venue's "team", and who can take over a given shift.
Team = active workers who are on the venue whitelist OR have worked/been booked there before.
All subqueries use an aliased Shift table so correlation is unambiguous.
"""
from typing import List
from uuid import UUID

from sqlalchemy import select, func, or_, exists
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import User, Shift, ShiftRequest, VenueWhitelist

WORKED_STATUSES = ("approved", "confirmed", "checked_in", "completed", "transferred")
ACTIVE_BOOKING_STATUSES = ("approved", "confirmed", "checked_in")
ACTIVE_REQUEST_STATUSES = ("pending", "pending_manager_approval", "approved", "confirmed", "checked_in")


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
    return or_(on_whitelist, worked_there)


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
