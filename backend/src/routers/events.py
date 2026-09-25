from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import User, Venue, ShiftEvent
from src.schemas import EventCreate, EventUpdate, EventDetail
from src.auth import require_manager_or_admin
from src.services.venue_public import can_manage_venue
from src.services.shift_events import create_event_with_positions, update_event, build_event_detail

router = APIRouter(prefix="/api/events", tags=["Events"])


async def _load_managed_event(db: AsyncSession, event_id: UUID, user: User) -> ShiftEvent:
    event = await db.scalar(select(ShiftEvent).where(ShiftEvent.id == event_id))
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")
    if not await can_manage_venue(db, user, event.venue_id):
        raise HTTPException(status_code=403, detail="You don't manage this venue.")
    return event


@router.post("", response_model=EventDetail, status_code=status.HTTP_201_CREATED)
async def create_event(
    data: EventCreate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    venue = await db.scalar(select(Venue).where(Venue.id == data.venue_id))
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found.")
    if not await can_manage_venue(db, current_user, venue.id):
        raise HTTPException(status_code=403, detail="You don't manage this venue.")
    event = await create_event_with_positions(db, venue, current_user, data)
    return await build_event_detail(db, event)


@router.get("/{event_id}", response_model=EventDetail)
async def get_event(
    event_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    event = await _load_managed_event(db, event_id, current_user)
    return await build_event_detail(db, event)


@router.put("/{event_id}", response_model=EventDetail)
async def edit_event(
    event_id: UUID,
    data: EventUpdate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    event = await _load_managed_event(db, event_id, current_user)
    await update_event(db, event, data)
    await db.refresh(event)
    return await build_event_detail(db, event)
