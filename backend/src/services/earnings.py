"""
Phase 33.1: A worker's own hours & pay.

* Hours come from time entries (clock-in -> clock-out); an entry that's still open counts as "in progress", 0 h.
* Rate = the manager's per-person rate for that shift if set (time sheet), else the posted rate. Same rule as payroll.
* Pay is before tips and taxes. Phase 35.2: tips are listed separately (own tips + pool shares entered by the
  manager), for shifts that start in the period, at venues that show tips to workers.
* Periods use the worker's own time zone (Notification settings), weeks run Monday -> Sunday.
* Workers see the real rate of shifts they worked, even when the venue hides pay on listings (they were booked).
"""
import csv
import io
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import List, Optional, Tuple
from zoneinfo import ZoneInfo

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import Shift, ShiftEvent, ShiftRequest, TimeEntry, TimeEntryEdit, User, Venue
from src.schemas import EarningsResponse, EarningsShift, EarningsVenue, EarningsUpcoming, EarningsTip
from src.services.notify import load_prefs
from src.services.fit import tz_of

PERIODS = ("week", "last_week", "month", "last_month", "custom")
BOOKED = ("approved", "confirmed")
MAX_CUSTOM_DAYS = 400


def _utc(dt):
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def period_range(period: str, today: date, start: Optional[date] = None, end: Optional[date] = None) -> Tuple[date, date, str]:
    """(first day, last day, label). Weeks start on Monday. Raises ValueError for a bad custom range."""
    monday = today - timedelta(days=today.weekday())
    if period == "week":
        return monday, monday + timedelta(days=6), "This week"
    if period == "last_week":
        return monday - timedelta(days=7), monday - timedelta(days=1), "Last week"
    if period == "month":
        first = today.replace(day=1)
        nxt = (first + timedelta(days=32)).replace(day=1)
        return first, nxt - timedelta(days=1), "This month"
    if period == "last_month":
        last = today.replace(day=1) - timedelta(days=1)
        return last.replace(day=1), last, "Last month"
    if period == "custom":
        if start is None or end is None:
            raise ValueError("Pick a start and an end date.")
        if end < start:
            raise ValueError("Pick an end date on or after the start date.")
        if (end - start).days > MAX_CUSTOM_DAYS:
            raise ValueError("Pick a range of about a year or less.")
        return start, end, f"{start.strftime('%b %-d')} – {end.strftime('%b %-d, %Y')}"
    raise ValueError("Unknown period.")


async def worker_tz(db: AsyncSession, user: User) -> ZoneInfo:
    prefs = (await load_prefs(db, [user.id]))[user.id]
    return tz_of(getattr(prefs, "timezone", None))


async def _rows(db: AsyncSession, user_id, lo: datetime, hi: datetime):
    """Time entries that started in [lo, hi) with their shift, event, venue and request."""
    return (await db.execute(
        select(TimeEntry, Shift, ShiftEvent, Venue, ShiftRequest)
        .join(Shift, Shift.id == TimeEntry.shift_id)
        .join(Venue, Venue.id == Shift.venue_id)
        .outerjoin(ShiftEvent, ShiftEvent.id == Shift.event_id)
        .outerjoin(ShiftRequest, (ShiftRequest.shift_id == TimeEntry.shift_id) & (ShiftRequest.worker_id == TimeEntry.worker_id))
        .where(TimeEntry.worker_id == user_id, TimeEntry.clock_in_time >= lo, TimeEntry.clock_in_time < hi)
        .order_by(TimeEntry.clock_in_time.asc())
    )).all()


def _rate(shift: Shift, req: Optional[ShiftRequest]) -> Tuple[float, bool]:
    if req is not None and req.pay_rate is not None:
        return float(req.pay_rate), True
    return float(shift.hourly_rate or 0), False


async def build_earnings(db: AsyncSession, user: User, period: str = "week",
                         start: Optional[date] = None, end: Optional[date] = None) -> EarningsResponse:
    tz = await worker_tz(db, user)
    now = datetime.now(timezone.utc)
    first, last, label = period_range(period, now.astimezone(tz).date(), start, end)
    lo = datetime.combine(first, time.min, tzinfo=tz).astimezone(timezone.utc)
    hi = datetime.combine(last + timedelta(days=1), time.min, tzinfo=tz).astimezone(timezone.utc)

    rows = await _rows(db, user.id, lo, hi)
    entry_ids = [r[0].id for r in rows]
    edited = set()
    if entry_ids:
        edited = set((await db.execute(
            select(TimeEntryEdit.time_entry_id)
            .where(TimeEntryEdit.time_entry_id.in_(entry_ids), TimeEntryEdit.action.in_(("edit", "add")))
            .distinct()
        )).scalars().all())

    shifts: List[EarningsShift] = []
    by_venue = defaultdict(lambda: {"hours": 0.0, "pay": 0.0, "shifts": set(), "name": ""})
    for entry, shift, event, venue, req in rows:
        cin, cout = _utc(entry.clock_in_time), _utc(entry.clock_out_time)
        hours = max(0.0, (cout - cin).total_seconds() / 3600.0) if cout else 0.0
        rate, custom = _rate(shift, req)
        pay = round(hours * rate, 2)
        shifts.append(EarningsShift(
            entry_id=entry.id, shift_id=shift.id, request_id=req.id if req is not None else None,
            event_title=(event.title if event is not None else None) or shift.title or shift.role_type or "Shift",
            venue_id=venue.id, venue_name=venue.name, venue_timezone=venue.timezone or "America/New_York",
            role_type=shift.role_type or "Shift",
            clock_in_time=cin, clock_out_time=cout, in_progress=cout is None,
            hours=round(hours, 2), rate=rate, rate_custom=custom, pay=pay,
            tips_eligible=bool(shift.tips_eligible), auto_closed=bool(entry.auto_closed), edited=entry.id in edited,
        ))
        if cout is None:
            continue                                  # still clocked in: listed, not counted
        v = by_venue[venue.id]
        v["name"] = venue.name
        v["hours"] += hours
        v["pay"] += pay
        v["shifts"].add(shift.id)

    # Booked, not started yet, inside the period: what's still coming
    upcoming_rows = []
    if hi > now:
        upcoming_rows = (await db.execute(
            select(ShiftRequest, Shift)
            .join(Shift, Shift.id == ShiftRequest.shift_id)
            .where(
                ShiftRequest.worker_id == user.id,
                func.lower(ShiftRequest.status).in_(BOOKED),
                Shift.start_time > now, Shift.start_time >= lo, Shift.start_time < hi,
                func.upper(Shift.status) != "CANCELLED",
            )
        )).all()
    # Phase 35: shifts a venue's own payroll tracks aren't ShiftUp hours: leave them out, and say so
    from src.services.time_tracking import modes_for_requests, PAYROLL
    period_rows = (await db.execute(
        select(ShiftRequest, Shift, Venue)
        .join(Shift, Shift.id == ShiftRequest.shift_id).join(Venue, Venue.id == Shift.venue_id)
        .where(ShiftRequest.worker_id == user.id, func.lower(ShiftRequest.status).in_(BOOKED + ("completed",)),
               Shift.start_time >= lo, Shift.start_time < hi, func.upper(Shift.status) != "CANCELLED")
    )).all()
    modes = await modes_for_requests(db, [(r, s) for r, s, _v in period_rows])
    payroll_rows = [(r, s, v) for r, s, v in period_rows if modes.get(r.id) == PAYROLL]
    payroll_ids = {r.id for r, _s, _v in payroll_rows}
    upcoming_rows = [(r, s) for r, s in upcoming_rows if r.id not in payroll_ids]

    up_hours = up_pay = 0.0
    for req, shift in upcoming_rows:
        h = max(0.0, (_utc(shift.end_time) - _utc(shift.start_time)).total_seconds() / 3600.0)
        up_hours += h
        up_pay += h * _rate(shift, req)[0]

    # Phase 35.2: tips for my shifts that start in the period (venues that show tips to workers)
    from src.services.tips import tips_by_request
    my_rows = (await db.execute(
        select(ShiftRequest, Shift, Venue, ShiftEvent)
        .join(Shift, Shift.id == ShiftRequest.shift_id).join(Venue, Venue.id == Shift.venue_id)
        .outerjoin(ShiftEvent, ShiftEvent.id == Shift.event_id)
        .where(ShiftRequest.worker_id == user.id, Shift.start_time >= lo, Shift.start_time < hi,
               Shift.event_id.isnot(None))
    )).all()
    tip_map = await tips_by_request(db, {s.event_id for _r, s, _v, _e in my_rows}, for_workers=True)
    tip_items = []
    for r, s, v, ev in sorted(my_rows, key=lambda x: _utc(x[1].start_time)):
        if r.id not in tip_map:
            continue
        own, share = tip_map[r.id]
        tip_items.append(EarningsTip(
            request_id=r.id, event_title=(ev.title if ev is not None else None) or s.title or s.role_type or "Shift",
            venue_name=v.name, venue_timezone=v.timezone or "America/New_York", role_type=s.role_type or "Shift",
            start_time=_utc(s.start_time), own=own, pool_share=share, total=round(own + share, 2),
        ))
        by_venue[v.id]["name"] = v.name
        by_venue[v.id]["tips"] = by_venue[v.id].get("tips", 0.0) + own + share
    placed = set()
    for sh in sorted(shifts, key=lambda x: x.clock_in_time):
        if sh.request_id in tip_map and sh.request_id not in placed:
            sh.tips = round(sum(tip_map[sh.request_id]), 2)
            placed.add(sh.request_id)

    worked = [s for s in shifts if not s.in_progress]
    return EarningsResponse(
        period=period, label=label, start_date=first, end_date=last, timezone=str(tz.key),
        total_hours=round(sum(s.hours for s in worked), 2),
        total_pay=round(sum(s.pay for s in worked), 2),
        shifts_worked=len({s.shift_id for s in worked}),
        in_progress=len(shifts) - len(worked),
        any_tips=any(s.tips_eligible for s in shifts),
        venues=sorted(
            [EarningsVenue(venue_id=k, name=v["name"], hours=round(v["hours"], 2), pay=round(v["pay"], 2), shifts=len(v["shifts"]),
                           tips=round(v.get("tips", 0.0), 2))
             for k, v in by_venue.items()],
            key=lambda x: -x.pay,
        ),
        shifts=list(reversed(shifts)),                # newest first
        upcoming=EarningsUpcoming(shifts=len(upcoming_rows), hours=round(up_hours, 2), est_pay=round(up_pay, 2)),
        payroll_shifts=len(payroll_rows),                                              # Phase 35
        payroll_venues=sorted({v.name for _r, _s, v in payroll_rows}),
        total_tips=round(sum(t.total for t in tip_items), 2),                         # Phase 35.2
        tips=tip_items,
    )


def _local(dt: Optional[datetime], tz_name: str) -> str:
    if dt is None:
        return ""
    return _utc(dt).astimezone(tz_of(tz_name)).strftime("%Y-%m-%d %I:%M %p")


async def earnings_csv(db: AsyncSession, user: User, period: str = "month",
                       start: Optional[date] = None, end: Optional[date] = None) -> Tuple[str, str]:
    """(filename, csv text) of the worker's own entries. Times are in each venue's local time."""
    data = await build_earnings(db, user, period, start, end)
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["Date", "Venue", "Event", "Position", "Clock in (venue time)", "Clock out (venue time)",
                "Hours", "Hourly rate", "Pay before tips", "Gets tips", "Notes", "Tips"])   # Phase 35.2: Tips at the end
    for s in reversed(data.shifts):                  # oldest first in the file
        notes = []
        if s.in_progress:
            notes.append("Still clocked in")
        if s.auto_closed:
            notes.append("Clocked out automatically")
        if s.edited:
            notes.append("Time changed by a manager")
        if s.rate_custom:
            notes.append("Your rate for this shift")
        w.writerow([
            _utc(s.clock_in_time).astimezone(tz_of(s.venue_timezone)).strftime("%Y-%m-%d"),
            s.venue_name, s.event_title, s.role_type,
            _local(s.clock_in_time, s.venue_timezone), _local(s.clock_out_time, s.venue_timezone) or "",
            f"{s.hours:.2f}", f"{s.rate:.2f}", f"{s.pay:.2f}", "Yes" if s.tips_eligible else "No", "; ".join(notes),
            f"{s.tips:.2f}" if s.tips else "",
        ])
    # Phase 35.2: tips for shifts with no clock-in of mine in the period (e.g. tracked by the venue's payroll)
    placed = {s.request_id for s in data.shifts if s.tips}
    for t in data.tips:
        if t.request_id in placed:
            continue
        w.writerow([
            _utc(t.start_time).astimezone(tz_of(t.venue_timezone)).strftime("%Y-%m-%d"), t.venue_name, t.event_title,
            t.role_type, "Tips only", "", "0.00", "", "0.00", "Yes", "", f"{t.total:.2f}",
        ])
    w.writerow([])
    w.writerow(["Total", "", "", "", "", "", f"{data.total_hours:.2f}", "", f"{data.total_pay:.2f}", "", "",
                f"{data.total_tips:.2f}"])
    name = f"shiftup-hours-{data.start_date.isoformat()}-to-{data.end_date.isoformat()}.csv"
    return name, out.getvalue()
