"""
Phase 35: Pay periods, overtime and approving / locking a period.

Everything here is in the VENUE's time zone and works on ShiftBoard time entries (people whose time the venue's
own payroll tracks have no entries; they are listed separately so the manager can cross-check).

Pay periods (venues.pay_period):
  weekly       7 days starting on the venue's work-week start day (venues.work_week_start, 0 = Monday)
  biweekly     14 days counted from venues.pay_period_anchor (any first day of a pay period)
  semimonthly  the 1st to the 15th, and the 16th to the end of the month
  monthly      calendar months

Overtime (a flag and hour count; ShiftBoard does not change anyone's pay rate):
  * daily   (venues.ot_daily_hours, None = off): hours past the limit on one day (the day the entry started)
  * weekly  (venues.ot_weekly_hours, None = off): hours past the limit in one work week, not counting hours
            already counted as daily overtime
  A time entry that crosses the limit is split: its overtime part is what's past the limit.

Approving a period (venues.pay_period_approval): only after it has ended and nobody is still clocked in for it.
While approved, times and pay rates in that period can't change (409) until a manager reopens it with a reason.
"""
import calendar
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import (
    PayPeriodApproval, Shift, ShiftRequest, TimeEntry, TimeEntryEdit, User, Venue, VenueWhitelist,
)
from src.services.fit import tz_of

PERIODS = ("weekly", "biweekly", "semimonthly", "monthly")
DEFAULT_ANCHOR = date(2026, 1, 5)          # a Monday; moved to the venue's week start when no anchor is set
BOOKED = ("approved", "confirmed", "checked_in", "completed")


def _utc(dt):
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def local_date(dt, tz) -> date:
    return _utc(dt).astimezone(tz).date()


def day_bounds(first: date, last: date, tz) -> Tuple[datetime, datetime]:
    lo = datetime.combine(first, time.min, tzinfo=tz).astimezone(timezone.utc)
    hi = datetime.combine(last + timedelta(days=1), time.min, tzinfo=tz).astimezone(timezone.utc)
    return lo, hi


# ------------------------------------------------------------------------------------------------
# Periods
# ------------------------------------------------------------------------------------------------
def week_start_for(venue: Venue, d: date) -> date:
    ws = int(venue.work_week_start or 0)
    return d - timedelta(days=(d.weekday() - ws) % 7)


def period_for(venue: Venue, d: date) -> Tuple[date, date]:
    kind = venue.pay_period if venue.pay_period in PERIODS else "weekly"
    if kind == "weekly":
        s = week_start_for(venue, d)
        return s, s + timedelta(days=6)
    if kind == "biweekly":
        anchor = venue.pay_period_anchor or week_start_for(venue, DEFAULT_ANCHOR)
        s = anchor + timedelta(days=((d - anchor).days // 14) * 14)
        return s, s + timedelta(days=13)
    if kind == "semimonthly":
        if d.day <= 15:
            return d.replace(day=1), d.replace(day=15)
        return d.replace(day=16), d.replace(day=calendar.monthrange(d.year, d.month)[1])
    return d.replace(day=1), d.replace(day=calendar.monthrange(d.year, d.month)[1])      # monthly


def recent_periods(venue: Venue, today: date, count: int) -> List[Tuple[date, date]]:
    """The current period first, then the ones before it."""
    out = []
    s, e = period_for(venue, today)
    for _ in range(max(1, count)):
        out.append((s, e))
        s, e = period_for(venue, s - timedelta(days=1))
    return out


def check_period_start(venue: Venue, start: date) -> Tuple[date, date]:
    s, e = period_for(venue, start)
    if s != start:
        raise HTTPException(status_code=400, detail="That date isn't the first day of a pay period at this venue.")
    return s, e


def period_label(start: date, end: date) -> str:
    if start.year != end.year:
        return f"{start:%b %-d, %Y} – {end:%b %-d, %Y}"
    if start.month == end.month:
        return f"{start:%b %-d} – {end:%-d}, {end:%Y}"
    return f"{start:%b %-d} – {end:%b %-d}, {end:%Y}"


# ------------------------------------------------------------------------------------------------
# Overtime
# ------------------------------------------------------------------------------------------------
def entry_hours(e: TimeEntry) -> float:
    if not e.clock_in_time or not e.clock_out_time:
        return 0.0
    return max(0.0, (_utc(e.clock_out_time) - _utc(e.clock_in_time)).total_seconds() / 3600.0)


def split_overtime(venue: Venue, entries: Iterable[TimeEntry]) -> Dict:
    """{entry_id: overtime hours} for ONE worker's closed entries at ONE venue (any order)."""
    tz = tz_of(venue.timezone)
    daily = float(venue.ot_daily_hours) if venue.ot_daily_hours is not None else None
    weekly = float(venue.ot_weekly_hours) if venue.ot_weekly_hours is not None else None
    day_tot, week_tot, out = defaultdict(float), defaultdict(float), {}
    for e in sorted([e for e in entries if e.clock_out_time], key=lambda x: _utc(x.clock_in_time)):
        h = entry_hours(e)
        d = local_date(e.clock_in_time, tz)
        daily_ot = 0.0
        if daily:
            before = day_tot[d]
            day_tot[d] = before + h
            daily_ot = max(0.0, day_tot[d] - daily) - max(0.0, before - daily)
        weekly_ot = 0.0
        if weekly:
            wk = week_start_for(venue, d)
            before = week_tot[wk]
            week_tot[wk] = before + (h - daily_ot)
            weekly_ot = max(0.0, week_tot[wk] - weekly) - max(0.0, before - weekly)
        out[e.id] = round(daily_ot + weekly_ot, 4)
    return out


async def overtime_for(db: AsyncSession, venue: Venue, worker_ids: Iterable, first: date, last: date) -> Dict:
    """{entry_id: overtime hours} for these workers' entries at this venue that START between first and last
    (venue dates). Whole work weeks are read so weekly overtime is right even when the range starts mid-week."""
    worker_ids = list(set(worker_ids))
    if not worker_ids or (venue.ot_daily_hours is None and venue.ot_weekly_hours is None):
        return {}
    tz = tz_of(venue.timezone)
    lo, hi = day_bounds(week_start_for(venue, first), last, tz)
    rows = (await db.execute(
        select(TimeEntry).join(Shift, Shift.id == TimeEntry.shift_id)
        .where(Shift.venue_id == venue.id, TimeEntry.worker_id.in_(worker_ids),
               TimeEntry.clock_in_time >= lo, TimeEntry.clock_in_time < hi)
    )).scalars().all()
    per = defaultdict(list)
    for e in rows:
        per[e.worker_id].append(e)
    out = {}
    for es in per.values():
        out.update(split_overtime(venue, es))
    return out


# ------------------------------------------------------------------------------------------------
# Locks
# ------------------------------------------------------------------------------------------------
async def approval_for(db: AsyncSession, venue_id, start: date) -> Optional[PayPeriodApproval]:
    return await db.scalar(select(PayPeriodApproval).where(
        PayPeriodApproval.venue_id == venue_id, PayPeriodApproval.start_date == start,
        PayPeriodApproval.status == "approved"))


async def lock_covering(db: AsyncSession, venue_id, day: date) -> Optional[PayPeriodApproval]:
    return await db.scalar(select(PayPeriodApproval).where(
        PayPeriodApproval.venue_id == venue_id, PayPeriodApproval.status == "approved",
        PayPeriodApproval.start_date <= day, PayPeriodApproval.end_date >= day).limit(1))


async def assert_unlocked(db: AsyncSession, venue: Venue, *moments) -> None:
    """409 if any of these times falls in an approved (locked) pay period at this venue."""
    tz = tz_of(venue.timezone)
    for m in moments:
        if m is None:
            continue
        lock = await lock_covering(db, venue.id, local_date(m, tz))
        if lock is not None:
            raise HTTPException(status_code=409, detail=(
                f"The pay period {period_label(lock.start_date, lock.end_date)} is approved and locked. "
                "Reopen it on the Pay periods screen to change its times."))


# ------------------------------------------------------------------------------------------------
# Summaries
# ------------------------------------------------------------------------------------------------
async def summarize(db: AsyncSession, venue: Venue, start: date, end: date, company: Optional[str] = None,
                    people: bool = True) -> dict:
    """Totals (and per-person rows when people=True) for one period. Plain dicts; the router builds schemas."""
    from src.services.time_tracking import modes_for_requests, PAYROLL
    tz = tz_of(venue.timezone)
    lo, hi = day_bounds(start, end, tz)
    rows = (await db.execute(
        select(TimeEntry, Shift, ShiftRequest, User)
        .join(Shift, Shift.id == TimeEntry.shift_id)
        .join(User, User.id == TimeEntry.worker_id)
        .outerjoin(ShiftRequest, (ShiftRequest.shift_id == TimeEntry.shift_id) & (ShiftRequest.worker_id == TimeEntry.worker_id))
        .where(Shift.venue_id == venue.id, TimeEntry.clock_in_time >= lo, TimeEntry.clock_in_time < hi)
    )).all()
    members = {m.worker_id: m for m in (await db.execute(
        select(VenueWhitelist).where(VenueWhitelist.venue_id == venue.id))).scalars().all()}

    def company_of(wid):
        m = members.get(wid)
        return (m.works_through or None) if m is not None else None

    if company:
        want = company.strip().lower()
        rows = [r for r in rows if (company_of(r[3].id) or "").lower() == want]
    ot = await overtime_for(db, venue, {r[3].id for r in rows}, start, end)
    edited = set()
    ids = [r[0].id for r in rows]
    if ids:
        edited = set((await db.execute(
            select(TimeEntryEdit.time_entry_id).where(TimeEntryEdit.time_entry_id.in_(ids),
                                                      TimeEntryEdit.action.in_(("edit", "add"))).distinct()
        )).scalars().all())

    per = {}
    for e, s, r, u in rows:
        p = per.setdefault(u.id, {
            "worker_id": u.id, "name": (f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email),
            "email": u.email, "works_through": company_of(u.id), "shifts": set(), "hours": 0.0, "overtime_hours": 0.0,
            "pay": 0.0, "open_entries": 0, "edited_entries": 0, "outside_area": 0, "auto_closed": 0,
        })
        p["shifts"].add(s.id)
        if e.clock_out_time is None:
            p["open_entries"] += 1
            continue
        h = entry_hours(e)
        rate = float(r.pay_rate) if (r is not None and r.pay_rate is not None) else float(s.hourly_rate or 0)
        p["hours"] += h
        p["overtime_hours"] += ot.get(e.id, 0.0)
        p["pay"] += h * rate
        p["edited_entries"] += 1 if e.id in edited else 0
        p["outside_area"] += 1 if e.clock_in_geo_status == "outside_geofence" else 0
        p["auto_closed"] += 1 if e.auto_closed else 0

    # People the venue's payroll tracks: booked shifts in the period (no ShiftBoard hours)
    booked = (await db.execute(
        select(ShiftRequest, Shift, User)
        .join(Shift, Shift.id == ShiftRequest.shift_id).join(User, User.id == ShiftRequest.worker_id)
        .where(Shift.venue_id == venue.id, Shift.start_time >= lo, Shift.start_time < hi,
               func.lower(ShiftRequest.status).in_(BOOKED), func.upper(Shift.status) != "CANCELLED")
    )).all()
    modes = await modes_for_requests(db, [(r, s) for r, s, _u in booked])
    payroll = {}
    for r, s, u in booked:
        if modes.get(r.id) != PAYROLL:
            continue
        if company and (company_of(u.id) or "").lower() != company.strip().lower():
            continue
        q = payroll.setdefault(u.id, {"worker_id": u.id, "name": (f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email),
                                      "shifts": 0, "scheduled_hours": 0.0})
        q["shifts"] += 1
        q["scheduled_hours"] += max(0.0, (_utc(s.end_time) - _utc(s.start_time)).total_seconds() / 3600.0)

    people_rows = []
    for p in per.values():
        people_rows.append({**p, "shifts": len(p["shifts"]), "hours": round(p["hours"], 2),
                            "overtime_hours": round(p["overtime_hours"], 2),
                            "regular_hours": round(p["hours"] - p["overtime_hours"], 2), "pay": round(p["pay"], 2)})
    people_rows.sort(key=lambda x: x["name"].lower())
    payroll_rows = sorted([{**q, "scheduled_hours": round(q["scheduled_hours"], 2)} for q in payroll.values()],
                          key=lambda x: x["name"].lower())
    out = {
        "people": len(people_rows),
        "total_hours": round(sum(p["hours"] for p in people_rows), 2),
        "overtime_hours": round(sum(p["overtime_hours"] for p in people_rows), 2),
        "total_pay": round(sum(p["pay"] for p in people_rows), 2),
        "open_entries": sum(p["open_entries"] for p in people_rows),
        "payroll_people": len(payroll_rows),
        "payroll_shifts": sum(q["shifts"] for q in payroll_rows),
    }
    if people:
        out["rows"] = people_rows
        out["payroll_rows"] = payroll_rows
    return out
