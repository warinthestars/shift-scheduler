"""
Phase 29.3: Event templates (the venue's reusable event setups). Venue managers of the venue, or platform admins.

  GET    /api/venues/{venue_id}/event-templates
  POST   /api/venues/{venue_id}/event-templates                  EventTemplateInput -> 201
  PUT    /api/venues/{venue_id}/event-templates/{template_id}    EventTemplateInput
  DELETE /api/venues/{venue_id}/event-templates/{template_id}    -> 204
  POST   /api/events/{event_id}/save-as-template                 {name} -> 201
"""
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import User, Venue, ShiftEvent, EventTemplate
from src.schemas import EventTemplateInput, EventTemplateResponse, SaveAsTemplateRequest
from src.auth import require_manager_or_admin
from src.services.venue_public import can_manage_venue
from src.services.event_templates import (
    list_templates, create_template, update_template, delete_template, template_from_event, to_responses,
)
from src.services import activity

router = APIRouter(tags=["Event templates"])


async def _venue(db: AsyncSession, venue_id: UUID, user: User) -> Venue:
    venue = await db.scalar(select(Venue).where(Venue.id == venue_id))
    if venue is None:
        raise HTTPException(status_code=404, detail="Venue not found.")
    if not await can_manage_venue(db, user, venue.id):
        raise HTTPException(status_code=403, detail="You don't manage this venue.")
    return venue


async def _template(db: AsyncSession, venue: Venue, template_id: UUID) -> EventTemplate:
    tpl = await db.scalar(select(EventTemplate).where(EventTemplate.id == template_id, EventTemplate.venue_id == venue.id))
    if tpl is None:
        raise HTTPException(status_code=404, detail="Template not found.")
    return tpl


@router.get("/api/venues/{venue_id}/event-templates", response_model=List[EventTemplateResponse])
async def get_templates(
    venue_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    venue = await _venue(db, venue_id, current_user)
    return await list_templates(db, venue.id)


@router.post("/api/venues/{venue_id}/event-templates", response_model=EventTemplateResponse, status_code=status.HTTP_201_CREATED)
async def post_template(
    venue_id: UUID,
    data: EventTemplateInput,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    venue = await _venue(db, venue_id, current_user)
    tpl = await create_template(db, venue, current_user, data)
    out = (await to_responses(db, [tpl]))[0]
    await activity.for_venue("template_saved", venue.id, current_user.id, f"Created the event template “{tpl.name}”")
    return out


@router.put("/api/venues/{venue_id}/event-templates/{template_id}", response_model=EventTemplateResponse)
async def put_template(
    venue_id: UUID,
    template_id: UUID,
    data: EventTemplateInput,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    venue = await _venue(db, venue_id, current_user)
    tpl = await update_template(db, venue, await _template(db, venue, template_id), data)
    out = (await to_responses(db, [tpl]))[0]
    await activity.for_venue("template_saved", venue.id, current_user.id, f"Edited the event template “{tpl.name}”")
    return out


@router.delete("/api/venues/{venue_id}/event-templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_template(
    venue_id: UUID,
    template_id: UUID,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    venue = await _venue(db, venue_id, current_user)
    tpl = await _template(db, venue, template_id)
    name = tpl.name
    await delete_template(db, tpl)
    await activity.for_venue("template_deleted", venue.id, current_user.id, f"Deleted the event template “{name}”")


@router.post("/api/events/{event_id}/save-as-template", response_model=EventTemplateResponse, status_code=status.HTTP_201_CREATED)
async def save_event_as_template(
    event_id: UUID,
    body: SaveAsTemplateRequest,
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    event = await db.scalar(select(ShiftEvent).where(ShiftEvent.id == event_id))
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found.")
    venue = await _venue(db, event.venue_id, current_user)
    tpl = await template_from_event(db, event, venue, current_user, body.name)
    out = (await to_responses(db, [tpl]))[0]
    await activity.for_venue("template_saved", venue.id, current_user.id,
                             f"Saved “{event.title}” as the event template “{tpl.name}”")
    return out
