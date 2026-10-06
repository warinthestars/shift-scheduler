"""
Phase 36: endpoints that need NO sign-in.
  GET /api/public/config   what the web app needs before anyone signs in
  GET /api/public/board    the public event board (404 unless PUBLIC_EVENT_BOARD is on)

Nothing here may return pay, addresses, notes, people's names or ids of anything but the event.
See services/public_board.py for exactly what is shown.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database import get_db
from src.schemas import PublicBoard, PublicConfig
from src.services.public_board import DEFAULT_DAYS, MAX_DAYS, build_public_board

router = APIRouter(prefix="/api/public", tags=["Public"])


@router.get("/config", response_model=PublicConfig)
async def public_config():
    return PublicConfig(
        public_board=bool(settings.PUBLIC_EVENT_BOARD),
        self_registration=bool(settings.ALLOW_SELF_REGISTRATION),
    )


@router.get("/board", response_model=PublicBoard)
async def public_board(
    days: int = Query(DEFAULT_DAYS, ge=1, le=MAX_DAYS, description="How far ahead to look"),
    db: AsyncSession = Depends(get_db),
):
    if not settings.PUBLIC_EVENT_BOARD:
        raise HTTPException(status_code=404, detail="The public board is turned off.")
    return await build_public_board(db, days)
