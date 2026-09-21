from typing import List, Dict, Any
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from src.database import get_db
from src.models import Venue, Shift, User, ShiftRequest, UserRole
from src.schemas import VenueResponse
from src.auth import require_admin

router = APIRouter(prefix="/api/admin", tags=["Admin"])

@router.get("/venues", response_model=List[VenueResponse])
async def get_admin_venues(
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """Retrieve all venues for platform administration"""
    result = await db.execute(select(Venue).order_by(Venue.name))
    return result.scalars().all()

@router.get("/stats")
async def get_admin_stats(
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """Retrieve system overview statistics"""
    venues = (await db.execute(select(Venue))).scalars().all()
    shifts = (await db.execute(select(Shift))).scalars().all()
    users = (await db.execute(select(User))).scalars().all()
    requests = (await db.execute(select(ShiftRequest))).scalars().all()

    workers_count = sum(1 for u in users if u.role in (UserRole.WORKER, "worker"))
    managers_count = sum(1 for u in users if u.role in (UserRole.VENUE_MANAGER, "venue_manager"))
    open_shifts = sum(1 for s in shifts if s.status == "OPEN")
    pending_requests = sum(1 for r in requests if r.status in ("PENDING", "pending"))

    return {
        "total_venues": len(venues),
        "total_shifts": len(shifts),
        "open_shifts": open_shifts,
        "total_workers": workers_count,
        "total_managers": managers_count,
        "total_requests": len(requests),
        "pending_requests": pending_requests
    }
