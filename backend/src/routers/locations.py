"""
Phase 27: A venue's saved locations (client sites, off-site events, second rooms).
Managers of the venue and platform admins only.
"""
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import User, Venue, VenueLocation
from src.schemas import VenueLocationInput, VenueLocationUpdate, VenueLocationResponse
from src.auth import require_manager_or_admin
from src.services.venue_public import can_manage_venue
from src.services.locations import create_location, update_location, usage_counts, to_response

router = APIRouter(prefix="/api/venues", tags=["Locations"])


async def _venue(db: AsyncSession, venue_id: UUID, user: User) -> Venue:
    venue = await db.scalar(select(Venue).where(Venue.id == venue_id))
    if venue is None:
        raise HTTPException(status_code=404, detail="Venue not found.")
    if not await can_manage_venue(db, user, venue.id):
        raise HTTPException(status_code=403, detail="You don't manage this venue.")
    return venue


async def _location(db: AsyncSession, venue: Venue, location_id: UUID) -> VenueLocation:
    loc = await db.scalar(select(VenueLocation).where(VenueLocation.id == location_id))
    if loc is None or loc.venue_id != venue.id:
        raise HTTPException(status_code=404, detail="Location not found.")
    return loc


async def _respond(db: AsyncSession, loc: VenueLocation) -> VenueLocationResponse:
    counts = await usage_counts(db, [loc.id])
    return to_response(loc, counts)


@router.get("/{venue_id}/locations", response_model=List[VenueLocationResponse])
async def list_locations(
    venue_id: UUID,
    include_archived: bool = Query(False),
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    venue = await _venue(db, venue_id, current_user)
    q = select(VenueLocation).where(VenueLocation.venue_id == venue.id)
    if not include_archived:
        q = q.where(VenueLocation.is_archived == False)
    rows = (await db.execute(q.order_by(VenueLocation.is_archived.asc(), VenueLocation.name.asc()))).scalars().all()
    counts = await usage_counts(db, [r.id for r in rows])
    return [to_response(r, counts) for r in rows]


@router.post("/{venue_id}/locations", response_model=VenueLocationResponse, status_code=status.HTTP_201_CREATED)
async def add_location(
    venue_id: UUID,
    body: VenueLocationInput,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    venue = await _venue(db, venue_id, current_user)
    try:
        loc = await create_location(db, venue.id, body)
        await db.commit()
        await db.refresh(loc)
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save location: {e}")
    return await _respond(db, loc)


@router.patch("/{venue_id}/locations/{location_id}", response_model=VenueLocationResponse)
async def edit_location(
    venue_id: UUID,
    location_id: UUID,
    body: VenueLocationUpdate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Global edit: every event at this location changes. Upcoming events are flagged 'Updated'."""
    venue = await _venue(db, venue_id, current_user)
    loc = await _location(db, venue, location_id)
    try:
        await update_location(db, loc, body)
        await db.commit()
        await db.refresh(loc)
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not update location: {e}")
    return await _respond(db, loc)


@router.post("/{venue_id}/locations/{location_id}/archive", response_model=VenueLocationResponse)
async def archive_location(
    venue_id: UUID,
    location_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Hide from the picker. Events already using it keep it."""
    venue = await _venue(db, venue_id, current_user)
    loc = await _location(db, venue, location_id)
    try:
        loc.is_archived = True
        await db.commit()
        await db.refresh(loc)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not archive location: {e}")
    return await _respond(db, loc)


@router.post("/{venue_id}/locations/{location_id}/unarchive", response_model=VenueLocationResponse)
async def unarchive_location(
    venue_id: UUID,
    location_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    venue = await _venue(db, venue_id, current_user)
    loc = await _location(db, venue, location_id)
    try:
        loc.is_archived = False
        await db.commit()
        await db.refresh(loc)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not restore location: {e}")
    return await _respond(db, loc)
