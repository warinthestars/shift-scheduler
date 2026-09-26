"""
Phase 26.1: Worker "Find Shifts" — one listing per event, one request per event.
"""
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import User, ShiftRequest
from src.schemas import EventListing, PositionRequestBody, PositionRequestResult
from src.auth import get_current_user, require_worker
from src.services.listings import build_listings
from src.services.booking import request_position, withdraw_request
from src.services import activity

router = APIRouter(prefix="/api/listings", tags=["Listings"])


@router.get("", response_model=List[EventListing])
async def list_open_events(
    venue_id: Optional[UUID] = Query(None, description="Only this venue"),
    days: int = Query(60, ge=1, le=180, description="How far ahead to look"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upcoming events with open spots (or with the viewer's active request), soonest first."""
    return await build_listings(db, current_user, venue_id=venue_id, days=days)


@router.get("/{event_id}", response_model=EventListing)
async def get_event_listing(
    event_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """One event for the details modal, in any state (full, started, cancelled)."""
    rows = await build_listings(db, current_user, event_id=event_id)
    if not rows:
        raise HTTPException(status_code=404, detail="Event not found.")
    return rows[0]


@router.post("/{event_id}/request", response_model=PositionRequestResult, status_code=status.HTTP_201_CREATED)
async def request_event_position(
    event_id: UUID,
    body: PositionRequestBody,
    current_user: User = Depends(require_worker),
    db: AsyncSession = Depends(get_db),
):
    """
    Request one position in this event. switch=true replaces the worker's WAITING request
    for another position in the same event. request_position() commits or rolls back.
    """
    request_id = await request_position(
        db, current_user, body.shift_id,
        note=body.note, switch=body.switch, expected_event_id=event_id,
    )
    await db.refresh(current_user)
    req_status = (await db.scalar(select(ShiftRequest.status).where(ShiftRequest.id == request_id)) or "").lower()
    instant = req_status in ("approved", "confirmed")
    rows = await build_listings(db, current_user, event_id=event_id)
    return PositionRequestResult(
        request_id=request_id,
        status=req_status,
        instant=instant,
        message="You're booked! It's on your schedule." if instant else "Request sent. The manager will review it.",
        listing=rows[0] if rows else None,
    )


@router.post("/requests/{request_id}/withdraw", response_model=PositionRequestResult)
async def withdraw_my_request(
    request_id: UUID,
    current_user: User = Depends(require_worker),
    db: AsyncSession = Depends(get_db),
):
    """Worker withdraws their own request that is still waiting for approval."""
    event_id = await withdraw_request(db, current_user, request_id)
    await activity.for_request("request_withdrawn", request_id, current_user.id)   # Phase 29.1
    await db.refresh(current_user)
    rows = await build_listings(db, current_user, event_id=event_id) if event_id else []
    return PositionRequestResult(
        request_id=request_id,
        status="withdrawn",
        instant=False,
        message="Request withdrawn.",
        listing=rows[0] if rows else None,
    )
