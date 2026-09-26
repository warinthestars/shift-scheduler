from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import User, Venue, ShiftEvent, Shift
from src.schemas import (
    EventCreate, EventUpdate, EventDetail, ReasonBody,
    DuplicateEventRequest, DuplicateEventResult, EventTimesheet,
)
from src.auth import require_manager_or_admin
from src.services.venue_public import can_manage_venue
from src.services.shift_events import (
    create_event_with_positions, update_event, build_event_detail, cancel_shifts, duplicate_event,
)
from src.services.timesheets import build_timesheet
from src.services import notify_events
from datetime import datetime, timezone

router = APIRouter(prefix="/api/events", tags=["Events"])


async def _load_managed_event(db: AsyncSession, event_id: UUID, user: User) -> ShiftEvent:
    event = await db.scalar(select(ShiftEvent).where(ShiftEvent.id == event_id))
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")
    if not await can_manage_venue(db, user, event.venue_id):
        raise HTTPException(status_code=403, detail="You don't manage this venue.")
    return event


async def _venue_for(db: AsyncSession, venue_id) -> Venue:
    venue = await db.scalar(select(Venue).where(Venue.id == venue_id))
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found.")
    return venue


@router.post("", response_model=EventDetail, status_code=status.HTTP_201_CREATED)
async def create_event(
    data: EventCreate,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    venue = await _venue_for(db, data.venue_id)
    if not await can_manage_venue(db, current_user, venue.id):
        raise HTTPException(status_code=403, detail="You don't manage this venue.")
    event = await create_event_with_positions(db, venue, current_user, data)
    detail = await build_event_detail(db, event)
    await notify_events.new_event_posted(event.id)          # Phase 28: tell the venue's team
    return detail


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
    since = datetime.now(timezone.utc)                      # Phase 28
    event = await _load_managed_event(db, event_id, current_user)
    await update_event(db, event, data)
    await db.refresh(event)
    detail = await build_event_detail(db, event)
    await notify_events.event_updated(event_id, since)      # Phase 28: tell booked people what changed
    return detail


@router.post("/{event_id}/cancel")
async def cancel_event(
    event_id: UUID,
    body: ReasonBody,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """Phase 26: Cancel the whole event. Everyone booked or waiting is marked cancelled with the reason."""
    since = datetime.now(timezone.utc)                      # Phase 28
    event = await _load_managed_event(db, event_id, current_user)
    affected = await cancel_shifts(db, event, None, body.reason)
    await notify_events.shifts_cancelled(event_id, since)   # Phase 28
    return {"detail": "Event cancelled.", "people_affected": affected}


@router.post("/{event_id}/positions/{shift_id}/cancel")
async def cancel_position(
    event_id: UUID,
    shift_id: UUID,
    body: ReasonBody,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """Phase 26: Cancel one position. If it was the last open position, the event is cancelled too."""
    since = datetime.now(timezone.utc)                      # Phase 28
    event = await _load_managed_event(db, event_id, current_user)
    affected = await cancel_shifts(db, event, [shift_id], body.reason)
    await notify_events.shifts_cancelled(event_id, since)   # Phase 28
    return {"detail": "Position cancelled.", "people_affected": affected}


@router.post("/{event_id}/duplicate", response_model=DuplicateEventResult)
async def duplicate(
    event_id: UUID,
    body: DuplicateEventRequest,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """Phase 26: Copy this event to one or more dates (same local start time)."""
    event = await _load_managed_event(db, event_id, current_user)
    venue = await _venue_for(db, event.venue_id)
    created = await duplicate_event(db, event, venue, current_user, body.dates)
    for ev in created:
        await notify_events.new_event_posted(ev.id)         # Phase 28
    return DuplicateEventResult(created_event_ids=[e.id for e in created], count=len(created))


@router.get("/{event_id}/timesheet", response_model=EventTimesheet)
async def get_timesheet(
    event_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    event = await _load_managed_event(db, event_id, current_user)
    venue = await _venue_for(db, event.venue_id)
    return await build_timesheet(db, event, venue)
