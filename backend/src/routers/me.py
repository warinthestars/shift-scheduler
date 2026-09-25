"""
Phase 26.2: The signed-in worker's own calendar and "I've read this" acknowledgements.
"""
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import User
from src.schemas import WorkerCalendarResponse, InfoAckResponse
from src.auth import get_current_user
from src.services.worker_calendar import build_worker_calendar, acknowledge_info

router = APIRouter(prefix="/api/me", tags=["My Schedule"])


@router.get("/calendar", response_model=WorkerCalendarResponse)
async def my_calendar(
    start: Optional[datetime] = Query(None, description="Range start (ISO, default: 60 days ago)"),
    end: Optional[datetime] = Query(None, description="Range end (ISO, default: 180 days ahead)"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Every shift the worker is booked on or waiting for (plus cancelled / removed / no-show) in the range."""
    return await build_worker_calendar(db, current_user, start, end)


@router.post("/requests/{request_id}/ack", response_model=InfoAckResponse)
async def acknowledge_shift_info(
    request_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Worker confirms they've read the latest notes / changes for a booked shift."""
    stamp = await acknowledge_info(db, current_user, request_id)
    return InfoAckResponse(request_id=request_id, info_seen_at=stamp)
