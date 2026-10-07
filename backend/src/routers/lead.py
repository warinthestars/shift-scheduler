"""
Phase 36: what a shift lead reads.

A shift lead is a WORKER account marked "shift lead" on a venue's team (venue_whitelists.is_lead).
They run the floor: see who's on today, clock people in and out, mark no-shows, fix clock times,
post on the shift chat, and fill open spots from the team. They never see pay.

  GET /api/lead/venues                       the venues where I'm a shift lead
  GET /api/lead/venues/{venue_id}/tonight    the Today board (the manager's board has no pay in it either)
  GET /api/lead/events/{event_id}/times      everyone's clock times for one event: hours, never pay

The response models here have NO pay fields. Never add one, and never return a manager schema
(EventTimesheet, EventDetail, ShiftRosterResponse, ...) from this file.

What a lead CHANGES goes through the existing endpoints, which accept managers and leads
(services/access.floor_access):
  POST   /api/requests/{id}/no-show          POST /api/requests/{id}/time-entries
  PATCH  /api/time-entries/{id}              POST /api/time-entries/{id}/delete
  GET    /api/shifts/{id}/candidates         POST /api/shifts/{id}/assign      POST /api/shifts/{id}/offers
  DELETE /api/offers/{id}                    GET / POST /api/shifts/{id}/messages
"""
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth import get_current_user
from src.database import get_db
from src.models import ShiftEvent, User, Venue
from src.schemas import LeadTimes, LeadTimesPerson, LeadVenue, TonightResponse
from src.services.access import LEAD, floor_access, lead_venue_ids
from src.services.timesheets import build_timesheet
from src.services.tonight import build_tonight

router = APIRouter(prefix="/api/lead", tags=["Shift lead"])


@router.get("/venues", response_model=List[LeadVenue])
async def my_lead_venues(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ids = await lead_venue_ids(db, current_user)
    if not ids:
        return []
    venues = (await db.execute(select(Venue).where(Venue.id.in_(ids)).order_by(Venue.name.asc()))).scalars().all()
    return [LeadVenue(venue_id=v.id, name=v.name, timezone=v.timezone or "America/New_York") for v in venues]


@router.get("/venues/{venue_id}/tonight", response_model=TonightResponse)
async def lead_tonight(
    venue_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    access = await floor_access(db, current_user, venue_id)
    venue = await db.scalar(select(Venue).where(Venue.id == venue_id))
    if venue is None:
        raise HTTPException(status_code=404, detail="Venue not found.")
    board = await build_tonight(db, venue)
    if access == LEAD:
        for day in board.week:                      # drafts are the manager's business
            day.events = [e for e in day.events if e.status != "draft"]
    return board


@router.get("/events/{event_id}/times", response_model=LeadTimes)
async def lead_event_times(
    event_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    event = await db.scalar(select(ShiftEvent).where(ShiftEvent.id == event_id))
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found.")
    await floor_access(db, current_user, event.venue_id)
    if (event.status or "published") == "draft":
        raise HTTPException(status_code=404, detail="Event not found.")
    venue = await db.scalar(select(Venue).where(Venue.id == event.venue_id))
    sheet = await build_timesheet(db, event, venue)
    people = [
        LeadTimesPerson(
            request_id=p.request_id, worker_id=p.worker_id, name=p.name, shift_id=p.shift_id,
            role_type=p.role_type, shift_start=p.shift_start, status=p.status, status_reason=p.status_reason, entries=p.entries,
            total_hours=p.total_hours, time_tracking=p.time_tracking, is_you=p.worker_id == current_user.id,
        )
        for p in sheet.people
    ]
    return LeadTimes(
        event_id=sheet.event_id, venue_id=event.venue_id, title=sheet.title, start_time=sheet.start_time,
        end_time=sheet.end_time, timezone=sheet.timezone, cancelled=sheet.cancelled, started=sheet.started,
        people=people, total_hours=sheet.total_hours,
    )
