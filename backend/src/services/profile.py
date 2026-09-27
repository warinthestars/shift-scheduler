"""
Phase 31 + 32: A worker's own profile (photo, contact, emergency contact, positions, bio),
weekly availability, time off and certificates, plus the builders managers' screens reuse.
"""
from collections import defaultdict
from datetime import datetime, date, timezone, timedelta
from typing import Dict, Iterable, List, Optional

from fastapi import HTTPException, UploadFile
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import (
    User, Venue, VenueManager, VenueWhitelist, Shift, ShiftEvent, ShiftRequest,
    WorkerAvailability, TimeOffRequest, WorkerCertification, UserFile,
)
from src.schemas import (
    MyProfile, AvailabilityWindow, TimeOffItem, CertificationItem, CertTypeInfo,
)
from src.services.fit import CERT_TYPES, cert_label, tz_of, as_utc
from src.services.team import WORKED_STATUSES, EXCLUDED_STATUSES
from src.auth import normalize_role

BOOKED_STATUSES = ("approved", "confirmed", "checked_in")
EXPIRING_DAYS = 30
MAX_AVATAR_BYTES = 2 * 1024 * 1024
MAX_CERT_BYTES = 5 * 1024 * 1024
IMAGE_TYPES = ("image/jpeg", "image/png", "image/webp")
CERT_FILE_TYPES = IMAGE_TYPES + ("application/pdf",)
MAX_WINDOWS = 21
MAX_TIME_OFF_DAYS = 60


def full_name(u: Optional[User]) -> str:
    if u is None:
        return ""
    n = f"{u.first_name or ''} {u.last_name or ''}".strip()
    return n or (u.email or "")


def today_utc() -> date:
    return datetime.now(timezone.utc).date()


# ---------------------------------------------------------------------------------------------
# Relationships
# ---------------------------------------------------------------------------------------------
async def team_venue_ids(db: AsyncSession, worker_id) -> set:
    """Venues where this worker is on the team: an active team-list row, or they've worked there
    (and weren't removed / blocked). Their managers see and decide the worker's time off."""
    rows = (await db.execute(
        select(VenueWhitelist.venue_id, VenueWhitelist.is_active, VenueWhitelist.status)
        .where(VenueWhitelist.worker_id == worker_id)
    )).all()
    listed = {v for v, active, st in rows if active and (st or "active") not in EXCLUDED_STATUSES}
    excluded = {v for v, _, st in rows if (st or "") in EXCLUDED_STATUSES}
    worked = set((await db.execute(
        select(Shift.venue_id).join(ShiftRequest, ShiftRequest.shift_id == Shift.id)
        .where(ShiftRequest.worker_id == worker_id, func.lower(ShiftRequest.status).in_(WORKED_STATUSES))
        .distinct()
    )).scalars().all())
    return listed | (worked - excluded)


async def related_venue_ids(db: AsyncSession, worker_id) -> set:
    """Any venue the worker has a connection to (team list in any state, or any request there)."""
    wl = set((await db.execute(select(VenueWhitelist.venue_id).where(VenueWhitelist.worker_id == worker_id))).scalars().all())
    req = set((await db.execute(
        select(Shift.venue_id).join(ShiftRequest, ShiftRequest.shift_id == Shift.id)
        .where(ShiftRequest.worker_id == worker_id).distinct()
    )).scalars().all())
    return wl | req


async def managed_venue_ids(db: AsyncSession, user: User) -> Optional[set]:
    """None = platform admin (every venue)."""
    if normalize_role(user.role) in ("platform_admin", "super_admin"):
        return None
    return set((await db.execute(select(VenueManager.venue_id).where(VenueManager.user_id == user.id))).scalars().all())


async def may_view_worker(db: AsyncSession, viewer: User, worker_id) -> bool:
    if viewer.id == worker_id:
        return True
    mine = await managed_venue_ids(db, viewer)
    if mine is None:
        return True
    return bool(mine & await related_venue_ids(db, worker_id))


# ---------------------------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------------------------
async def _names(db: AsyncSession, user_ids: Iterable, venue_ids: Iterable):
    uids = {u for u in user_ids if u}
    vids = {v for v in venue_ids if v}
    users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(uids)))).scalars().all()} if uids else {}
    venues = {v.id: v.name for v in (await db.execute(select(Venue).where(Venue.id.in_(vids)))).scalars().all()} if vids else {}
    return users, venues


async def cert_items(db: AsyncSession, certs: List[WorkerCertification]) -> List[CertificationItem]:
    users, venues = await _names(db, [c.verified_by_user_id for c in certs], [c.verified_venue_id for c in certs])
    today = today_utc()
    out = []
    for c in sorted(certs, key=lambda c: list(CERT_TYPES).index(c.cert_type) if c.cert_type in CERT_TYPES else 99):
        expired = c.expires_on is not None and c.expires_on < today
        out.append(CertificationItem(
            id=c.id, cert_type=c.cert_type, label=cert_label(c.cert_type), number=c.number,
            issued_on=c.issued_on, expires_on=c.expires_on, file_id=c.file_id, status=c.status or "unverified",
            verified_at=c.verified_at, verified_by_name=full_name(users.get(c.verified_by_user_id)) or None,
            verified_venue_name=venues.get(c.verified_venue_id), review_note=c.review_note,
            expired=expired,
            expiring_soon=(not expired and c.expires_on is not None and c.expires_on <= today + timedelta(days=EXPIRING_DAYS)),
        ))
    return out


async def time_off_items(db: AsyncSession, rows: List[TimeOffRequest], venue_id=None) -> List[TimeOffItem]:
    """conflicts = booked shifts inside each range (only this venue's when venue_id is given)."""
    if not rows:
        return []
    users, venues = await _names(
        db, [r.worker_id for r in rows] + [r.decided_by_user_id for r in rows], [r.decided_venue_id for r in rows],
    )
    worker_ids = {r.worker_id for r in rows}
    lo = min(r.start_date for r in rows) - timedelta(days=1)
    hi = max(r.end_date for r in rows) + timedelta(days=2)
    q = (
        select(ShiftRequest.worker_id, Shift, Venue)
        .join(Shift, Shift.id == ShiftRequest.shift_id)
        .join(Venue, Venue.id == Shift.venue_id)
        .where(
            ShiftRequest.worker_id.in_(worker_ids),
            func.lower(ShiftRequest.status).in_(BOOKED_STATUSES),
            Shift.start_time >= datetime(lo.year, lo.month, lo.day, tzinfo=timezone.utc),
            Shift.start_time < datetime(hi.year, hi.month, hi.day, tzinfo=timezone.utc),
        )
        .order_by(Shift.start_time.asc())
    )
    if venue_id is not None:
        q = q.where(Shift.venue_id == venue_id)
    booked = defaultdict(list)
    for wid, s, v in (await db.execute(q)).all():
        booked[wid].append((s, v))
    out = []
    for r in rows:
        conflicts = []
        for s, v in booked.get(r.worker_id, []):
            local = as_utc(s.start_time).astimezone(tz_of(v.timezone))
            if r.start_date <= local.date() <= r.end_date:
                label = f"{local.strftime('%a %b %-d')} · {s.role_type} · {s.title}"
                conflicts.append(label if venue_id is not None else f"{label} ({v.name})")
        out.append(TimeOffItem(
            id=r.id, worker_id=r.worker_id, worker_name=full_name(users.get(r.worker_id)) or None,
            start_date=r.start_date, end_date=r.end_date, reason=r.reason, status=r.status,
            decision_note=r.decision_note, decided_at=r.decided_at,
            decided_by_name=full_name(users.get(r.decided_by_user_id)) or None,
            decided_venue_name=venues.get(r.decided_venue_id), created_at=r.created_at, conflicts=conflicts,
        ))
    return out


async def availability_of(db: AsyncSession, worker_id) -> List[AvailabilityWindow]:
    return [
        AvailabilityWindow(weekday=a.weekday, start_local=a.start_local, end_local=a.end_local)
        for a in (await db.execute(
            select(WorkerAvailability).where(WorkerAvailability.worker_id == worker_id)
            .order_by(WorkerAvailability.weekday, WorkerAvailability.start_local)
        )).scalars().all()
    ]


async def upcoming_time_off(db: AsyncSession, worker_id, include_past_days: int = 0) -> List[TimeOffRequest]:
    return (await db.execute(
        select(TimeOffRequest).where(
            TimeOffRequest.worker_id == worker_id,
            TimeOffRequest.end_date >= today_utc() - timedelta(days=include_past_days),
        ).order_by(TimeOffRequest.start_date.asc())
    )).scalars().all()


def profile_missing(user: User, has_availability: bool) -> List[str]:
    missing = []
    if not (user.phone or "").strip():
        missing.append("phone")
    if not user.avatar_url:
        missing.append("photo")
    if not (user.emergency_contact_name and user.emergency_contact_phone):
        missing.append("emergency_contact")
    if not has_availability:
        missing.append("availability")
    return missing


async def build_my_profile(db: AsyncSession, user: User) -> MyProfile:
    avail = await availability_of(db, user.id)
    time_off = await time_off_items(db, list(await upcoming_time_off(db, user.id, include_past_days=30)))
    certs = await cert_items(db, list((await db.execute(
        select(WorkerCertification).where(WorkerCertification.worker_id == user.id)
    )).scalars().all()))
    is_worker = normalize_role(user.role) == "worker"
    return MyProfile(
        id=user.id, email=user.email, role=normalize_role(user.role),
        first_name=user.first_name or "", last_name=user.last_name or "", phone=user.phone,
        avatar_url=user.avatar_url, bio=user.bio, skills=list(user.skills or []),
        emergency_contact_name=user.emergency_contact_name, emergency_contact_phone=user.emergency_contact_phone,
        discoverable=user.discoverable or "private",
        availability=avail, time_off=time_off, certifications=certs,
        cert_types=[CertTypeInfo(key=k, **v) for k, v in CERT_TYPES.items()],
        missing=profile_missing(user, bool(avail)) if is_worker else [m for m in profile_missing(user, True) if m == "phone"],
    )


# ---------------------------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------------------------
async def read_upload(upload: UploadFile, allowed, max_bytes: int) -> bytes:
    ctype = (upload.content_type or "").lower()
    if ctype not in allowed:
        nice = "a JPG, PNG or WebP image" if "application/pdf" not in allowed else "a JPG, PNG, WebP or PDF file"
        raise HTTPException(status_code=400, detail=f"Please upload {nice}.")
    data = await upload.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HTTPException(status_code=400, detail=f"That file is too big (max {max_bytes // (1024 * 1024)} MB).")
    if not data:
        raise HTTPException(status_code=400, detail="That file is empty.")
    return data


def avatar_url(file_id) -> str:
    return f"/api/files/avatar/{file_id}"
