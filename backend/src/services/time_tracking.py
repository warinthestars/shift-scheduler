"""
Phase 35: Who clocks in with ShiftBoard, and who is on the venue's own payroll system.

  'shiftboard' : clock in / out in ShiftBoard; hours count in time sheets, exports, Hours & pay.
  'payroll'    : the venue's own payroll / time clock tracks their time. ShiftBoard shows no clock button,
                 sends no "not clocked in" alerts, and leaves them out of hours and pay. The shift counts as
                 worked unless a manager marks a no-show.

How it's decided for one person at one venue (first match wins):
  1. their team-member setting (venue_whitelists.time_tracking = 'payroll' | 'shiftboard')
  2. they work through another company (venue_whitelists.works_through set) -> 'shiftboard'  (overhire / agency)
  3. they're on the venue's team and the venue says team members use payroll
     (venues.team_time_tracking = 'payroll') -> 'payroll'
  4. otherwise -> 'shiftboard'  (people booked from outside the team always clock in here)

A booking follows the CURRENT settings until its shift starts. At the start, the background worker writes the
answer on the booking (shift_requests.time_tracking), so later settings changes never rewrite history.
"""
from datetime import datetime
from typing import Dict, Iterable, List, Optional, Tuple

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import Shift, ShiftRequest, Venue, VenueWhitelist

SHIFTBOARD = "shiftboard"
PAYROLL = "payroll"
MODES = (SHIFTBOARD, PAYROLL)
FREEZE_STATUSES = ("approved", "confirmed", "checked_in", "completed", "no_show")
COMPANY_MAX = 120


def resolve(venue_team_mode: Optional[str], member: Optional[VenueWhitelist]) -> str:
    """The rule above, for one venue + (optional) team-list row."""
    on_team = member is not None and member.status == "active" and bool(member.is_active)
    if member is not None and on_team and member.time_tracking in MODES:
        return member.time_tracking
    if member is not None and on_team and (member.works_through or "").strip():
        return SHIFTBOARD
    if on_team and venue_team_mode == PAYROLL:
        return PAYROLL
    return SHIFTBOARD


async def live_modes(db: AsyncSession, pairs: Iterable[Tuple]) -> Dict[Tuple, str]:
    """{(venue_id, worker_id): mode} from the current settings."""
    pairs = list({(v, w) for v, w in pairs if v is not None and w is not None})
    if not pairs:
        return {}
    venue_ids = list({v for v, _ in pairs})
    worker_ids = list({w for _, w in pairs})
    venue_mode = dict((await db.execute(
        select(Venue.id, Venue.team_time_tracking).where(Venue.id.in_(venue_ids))
    )).all())
    members = {(m.venue_id, m.worker_id): m for m in (await db.execute(
        select(VenueWhitelist).where(VenueWhitelist.venue_id.in_(venue_ids), VenueWhitelist.worker_id.in_(worker_ids))
    )).scalars().all()}
    return {(v, w): resolve(venue_mode.get(v), members.get((v, w))) for v, w in pairs}


async def modes_for_requests(db: AsyncSession, rows: Iterable[Tuple[ShiftRequest, Shift]]) -> Dict:
    """{request_id: mode}: the value written on the booking when its shift started, else the live setting."""
    rows = list(rows)
    need = [(s.venue_id, r.worker_id) for r, s in rows if r.time_tracking not in MODES]
    live = await live_modes(db, need)
    out = {}
    for r, s in rows:
        out[r.id] = r.time_tracking if r.time_tracking in MODES else live.get((s.venue_id, r.worker_id), SHIFTBOARD)
    return out


async def mode_for(db: AsyncSession, req: ShiftRequest, shift: Shift) -> str:
    return (await modes_for_requests(db, [(req, shift)]))[req.id]


async def freeze_started(db: AsyncSession, now: datetime) -> int:
    """Background worker, every minute: write the tracking mode on bookings whose shift has started.
    Does NOT commit. Returns how many were written."""
    rows = (await db.execute(
        select(ShiftRequest, Shift).join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(ShiftRequest.time_tracking.is_(None), Shift.start_time <= now,
               func.lower(ShiftRequest.status).in_(FREEZE_STATUSES))
        .limit(2000)
    )).all()
    if not rows:
        return 0
    modes = await modes_for_requests(db, rows)
    for r, _s in rows:
        r.time_tracking = modes[r.id]
    return len(rows)


def clean_company(value) -> Optional[str]:
    v = " ".join(str(value or "").split())[:COMPANY_MAX]
    return v or None


async def venue_companies(db: AsyncSession, venue_id) -> List[str]:
    """Companies named on this venue's team list (for filters)."""
    rows = (await db.execute(
        select(VenueWhitelist.works_through).where(
            VenueWhitelist.venue_id == venue_id, VenueWhitelist.works_through.isnot(None))
        .distinct()
    )).scalars().all()
    return sorted({r for r in rows if r}, key=str.lower)
