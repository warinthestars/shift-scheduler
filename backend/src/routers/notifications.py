"""
Phase 28: The signed-in user's notifications (the bell) and notification settings.
"""
from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, update, delete
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.models import Notification, NotificationPreference, User, VenueManager, PushSubscription
from src.schemas import (
    NotificationResponse, UnreadCountResponse,
    NotificationPreferencesResponse, NotificationPreferencesUpdate,
    PushSubscribeBody, PushUnsubscribeBody, PushConfigResponse, PushDevice, PushTestResult,   # Phase 33
)
from src.auth import get_current_user, normalize_role
from src.services.notify import DEFAULT_PREFS, NEW_SHIFT_MODES, notify
from src.services.messaging import email_available, sms_available, normalize_phone
from src.services import webpush                                       # Phase 33
from src.services import fcm                                           # Phase 33.0.1

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
        discoverable=user.discoverable or "private",     # Phase 29.1
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
    discoverable = data.pop("discoverable", None)                      # Phase 29.1
    if discoverable is not None and discoverable not in ("private", "venues", "everyone"):
        raise HTTPException(status_code=400, detail="Who can find you must be private, venues or everyone.")
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
        if discoverable is not None:
            current_user.discoverable = discoverable
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


# ------------------------------------------------------------------------------
# Phase 33: Web Push devices (the installed app / browser). The bell and email / text are unchanged.
# ------------------------------------------------------------------------------
async def _push_config(db: AsyncSession, user: User) -> PushConfigResponse:
    _, public_b64 = await webpush.ensure_keys(db)
    subs = (await db.execute(
        select(PushSubscription).where(PushSubscription.user_id == user.id).order_by(PushSubscription.created_at.asc())
    )).scalars().all()
    client = fcm.client_config()                                             # Phase 33.0.1
    return PushConfigResponse(
        public_key=public_b64,
        devices=[PushDevice(id=s.id, provider=s.provider or "webpush", device_label=s.device_label, created_at=s.created_at,
                            last_success_at=s.last_success_at, last_error=s.last_error) for s in subs],
        provider="fcm" if client else "webpush",
        fcm_vapid_key=client["vapid_key"] if client else None,
        fcm_config=client["config"] if client else None,
    )


def _check_subscription(body: PushSubscribeBody) -> dict:
    """Validates the body and returns the row values (endpoint, p256dh, auth, provider). Raises 400."""
    if body.provider == "fcm":                                                # Phase 33.0.1
        token = (body.token or "").strip()
        if not fcm.ready():
            raise HTTPException(status_code=400, detail="Firebase messaging isn't set up on this server.")
        if len(token) < 20 or any(c.isspace() for c in token):
            raise HTTPException(status_code=400, detail="That device token isn't valid.")
        return dict(endpoint=token, p256dh=None, auth=None, provider="fcm")
    if body.provider != "webpush":
        raise HTTPException(status_code=400, detail="Unknown push provider.")
    if not body.endpoint or not body.endpoint.startswith("https://") or body.keys is None:
        raise HTTPException(status_code=400, detail="That push address isn't valid.")
    try:
        key = webpush.b64u_decode(body.keys.p256dh)
        secret = webpush.b64u_decode(body.keys.auth)
    except Exception:
        raise HTTPException(status_code=400, detail="That device's keys aren't valid.")
    if len(key) != 65 or key[0] != 4 or len(secret) != 16:
        raise HTTPException(status_code=400, detail="That device's keys aren't valid.")
    return dict(endpoint=body.endpoint, p256dh=body.keys.p256dh, auth=body.keys.auth, provider="webpush")


@router.get("/push", response_model=PushConfigResponse)
async def push_config(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """The key the browser needs to subscribe, and the devices this account turned on."""
    return await _push_config(db, current_user)


@router.post("/push/subscribe", response_model=PushConfigResponse)
async def push_subscribe(
    body: PushSubscribeBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Turn on notifications for this device. The same device signing in as someone else moves to them."""
    row = _check_subscription(body)
    label = (body.device_label or "").strip()[:120] or None
    try:
        await db.execute(
            pg_insert(PushSubscription)
            .values(user_id=current_user.id, device_label=label, created_at=datetime.now(timezone.utc), **row)
            .on_conflict_do_update(
                index_elements=["endpoint"],
                set_=dict(user_id=current_user.id, p256dh=row["p256dh"], auth=row["auth"], provider=row["provider"],
                          device_label=label, last_error=None),
            )
        )
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not turn on notifications: {e}")
    return await _push_config(db, current_user)


@router.post("/push/unsubscribe", response_model=PushConfigResponse)
async def push_unsubscribe(
    body: PushUnsubscribeBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Turn off notifications for this device (also used on sign-out)."""
    try:
        await db.execute(delete(PushSubscription).where(
            PushSubscription.endpoint == body.endpoint, PushSubscription.user_id == current_user.id))
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not turn off notifications: {e}")
    return await _push_config(db, current_user)


@router.delete("/push/devices/{device_id}", response_model=PushConfigResponse)
async def push_remove_device(
    device_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove one of your devices (e.g. an old phone)."""
    sub = await db.scalar(select(PushSubscription).where(
        PushSubscription.id == device_id, PushSubscription.user_id == current_user.id))
    if sub is None:
        raise HTTPException(status_code=404, detail="Device not found.")
    try:
        await db.delete(sub)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not remove the device: {e}")
    return await _push_config(db, current_user)


@router.post("/push/test", response_model=PushTestResult)
async def push_test(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Send a test to every device you turned on, right now (not through the outbox)."""
    try:
        reached, err = await webpush.send_to_user(db, current_user.id, {
            "title": "ShiftBoard notifications are on",
            "body": "This is how shift updates will reach this device.",
            "url": "/", "tag": "push-test", "urgent": False,
        })
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not send a test: {e}")
    return PushTestResult(reached=reached, error=None if reached else err)
