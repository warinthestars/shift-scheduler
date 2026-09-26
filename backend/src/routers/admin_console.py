"""
Phase 29.2: Admin console (platform admins only).

  GET  /api/admin/overview                     numbers, "needs attention", recent activity + admin log
  GET  /api/admin/venues/summary               one row per venue with health warnings
  GET  /api/admin/directory?q=&role=&status=&auth=&venue_id=&limit=&offset=   users, server-side paged
  GET  /api/admin/users/{user_id}/detail       one user: memberships, history, audit
  GET  /api/admin/activity?venue_id=&category=&before=&limit=   every venue's activity log
  GET  /api/admin/audit?target_type=&target_id=&before=&limit=  admin actions
  GET  /api/admin/system                       configuration + background worker + delivery health
  GET  /api/admin/deliveries?status=failed&limit=
  POST /api/admin/deliveries/{delivery_id}/retry
  POST /api/admin/deliveries/retry-failed
  POST /api/admin/test-email                   {to}
"""
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, or_, and_, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database import get_db
from src.models import (
    User, Venue, VenueManager, VenueWhitelist, VenuePosition, VenueLocation, Shift, ShiftEvent, ShiftRequest,
    ShiftTransfer, TimeEntry, VenueActivity, AdminAudit, Notification, NotificationDelivery, NotificationPreference,
)
from src.schemas import (
    AdminOverview, AdminAttention, AdminActivityItem, AdminAuditItem, AdminVenueRow, AdminPersonRef,
    AdminUserRow, AdminUserPage, AdminUserDetail, AdminHistoryItem, AdminMembership, AdminNameRef,
    AdminSystem, AdminDeliveryStats, AdminDelivery, AdminTestEmail, WorkerReliability,
)
from src.auth import require_admin, normalize_role
from src.serializers import auth_source_for
from src.services.always_admin import is_always_admin_email, get_always_admin_emails
from src.services.reliability import compute_reliability
from src.services.messaging import email_available, sms_available, send_email, render_email
from src.services.activity import CATEGORIES
from src.services import admin_audit

router = APIRouter(prefix="/api/admin", tags=["Admin console"])

WORKED = ("approved", "confirmed", "checked_in", "completed", "transferred")
FINISHED = ("approved", "confirmed", "checked_in", "completed")
BOOKED = ("approved", "confirmed", "checked_in")
PENDING = ("pending", "pending_manager_approval")


def _name(u: Optional[User]) -> str:
    if u is None:
        return ""
    return f"{u.first_name or ''} {u.last_name or ''}".strip() or (u.email or "")


async def _names(db: AsyncSession, ids) -> Dict[UUID, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: _name(u) for u in (await db.execute(select(User).where(User.id.in_(ids)))).scalars().all()}


def _base_url_ok() -> bool:
    url = (settings.APP_BASE_URL or "").strip()
    return bool(url) and "localhost" not in url and "127.0.0.1" not in url


# ---------------------------------------------------------------------------------------------
# Shared builders
# ---------------------------------------------------------------------------------------------
async def _audit_items(db: AsyncSession, q) -> List[AdminAuditItem]:
    rows = (await db.execute(q)).scalars().all()
    names = await _names(db, [r.actor_user_id for r in rows])
    return [
        AdminAuditItem(id=r.id, actor_name=names.get(r.actor_user_id), action=r.action, target_type=r.target_type,
                       target_id=r.target_id, summary=r.summary, created_at=r.created_at)
        for r in rows
    ]


async def _activity_items(db: AsyncSession, q) -> List[AdminActivityItem]:
    rows = (await db.execute(q)).all()
    names = await _names(db, [a.actor_user_id for a, _ in rows])
    return [
        AdminActivityItem(
            id=a.id, venue_id=a.venue_id, venue_name=vname, kind=a.kind, category=a.category, summary=a.summary,
            actor_name=names.get(a.actor_user_id), event_id=a.event_id, worker_id=a.worker_id, created_at=a.created_at,
        )
        for a, vname in rows
    ]


async def _user_rows(db: AsyncSession, users: List[User]) -> List[AdminUserRow]:
    if not users:
        return []
    ids = [u.id for u in users]
    now = datetime.now(timezone.utc)

    managed = defaultdict(list)
    for uid, vid, vname in (await db.execute(
        select(VenueManager.user_id, Venue.id, Venue.name).join(Venue, Venue.id == VenueManager.venue_id)
        .where(VenueManager.user_id.in_(ids)).order_by(Venue.name)
    )).all():
        managed[uid].append(AdminNameRef(id=vid, name=vname))

    members = defaultdict(dict)
    for wl, vname in (await db.execute(
        select(VenueWhitelist, Venue.name).join(Venue, Venue.id == VenueWhitelist.venue_id)
        .where(VenueWhitelist.worker_id.in_(ids))
    )).all():
        members[wl.worker_id][wl.venue_id] = AdminMembership(
            venue_id=wl.venue_id, venue_name=vname, status=wl.status or "active", source=wl.source,
            positions=list(wl.positions or []), notes=wl.notes,
        )
    for wid, vid, vname in (await db.execute(
        select(ShiftRequest.worker_id, Venue.id, Venue.name).distinct()
        .join(Shift, Shift.id == ShiftRequest.shift_id).join(Venue, Venue.id == Shift.venue_id)
        .where(ShiftRequest.worker_id.in_(ids), func.lower(ShiftRequest.status).in_(WORKED))
    )).all():
        if vid not in members[wid]:
            members[wid][vid] = AdminMembership(venue_id=vid, venue_name=vname, status="worked", source="worked")

    worked = dict((await db.execute(
        select(ShiftRequest.worker_id, func.count(ShiftRequest.id)).join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(ShiftRequest.worker_id.in_(ids), Shift.end_time < now, func.lower(ShiftRequest.status).in_(FINISHED))
        .group_by(ShiftRequest.worker_id)
    )).all())
    upcoming = dict((await db.execute(
        select(ShiftRequest.worker_id, func.count(ShiftRequest.id)).join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(ShiftRequest.worker_id.in_(ids), Shift.end_time >= now, func.lower(ShiftRequest.status).in_(BOOKED))
        .group_by(ShiftRequest.worker_id)
    )).all())
    last = dict((await db.execute(
        select(ShiftRequest.worker_id, func.max(ShiftRequest.created_at))
        .where(ShiftRequest.worker_id.in_(ids)).group_by(ShiftRequest.worker_id)
    )).all())

    out = []
    for u in users:
        out.append(AdminUserRow(
            id=u.id, first_name=u.first_name or "", last_name=u.last_name or "", email=u.email, phone=u.phone,
            avatar_url=u.avatar_url, role=normalize_role(u.role), is_active=bool(u.is_active),
            auth_source=auth_source_for(u), has_password=bool(u.hashed_password), created_at=u.created_at,
            managed_venues=managed.get(u.id, []),
            memberships=sorted(members.get(u.id, {}).values(), key=lambda m: m.venue_name.lower()),
            shifts_worked=int(worked.get(u.id, 0)), upcoming=int(upcoming.get(u.id, 0)),
            aggregate_rating=float(u.aggregate_rating or 0.0), rating_count=int(u.rating_count or 0),
            last_activity_at=last.get(u.id), discoverable=getattr(u, "discoverable", None) or "private",
            always_admin=is_always_admin_email(u.email),
        ))
    return out


# ---------------------------------------------------------------------------------------------
# Overview
# ---------------------------------------------------------------------------------------------
@router.get("/overview", response_model=AdminOverview)
async def overview(current_user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    now = datetime.now(timezone.utc)
    role_counts = defaultdict(int)
    deactivated = 0
    for role, active, n in (await db.execute(
        select(func.lower(User.role), User.is_active, func.count(User.id)).group_by(func.lower(User.role), User.is_active)
    )).all():
        role_counts[normalize_role(role)] += n
        if not active:
            deactivated += n
    new_7d = int(await db.scalar(select(func.count(User.id)).where(User.created_at >= now - timedelta(days=7))) or 0)
    venues = (await db.execute(select(Venue).order_by(Venue.name))).scalars().all()

    live = and_(func.upper(Shift.status) != "CANCELLED", Shift.start_time >= now)
    events_7d = int(await db.scalar(
        select(func.count(ShiftEvent.id)).where(
            ShiftEvent.cancelled_at.is_(None), ShiftEvent.start_time >= now, ShiftEvent.start_time < now + timedelta(days=7))
    ) or 0)
    cap, filled = (await db.execute(
        select(func.coalesce(func.sum(Shift.capacity), 0), func.coalesce(func.sum(Shift.spots_filled), 0))
        .where(live, Shift.start_time < now + timedelta(days=7))
    )).one()
    cap, filled = int(cap or 0), int(filled or 0)
    urgent_by_venue = dict((await db.execute(
        select(Shift.venue_id, func.sum(Shift.capacity - Shift.spots_filled))
        .where(live, Shift.start_time < now + timedelta(hours=48), Shift.spots_filled < Shift.capacity)
        .group_by(Shift.venue_id)
    )).all())
    pending = int(await db.scalar(
        select(func.count(ShiftRequest.id)).join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(func.lower(ShiftRequest.status).in_(PENDING), Shift.end_time > now, func.upper(Shift.status) != "CANCELLED")
    ) or 0)
    stale_by_venue = dict((await db.execute(
        select(Shift.venue_id, func.count(ShiftRequest.id)).join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(func.lower(ShiftRequest.status).in_(PENDING), Shift.end_time > now,
               func.upper(Shift.status) != "CANCELLED", ShiftRequest.created_at < now - timedelta(hours=24))
        .group_by(Shift.venue_id)
    )).all())
    handoffs = int(await db.scalar(
        select(func.count(ShiftTransfer.id)).where(func.lower(ShiftTransfer.status) == "pending_manager_approval")
    ) or 0)
    sent_24h = int(await db.scalar(select(func.count(NotificationDelivery.id)).where(
        NotificationDelivery.status == "sent", NotificationDelivery.sent_at >= now - timedelta(hours=24))) or 0)
    failed_24h = int(await db.scalar(select(func.count(NotificationDelivery.id)).where(
        NotificationDelivery.status == "failed", NotificationDelivery.created_at >= now - timedelta(hours=24))) or 0)

    mgr_counts = dict((await db.execute(
        select(VenueManager.venue_id, func.count(VenueManager.user_id)).group_by(VenueManager.venue_id)
    )).all())
    vname = {v.id: v.name for v in venues}

    attention: List[AdminAttention] = []
    if failed_24h:
        attention.append(AdminAttention(level="error", kind="deliveries",
                                        text=f"{failed_24h} email/text notification{'s' if failed_24h != 1 else ''} failed in the last 24 h."))
    for v in venues:
        if not mgr_counts.get(v.id):
            attention.append(AdminAttention(level="warn", kind="venue", target_id=v.id,
                                            text=f"{v.name} has no manager. Only platform admins can run it."))
    for vid, n in sorted(urgent_by_venue.items(), key=lambda x: -int(x[1] or 0)):
        if n:
            attention.append(AdminAttention(level="warn", kind="venue", target_id=vid,
                                            text=f"{vname.get(vid, 'A venue')}: {int(n)} open spot{'s' if n != 1 else ''} on shifts starting in the next 48 h."))
    for vid, n in stale_by_venue.items():
        attention.append(AdminAttention(level="warn", kind="venue", target_id=vid,
                                        text=f"{vname.get(vid, 'A venue')}: {n} request{'s' if n != 1 else ''} waiting over 24 h."))
    if not _base_url_ok():
        attention.append(AdminAttention(level="warn", kind="system",
                                        text="APP_BASE_URL isn't set to your public address, so links in emails point at localhost."))
    if not email_available():
        attention.append(AdminAttention(level="info", kind="system",
                                        text="Email is in console mode: notification emails are only written to the backend log."))

    recent = await _activity_items(db, (
        select(VenueActivity, Venue.name).join(Venue, Venue.id == VenueActivity.venue_id)
        .order_by(VenueActivity.created_at.desc()).limit(12)
    ))
    audit = await _audit_items(db, select(AdminAudit).order_by(AdminAudit.created_at.desc()).limit(6))

    return AdminOverview(
        users_total=sum(role_counts.values()), workers=role_counts.get("worker", 0),
        managers=role_counts.get("venue_manager", 0), admins=role_counts.get("platform_admin", 0),
        deactivated=deactivated, new_users_7d=new_7d, venues=len(venues), events_next_7d=events_7d,
        spots_next_7d=cap, open_spots_next_7d=max(0, cap - filled),
        fill_rate_next_7d=round(100.0 * filled / cap, 1) if cap else None,
        urgent_open_spots_48h=int(sum(int(n or 0) for n in urgent_by_venue.values())),
        pending_requests=pending, stale_requests_24h=int(sum(stale_by_venue.values())), pending_handoffs=handoffs,
        deliveries_sent_24h=sent_24h, deliveries_failed_24h=failed_24h,
        attention=attention, recent_activity=recent, recent_audit=audit,
    )


# ---------------------------------------------------------------------------------------------
# Venues
# ---------------------------------------------------------------------------------------------
@router.get("/venues/summary", response_model=List[AdminVenueRow])
async def venues_summary(current_user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    now = datetime.now(timezone.utc)
    venues = (await db.execute(select(Venue).order_by(Venue.name))).scalars().all()
    managers = defaultdict(list)
    for vid, u in (await db.execute(
        select(VenueManager.venue_id, User).join(User, User.id == VenueManager.user_id).order_by(User.first_name)
    )).all():
        managers[vid].append(AdminPersonRef(user_id=u.id, name=_name(u), email=u.email))
    team = dict((await db.execute(
        select(VenueWhitelist.venue_id, func.count(VenueWhitelist.id)).where(VenueWhitelist.status == "active")
        .group_by(VenueWhitelist.venue_id)
    )).all())
    events = dict((await db.execute(
        select(ShiftEvent.venue_id, func.count(ShiftEvent.id)).where(
            ShiftEvent.cancelled_at.is_(None), ShiftEvent.start_time >= now, ShiftEvent.start_time < now + timedelta(days=30))
        .group_by(ShiftEvent.venue_id)
    )).all())
    open7 = dict((await db.execute(
        select(Shift.venue_id, func.sum(Shift.capacity - Shift.spots_filled)).where(
            func.upper(Shift.status) != "CANCELLED", Shift.start_time >= now, Shift.start_time < now + timedelta(days=7),
            Shift.spots_filled < Shift.capacity)
        .group_by(Shift.venue_id)
    )).all())
    pend = dict((await db.execute(
        select(Shift.venue_id, func.count(ShiftRequest.id)).join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(func.lower(ShiftRequest.status).in_(PENDING), Shift.end_time > now, func.upper(Shift.status) != "CANCELLED")
        .group_by(Shift.venue_id)
    )).all())
    positions = dict((await db.execute(
        select(VenuePosition.venue_id, func.count(VenuePosition.id)).where(VenuePosition.is_active == True)
        .group_by(VenuePosition.venue_id)
    )).all())
    locations = dict((await db.execute(
        select(VenueLocation.venue_id, func.count(VenueLocation.id)).where(VenueLocation.is_archived == False)
        .group_by(VenueLocation.venue_id)
    )).all())
    last = dict((await db.execute(
        select(VenueActivity.venue_id, func.max(VenueActivity.created_at)).group_by(VenueActivity.venue_id)
    )).all())

    rows = []
    for v in venues:
        warnings = []
        if not managers.get(v.id):
            warnings.append("No manager")
        if not positions.get(v.id):
            warnings.append("No positions set up")
        if not team.get(v.id):
            warnings.append("No team yet")
        rows.append(AdminVenueRow(
            id=v.id, name=v.name, address=v.address, timezone=v.timezone or "America/New_York", created_at=v.created_at,
            managers=managers.get(v.id, []), team_active=int(team.get(v.id, 0)), upcoming_events=int(events.get(v.id, 0)),
            open_spots_7d=int(open7.get(v.id) or 0), pending_requests=int(pend.get(v.id, 0)),
            approval_policy=v.approval_policy or "team_auto", geofence_enabled=bool(v.geofence_enabled),
            positions_count=int(positions.get(v.id, 0)), locations_count=int(locations.get(v.id, 0)),
            last_activity_at=last.get(v.id), warnings=warnings,
        ))
    return rows


# ---------------------------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------------------------
@router.get("/directory", response_model=AdminUserPage)
async def directory(
    q: str = Query("", max_length=100),
    role: str = Query("all", pattern="^(all|worker|venue_manager|platform_admin)$"),
    status: str = Query("all", pattern="^(all|active|inactive)$"),
    auth: str = Query("all", pattern="^(all|local|firebase|both)$"),
    venue_id: Optional[UUID] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    conds = []
    term = (q or "").strip().lower()
    if term:
        like = f"%{term}%"
        conds.append(or_(
            func.lower(func.concat(User.first_name, " ", User.last_name)).like(like),
            func.lower(User.email).like(like),
            func.coalesce(User.phone, "").like(like),
        ))
    if role != "all":
        roles = ("platform_admin", "super_admin") if role == "platform_admin" else (role,)
        conds.append(func.lower(User.role).in_(roles))
    if status == "active":
        conds.append(User.is_active == True)
    elif status == "inactive":
        conds.append(User.is_active == False)
    if auth == "local":
        conds += [User.hashed_password.isnot(None), User.firebase_uid.is_(None)]
    elif auth == "firebase":
        conds += [User.firebase_uid.isnot(None), User.hashed_password.is_(None)]
    elif auth == "both":
        conds += [User.firebase_uid.isnot(None), User.hashed_password.isnot(None)]
    if venue_id is not None:
        conds.append(or_(
            User.id.in_(select(VenueManager.user_id).where(VenueManager.venue_id == venue_id)),
            User.id.in_(select(VenueWhitelist.worker_id).where(VenueWhitelist.venue_id == venue_id)),
            User.id.in_(select(ShiftRequest.worker_id).join(Shift, Shift.id == ShiftRequest.shift_id).where(Shift.venue_id == venue_id)),
        ))
    total = int(await db.scalar(select(func.count(User.id)).where(*conds)) or 0)
    users = (await db.execute(
        select(User).where(*conds).order_by(User.created_at.desc(), User.email).offset(offset).limit(limit)
    )).scalars().all()
    return AdminUserPage(total=total, items=await _user_rows(db, list(users)))


@router.get("/users/{user_id}/detail", response_model=AdminUserDetail)
async def user_detail(user_id: UUID, current_user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")
    row = (await _user_rows(db, [user]))[0]
    rel = (await compute_reliability(db, [user.id])).get(user.id)
    prefs = await db.scalar(select(NotificationPreference).where(NotificationPreference.user_id == user.id))
    hist = (await db.execute(
        select(ShiftRequest, Shift, Venue.name).join(Shift, Shift.id == ShiftRequest.shift_id).join(Venue, Venue.id == Shift.venue_id)
        .where(ShiftRequest.worker_id == user.id).order_by(Shift.start_time.desc()).limit(20)
    )).all()
    event_ids = {s.event_id for _, s, _ in hist if s.event_id}
    titles = {e.id: e.title for e in (await db.execute(select(ShiftEvent).where(ShiftEvent.id.in_(event_ids)))).scalars().all()} if event_ids else {}
    history = [
        AdminHistoryItem(
            request_id=r.id, venue_id=s.venue_id, venue_name=vn, event_id=s.event_id,
            title=titles.get(s.event_id) or s.title or "Shift", role_type=s.role_type or "Worker",
            start_time=s.start_time, end_time=s.end_time, status=(r.status or "").lower(),
        )
        for r, s, vn in hist
    ]
    audit = await _audit_items(db, (
        select(AdminAudit).where(AdminAudit.target_type == "user", AdminAudit.target_id == user.id)
        .order_by(AdminAudit.created_at.desc()).limit(15)
    ))
    return AdminUserDetail(
        user=row,
        reliability=WorkerReliability(worker_id=user.id, **rel) if rel else None,
        email_enabled=bool(prefs.email_enabled) if prefs else True,
        sms_enabled=bool(prefs.sms_enabled) if prefs else False,
        history=history, audit=audit,
    )


# ---------------------------------------------------------------------------------------------
# Activity + audit
# ---------------------------------------------------------------------------------------------
@router.get("/activity", response_model=List[AdminActivityItem])
async def all_activity(
    venue_id: Optional[UUID] = Query(None),
    category: Optional[str] = Query(None),
    before: Optional[datetime] = Query(None),
    limit: int = Query(40, ge=1, le=200),
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if category and category not in CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Category must be one of: {', '.join(CATEGORIES)}.")
    q = select(VenueActivity, Venue.name).join(Venue, Venue.id == VenueActivity.venue_id)
    if venue_id is not None:
        q = q.where(VenueActivity.venue_id == venue_id)
    if category:
        q = q.where(VenueActivity.category == category)
    if before is not None:
        q = q.where(VenueActivity.created_at < before)
    return await _activity_items(db, q.order_by(VenueActivity.created_at.desc()).limit(limit))


@router.get("/audit", response_model=List[AdminAuditItem])
async def audit_log(
    target_type: Optional[str] = Query(None, pattern="^(user|venue|system)$"),
    target_id: Optional[UUID] = Query(None),
    before: Optional[datetime] = Query(None),
    limit: int = Query(40, ge=1, le=200),
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    q = select(AdminAudit)
    if target_type:
        q = q.where(AdminAudit.target_type == target_type)
    if target_id is not None:
        q = q.where(AdminAudit.target_id == target_id)
    if before is not None:
        q = q.where(AdminAudit.created_at < before)
    return await _audit_items(db, q.order_by(AdminAudit.created_at.desc()).limit(limit))


# ---------------------------------------------------------------------------------------------
# System
# ---------------------------------------------------------------------------------------------
async def _delivery_stats(db: AsyncSession) -> AdminDeliveryStats:
    now = datetime.now(timezone.utc)

    async def count(*conds):
        return int(await db.scalar(select(func.count(NotificationDelivery.id)).where(*conds)) or 0)

    return AdminDeliveryStats(
        pending=await count(NotificationDelivery.status == "pending"),
        sent_24h=await count(NotificationDelivery.status == "sent", NotificationDelivery.sent_at >= now - timedelta(hours=24)),
        failed_24h=await count(NotificationDelivery.status == "failed", NotificationDelivery.created_at >= now - timedelta(hours=24)),
        failed_7d=await count(NotificationDelivery.status == "failed", NotificationDelivery.created_at >= now - timedelta(days=7)),
        skipped_24h=await count(NotificationDelivery.status == "skipped", NotificationDelivery.created_at >= now - timedelta(hours=24)),
    )


@router.get("/system", response_model=AdminSystem)
async def system_status(current_user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    from src.services.notification_worker import WORKER_STATE, HEARTBEAT_KEY
    firebase = "off"
    try:
        import src.services.firebase as firebase_service
        if settings.USE_MOCK_FIREBASE:
            firebase = "mock"
        elif firebase_service.load_firebase_web_config() is not None:
            firebase = "real"
    except Exception:
        firebase = "off"

    heartbeat = None
    try:
        import redis.asyncio as aioredis
        client = aioredis.from_url(settings.REDIS_URL, socket_timeout=2)
        raw = await client.get(HEARTBEAT_KEY)
        await client.aclose()
        if raw:
            heartbeat = datetime.fromisoformat(raw.decode() if isinstance(raw, bytes) else raw)
    except Exception:
        heartbeat = None

    counts = {}
    for label, model in (
        ("users", User), ("venues", Venue), ("events", ShiftEvent), ("shifts", Shift), ("requests", ShiftRequest),
        ("time_entries", TimeEntry), ("notifications", Notification), ("venue_activity", VenueActivity),
    ):
        counts[label] = int(await db.scalar(select(func.count()).select_from(model)) or 0)

    return AdminSystem(
        app_base_url=settings.APP_BASE_URL or "", app_base_url_ok=_base_url_ok(),
        email_provider=(settings.EMAIL_PROVIDER or "console").lower(), email_from=settings.EMAIL_FROM or "",
        email_ready=email_available(), sms_provider=(settings.SMS_PROVIDER or "off").lower(), sms_ready=sms_available(),
        firebase=firebase, self_registration=bool(settings.ALLOW_SELF_REGISTRATION),
        always_admin_count=len(get_always_admin_emails()),
        worker_enabled=bool(settings.NOTIFICATIONS_WORKER_ENABLED),
        worker_started_at=WORKER_STATE.get("started_at"), worker_last_tick_at=WORKER_STATE.get("last_tick_at"),
        worker_last_ok=WORKER_STATE.get("last_ok"), worker_last_error=WORKER_STATE.get("last_error"),
        worker_heartbeat_at=heartbeat, digest_hour=int(settings.NOTIFICATIONS_DIGEST_HOUR),
        deliveries=await _delivery_stats(db), table_counts=counts,
    )


@router.get("/deliveries", response_model=List[AdminDelivery])
async def deliveries(
    status: str = Query("failed", pattern="^(failed|pending|sent|skipped)$"),
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(NotificationDelivery, Notification.title, User)
        .join(Notification, Notification.id == NotificationDelivery.notification_id)
        .join(User, User.id == NotificationDelivery.user_id)
        .where(NotificationDelivery.status == status)
        .order_by(NotificationDelivery.created_at.desc()).limit(limit)
    )).all()
    return [
        AdminDelivery(
            id=d.id, channel=d.channel, status=d.status, attempts=d.attempts or 0, last_error=d.last_error,
            created_at=d.created_at, send_after=d.send_after, user_id=u.id, user_name=_name(u), user_email=u.email,
            title=title or "",
        )
        for d, title, u in rows
    ]


@router.post("/deliveries/{delivery_id}/retry")
async def retry_delivery(delivery_id: UUID, current_user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    d = await db.scalar(select(NotificationDelivery).where(NotificationDelivery.id == delivery_id))
    if d is None:
        raise HTTPException(status_code=404, detail="Delivery not found.")
    if d.status != "failed":
        raise HTTPException(status_code=400, detail="Only failed deliveries can be retried.")
    try:
        d.status = "pending"
        d.attempts = 0
        d.last_error = None
        d.send_after = datetime.now(timezone.utc)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not queue the retry: {e}")
    await admin_audit.record(current_user.id, "delivery_retry", f"Retried a failed {d.channel} delivery", target_type="system")
    return {"detail": "Queued. It goes out on the next worker tick (within a minute)."}


@router.post("/deliveries/retry-failed")
async def retry_all_failed(current_user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    now = datetime.now(timezone.utc)
    try:
        res = await db.execute(
            update(NotificationDelivery)
            .where(NotificationDelivery.status == "failed", NotificationDelivery.created_at >= now - timedelta(days=7))
            .values(status="pending", attempts=0, last_error=None, send_after=now)
        )
        n = int(res.rowcount or 0)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not queue the retries: {e}")
    if n:
        await admin_audit.record(current_user.id, "delivery_retry", f"Retried {n} failed deliveries", target_type="system")
    return {"detail": f"Queued {n} failed deliver{'y' if n == 1 else 'ies'} from the last 7 days.", "count": n}


@router.post("/test-email")
async def test_email(body: AdminTestEmail, current_user: User = Depends(require_admin)):
    to = str(body.to).strip()
    title = "ShiftBoard test email"
    text, html_body = render_email(title, f"Sent by {_name(current_user)} from the admin System page. If you can read this, email works.", "/", "/")
    ok, err = await send_email(to, title, text, html_body)
    await admin_audit.record(current_user.id, "test_email", f"Sent a test email to {to}: {'ok' if ok else 'failed'}", target_type="system")
    if not ok:
        raise HTTPException(status_code=502, detail=f"Sending failed: {err}")
    note = "" if email_available() else " (console mode: it was only written to the backend log)"
    return {"detail": f"Sent to {to}{note}."}
