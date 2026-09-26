"""
Phase 28: The signed-in user's notifications (the bell) and notification settings.
"""
from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import Notification, NotificationPreference, User, VenueManager
from src.schemas import (
    NotificationResponse, UnreadCountResponse,
    NotificationPreferencesResponse, NotificationPreferencesUpdate,
)
from src.auth import get_current_user, normalize_role
from src.services.notify import DEFAULT_PREFS, NEW_SHIFT_MODES, notify
from src.services.messaging import email_available, sms_available, normalize_phone

router = APIRouter(prefix="/api/notifications", tags=["Notifications"])


def _to_response(n: Notification) -> NotificationResponse:
    return NotificationResponse(
        id=n.id, kind=n.kind, title=n.title, body=n.body, link=n.link,
        urgent=bool(n.urgent), read=n.read_at is not None, created_at=n.created_at,
    )


@router.get("", response_model=List[NotificationResponse])
async def list_notifications(
    limit: int = Query(30, ge=1, le=100),
    before: Optional[datetime] = Query(None, description="Older than this (for 'load more')"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(Notification).where(Notification.user_id == current_user.id)
    if before is not None:
        q = q.where(Notification.created_at < before)
    rows = (await db.execute(q.order_by(Notification.created_at.desc()).limit(limit))).scalars().all()
    return [_to_response(n) for n in rows]


@router.get("/unread-count", response_model=UnreadCountResponse)
async def unread_count(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    n = await db.scalar(
        select(func.count(Notification.id)).where(
            Notification.user_id == current_user.id, Notification.read_at.is_(None)
        )
    )
    return UnreadCountResponse(count=int(n or 0))


@router.post("/{notification_id}/read", response_model=UnreadCountResponse)
async def mark_read(
    notification_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await db.execute(
            update(Notification)
            .where(Notification.id == notification_id, Notification.user_id == current_user.id, Notification.read_at.is_(None))
            .values(read_at=datetime.now(timezone.utc))
        )
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not update: {e}")
    return await unread_count(current_user, db)


@router.post("/read-all", response_model=UnreadCountResponse)
async def mark_all_read(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        await db.execute(
            update(Notification)
            .where(Notification.user_id == current_user.id, Notification.read_at.is_(None))
            .values(read_at=datetime.now(timezone.utc))
        )
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not update: {e}")
    return UnreadCountResponse(count=0)


async def _prefs_response(db: AsyncSession, user: User) -> NotificationPreferencesResponse:
    row = await db.scalar(select(NotificationPreference).where(NotificationPreference.user_id == user.id))
    values = dict(DEFAULT_PREFS)
    if row is not None:
        for k in DEFAULT_PREFS:
            values[k] = getattr(row, k)
    role = normalize_role(user.role)
    is_manager = role == "platform_admin" or bool(await db.scalar(
        select(func.count(VenueManager.user_id)).where(VenueManager.user_id == user.id)
    ))
    return NotificationPreferencesResponse(
        **values,
        email=user.email,
        phone=user.phone,
        email_available=email_available(),
        sms_available=sms_available(),
        is_manager=is_manager,
    )


@router.get("/preferences", response_model=NotificationPreferencesResponse)
async def get_preferences(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await _prefs_response(db, current_user)


@router.put("/preferences", response_model=NotificationPreferencesResponse)
async def update_preferences(
    body: NotificationPreferencesUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    data = body.model_dump(exclude_unset=True)
    if "new_shift_alerts" in data and data["new_shift_alerts"] not in NEW_SHIFT_MODES:
        raise HTTPException(status_code=400, detail="New-shift alerts must be off, instant or daily.")
    for key in ("quiet_start", "quiet_end"):
        if data.get(key) is not None and not (0 <= int(data[key]) <= 23):
            raise HTTPException(status_code=400, detail="Quiet hours must be whole hours from 0 to 23.")
    if "timezone" in data and data["timezone"]:
        try:
            ZoneInfo(data["timezone"])
        except Exception:
            raise HTTPException(status_code=400, detail=f"Unknown timezone '{data['timezone']}'.")
    phone = data.pop("phone", None)
    clear_quiet = data.pop("clear_quiet_hours", False)
    if phone is not None and phone.strip() and not normalize_phone(phone):
        raise HTTPException(status_code=400, detail="Enter a mobile number like (555) 555-0100 or +15555550100.")
    if data.get("sms_enabled") and not (normalize_phone(phone) if phone is not None else normalize_phone(current_user.phone)):
        raise HTTPException(status_code=400, detail="Add a mobile number to get texts.")

    try:
        row = await db.scalar(select(NotificationPreference).where(NotificationPreference.user_id == current_user.id))
        if row is None:
            row = NotificationPreference(user_id=current_user.id, **DEFAULT_PREFS)
            db.add(row)
        for key, value in data.items():
            if key in DEFAULT_PREFS and value is not None:
                setattr(row, key, value)
        if clear_quiet:
            row.quiet_start = None
            row.quiet_end = None
        if phone is not None:
            current_user.phone = phone.strip() or None
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save settings: {e}")
    return await _prefs_response(db, current_user)


@router.post("/test", response_model=UnreadCountResponse)
async def send_test(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Sends yourself a test through every channel you have turned on (email / text within a minute)."""
    await notify(
        [current_user.id], "test", "Test notification",
        "If you can read this, ShiftBoard can reach you here.", "/",
        urgent=True,
    )
    return await unread_count(current_user, db)
