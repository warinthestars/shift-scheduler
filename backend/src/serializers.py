"""
Phase 24: Single safe way to turn a User ORM object into a UserResponse.
Uses explicit queries only - never touches lazy relationships (MissingGreenlet-safe).
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import User, Venue, VenueManager, VenueWhitelist
from src.schemas import UserResponse
from src.auth import normalize_role


async def get_user_affiliations(db: AsyncSession, user: User):
    """Returns (venue_ids, venue_names) for managers (managed venues) or workers (team/whitelist)."""
    role = normalize_role(user.role)
    if role == "venue_manager":
        rows = (await db.execute(
            select(VenueManager.venue_id, Venue.name)
            .join(Venue, VenueManager.venue_id == Venue.id)
            .where(VenueManager.user_id == user.id)
            .order_by(VenueManager.is_primary.desc(), Venue.name.asc())
        )).all()
    elif role == "worker":
        rows = (await db.execute(
            select(VenueWhitelist.venue_id, Venue.name)
            .join(Venue, VenueWhitelist.venue_id == Venue.id)
            .where(VenueWhitelist.worker_id == user.id, VenueWhitelist.is_active == True)
            .order_by(Venue.name.asc())
        )).all()
    else:
        rows = []
    return [r[0] for r in rows], [r[1] for r in rows]


async def build_user_response(db: AsyncSession, user: User) -> UserResponse:
    role = normalize_role(user.role)
    venue_ids, venue_names = await get_user_affiliations(db, user)
    return UserResponse(
        id=user.id,
        email=user.email,
        first_name=user.first_name or "",
        last_name=user.last_name or "",
        role=role,
        phone=user.phone,
        avatar_url=user.avatar_url,
        bio=user.bio,
        skills=user.skills or [],
        venue_id=str(venue_ids[0]) if (role == "venue_manager" and venue_ids) else None,
        venue_ids=venue_ids,
        venue_names=venue_names,
        aggregate_rating=float(user.aggregate_rating or 0.0),
        rating_count=int(user.rating_count or 0),
        total_shifts=int(user.total_shifts or 0),
        is_active=bool(user.is_active),
        created_at=user.created_at,
    )
