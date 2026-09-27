"""
Phase 31 + 32: Does this person fit this shift?

  availability  - 'fits' | 'outside' | 'not_set'
                  Weekly windows are wall-clock times WHERE THEY WORK, so a shift is judged in its venue's
                  time zone. A shift fits when it sits entirely inside one window. Windows may run past
                  midnight (end earlier than start, or '24:00'). No windows at all = 'not_set' (never warns).
  time off      - 'blocked' | None   (Phase 32.1)
                  The worker's time-off blocks (services/time_off.py): full or partial days, one-off or repeating.
                  A shift is 'blocked' when it overlaps any occurrence. Nobody approves blocks.
  certificates  - labels of what's missing for a position, e.g. ["Alcohol server card"]
                  A certificate counts when it isn't rejected and hasn't expired by the shift's local date.
                  Unverified certificates count (managers see the "not verified" badge).

Everything is loaded in bulk (one query per table) so candidate lists and listings stay fast.
"""
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, date, time, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Tuple
from zoneinfo import ZoneInfo

from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import WorkerAvailability, TimeOffBlock, WorkerCertification, VenuePosition
from src.services.time_off import BlockSpec, overlapping_block

# The certificate catalogue. Keys are stored in VARCHAR columns (no DB enum).
CERT_TYPES: Dict[str, dict] = {
    "alcohol_server": {"label": "Alcohol server card", "hint": "TIPS, RBS, ServSafe Alcohol or your state's card", "expires": True},
    "food_handler": {"label": "Food handler card", "hint": "ServSafe Food Handler or your county's card", "expires": True},
    "food_manager": {"label": "Food protection manager", "hint": "ServSafe Manager or equivalent", "expires": True},
    "age_21": {"label": "21+ confirmed", "hint": "A manager checks your ID in person and marks it verified", "expires": False},
    "security_license": {"label": "Security guard license", "hint": "State guard card", "expires": True},
    "first_aid": {"label": "First aid / CPR", "hint": "Red Cross, AHA or similar", "expires": True},
}


def cert_label(key: str) -> str:
    return CERT_TYPES.get(key, {}).get("label", key.replace("_", " ").capitalize())


def as_utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def tz_of(name: Optional[str]) -> ZoneInfo:
    try:
        return ZoneInfo(name or "America/New_York")
    except Exception:
        return ZoneInfo("America/New_York")


def parse_hm(value: str) -> Tuple[int, int]:
    """'HH:MM' (00:00-24:00) -> (h, m). Raises ValueError on bad input."""
    v = (value or "").strip()
    if len(v) != 5 or v[2] != ":":
        raise ValueError(f"Time must look like 18:30 (got '{value}').")
    h, m = int(v[:2]), int(v[3:])
    if not (0 <= h <= 24 and 0 <= m <= 59) or (h == 24 and m != 0):
        raise ValueError(f"'{value}' isn't a valid time.")
    return h, m


def _window_bounds(day: date, start_local: str, end_local: str, tz: ZoneInfo) -> Tuple[datetime, datetime]:
    sh, sm = parse_hm(start_local)
    eh, em = parse_hm(end_local)
    start = datetime.combine(day, time(sh % 24, sm), tzinfo=tz)
    end_day = day + timedelta(days=1) if (eh, em) == (24, 0) or (eh, em) <= (sh, sm) else day
    end = datetime.combine(end_day, time(eh % 24, em), tzinfo=tz)
    return start, end


def availability_fit(windows: List[Tuple[int, str, str]], start: datetime, end: datetime, tz: ZoneInfo) -> str:
    if not windows:
        return "not_set"
    s_loc, e_loc = as_utc(start).astimezone(tz), as_utc(end).astimezone(tz)
    for day in (s_loc.date(), s_loc.date() - timedelta(days=1)):   # yesterday's overnight window can cover early hours
        wd = day.weekday()
        for w_day, w_start, w_end in windows:
            if w_day != wd:
                continue
            try:
                ws, we = _window_bounds(day, w_start, w_end, tz)
            except ValueError:
                continue
            if ws <= s_loc and e_loc <= we:
                return "fits"
    return "outside"


def shift_local_days(start: datetime, end: datetime, tz: ZoneInfo) -> Tuple[date, date]:
    s_loc, e_loc = as_utc(start).astimezone(tz), as_utc(end).astimezone(tz)
    last = (e_loc - timedelta(microseconds=1)).date() if e_loc > s_loc else s_loc.date()
    return s_loc.date(), max(s_loc.date(), last)


def missing_certs(required: Iterable[str], held: Dict[str, Tuple[str, Optional[date]]], on_day: date) -> List[str]:
    """required: cert keys. held: key -> (status, expires_on). Returns labels of what's missing / expired / rejected."""
    out = []
    for key in required or []:
        h = held.get(key)
        if h is None:
            out.append(cert_label(key))
        elif h[0] == "rejected":
            out.append(f"{cert_label(key)} (not accepted)")
        elif h[1] is not None and h[1] < on_day:
            out.append(f"{cert_label(key)} (expired)")
    return out


def unverified_certs(required: Iterable[str], held: Dict[str, Tuple[str, Optional[date]]]) -> List[str]:
    return [cert_label(k) for k in required or [] if k in held and held[k][0] == "unverified"]


@dataclass
class WorkerFit:
    windows: List[Tuple[int, str, str]] = field(default_factory=list)
    time_off: List[BlockSpec] = field(default_factory=list)          # Phase 32.1: time-off blocks
    certs: Dict[str, Tuple[str, Optional[date]]] = field(default_factory=dict)

    def availability(self, start, end, tz) -> str:
        return availability_fit(self.windows, start, end, tz)

    def off_block(self, start, end, tz) -> Optional[BlockSpec]:
        return overlapping_block(self.time_off, start, end, tz)

    def off(self, start, end, tz) -> Optional[str]:
        return "blocked" if self.off_block(start, end, tz) is not None else None

    def missing(self, required, start, end, tz) -> List[str]:
        return missing_certs(required, self.certs, shift_local_days(start, end, tz)[1])


async def load_fit(db: AsyncSession, worker_ids: Iterable) -> Dict:
    """worker_id -> WorkerFit, three queries total."""
    ids = list({w for w in worker_ids if w})
    out = {w: WorkerFit() for w in ids}
    if not ids:
        return out
    for a in (await db.execute(
        select(WorkerAvailability).where(WorkerAvailability.worker_id.in_(ids))
        .order_by(WorkerAvailability.weekday, WorkerAvailability.start_local)
    )).scalars().all():
        out[a.worker_id].windows.append((int(a.weekday), a.start_local, a.end_local))
    today = datetime.now(timezone.utc).date() - timedelta(days=1)
    for t in (await db.execute(
        select(TimeOffBlock).where(
            TimeOffBlock.worker_id.in_(ids), or_(TimeOffBlock.end_date.is_(None), TimeOffBlock.end_date >= today),
        )
    )).scalars().all():
        out[t.worker_id].time_off.append(BlockSpec.of(t))
    for c in (await db.execute(select(WorkerCertification).where(WorkerCertification.worker_id.in_(ids)))).scalars().all():
        out[c.worker_id].certs[c.cert_type] = (c.status, c.expires_on)
    return out


async def load_requirements(db: AsyncSession, venue_ids: Iterable) -> Dict:
    """(venue_id, position name lower) -> [cert keys]. Positions are matched to shifts by name (shift.role_type)."""
    ids = list({v for v in venue_ids if v})
    if not ids:
        return {}
    req = {}
    for p in (await db.execute(
        select(VenuePosition).where(VenuePosition.venue_id.in_(ids), func.cardinality(VenuePosition.required_certs) > 0)
    )).scalars().all():
        req[(p.venue_id, (p.name or "").strip().lower())] = list(p.required_certs or [])
    return req


def required_for(reqs: Dict, shift) -> List[str]:
    return reqs.get((shift.venue_id, (shift.role_type or "").strip().lower()), [])


def availability_text(fit: str) -> Optional[str]:
    return {"outside": "Outside their availability"}.get(fit)
