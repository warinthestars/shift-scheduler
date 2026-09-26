"""
Phase 29.1: The venue activity log.

  GET /api/venues/{venue_id}/activity?category=&limit=30&before=<iso>
"""
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import User, VenueActivity
from src.schemas import ActivityItem
from src.auth import require_manager_or_admin
from src.routers.venues import verify_venue_manager_access
from src.services.activity import CATEGORIES, person

router = APIRouter(prefix="/api/venues", tags=["Activity"])


@router.get("/{venue_id}/activity", response_model=List[ActivityItem])
async def venue_activity(
    venue_id: UUID,
    category: Optional[str] = Query(None),
    limit: int = Query(30, ge=1, le=100),
    before: Optional[datetime] = Query(None, description="Older than this (for 'Load more')"),
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    await verify_venue_manager_access(venue_id, current_user, db)
    if category and category not in CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Category must be one of: {', '.join(CATEGORIES)}.")
    q = select(VenueActivity).where(VenueActivity.venue_id == venue_id)
    if category:
        q = q.where(VenueActivity.category == category)
    if before is not None:
        q = q.where(VenueActivity.created_at < before)
    rows = (await db.execute(q.order_by(VenueActivity.created_at.desc()).limit(limit))).scalars().all()
    actor_ids = {r.actor_user_id for r in rows if r.actor_user_id}
    actors = {u.id: person(u) for u in (await db.execute(select(User).where(User.id.in_(actor_ids)))).scalars().all()} if actor_ids else {}
    return [
        ActivityItem(
            id=r.id, kind=r.kind, category=r.category, summary=r.summary,
            actor_name=actors.get(r.actor_user_id), event_id=r.event_id, request_id=r.request_id,
            worker_id=r.worker_id, created_at=r.created_at,
        )
        for r in rows
    ]
