"""
Phase 26.2: The signed-in worker's own calendar and "I've read this" acknowledgements.
"""
from datetime import date, datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import User
from src.schemas import WorkerCalendarResponse, InfoAckResponse, EarningsResponse
from src.auth import get_current_user
from src.services.worker_calendar import build_worker_calendar, acknowledge_info
from src.services.earnings import build_earnings, earnings_csv, PERIODS   # Phase 33.1

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


# ------------------------------------------------------------------------------
# Phase 33.1: Hours & pay
# ------------------------------------------------------------------------------
PERIOD_PATTERN = "^(" + "|".join(PERIODS) + ")$"


@router.get("/earnings", response_model=EarningsResponse)
async def my_earnings(
    period: str = Query("week", pattern=PERIOD_PATTERN, description="week | last_week | month | last_month | custom"),
    start: Optional[date] = Query(None, description="custom: first day (YYYY-MM-DD)"),
    end: Optional[date] = Query(None, description="custom: last day (YYYY-MM-DD)"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Your hours and pay (before tips and taxes) for a period, from your clock-ins. Weeks start on Monday."""
    try:
        return await build_earnings(db, current_user, period, start, end)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/earnings.csv")
async def my_earnings_csv(
    period: str = Query("month", pattern=PERIOD_PATTERN),
    start: Optional[date] = Query(None),
    end: Optional[date] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """The same as a spreadsheet, for your own records. Times are in each venue's local time."""
    try:
        filename, text = await earnings_csv(db, current_user, period, start, end)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return Response(content=text, media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})
