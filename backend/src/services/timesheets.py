"""
Phase 26: Time sheets. Managers can fix times, add/delete entries, mark no-shows,
set actual pay, and remove people. Every change is written to time_entry_edits.
"""
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select, func, distinct
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import ShiftEvent, Shift, ShiftRequest, TimeEntry, TimeEntryEdit, User, Venue
from src.schemas import EventTimesheet, TimesheetPerson, TimeEntryRow

ASSIGNED_STATUSES = ("approved", "confirmed", "checked_in", "completed")
TIMESHEET_STATUSES = ASSIGNED_STATUSES + ("no_show",)
EDITED_ACTIONS = ("edit", "add")


def as_utc(dt):
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def entry_hours(e: TimeEntry) -> float:
    if not e.clock_in_time or not e.clock_out_time:
        return 0.0
    return max(0.0, (as_utc(e.clock_out_time) - as_utc(e.clock_in_time)).total_seconds() / 3600.0)


def fmt_range(cin, cout) -> str:
    a = as_utc(cin).isoformat() if cin else "—"
    b = as_utc(cout).isoformat() if cout else "—"
    return f"{a} → {b}"


def validate_times(cin, cout):
    cin = as_utc(cin)
    cout = as_utc(cout)
    if cout is not None:
        if cout <= cin:
            raise HTTPException(status_code=400, detail="Clock-out must be after clock-in.")
        if cout - cin > timedelta(hours=24):
            raise HTTPException(status_code=400, detail="An entry can't be longer than 24 hours.")
    if cin > datetime.now(timezone.utc) + timedelta(hours=1):
        raise HTTPException(status_code=400, detail="Clock-in can't be in the future.")
    return cin, cout


def require_reason(reason: Optional[str]) -> str:
    r = (reason or "").strip()
    if not r:
        raise HTTPException(status_code=400, detail="Please add a short reason for the change.")
    return r


def audit(db: AsyncSession, request_id, entry_id, editor_id, action, old=None, new=None, reason=None):
    db.add(TimeEntryEdit(
        shift_request_id=request_id, time_entry_id=entry_id, editor_id=editor_id,
        action=action, old_value=old, new_value=new, reason=reason,
    ))


async def build_timesheet(db: AsyncSession, event: ShiftEvent, venue: Venue) -> EventTimesheet:
    shifts = (await db.execute(select(Shift).where(Shift.event_id == event.id))).scalars().all()
    by_id = {s.id: s for s in shifts}
    ids = list(by_id.keys())

    rows = []
    entries_map = defaultdict(list)
    edited_ids = set()
    if ids:
        rows = (await db.execute(
            select(ShiftRequest, User)
            .join(User, ShiftRequest.worker_id == User.id)
            .where(ShiftRequest.shift_id.in_(ids), func.lower(ShiftRequest.status).in_(TIMESHEET_STATUSES))
            .order_by(User.first_name.asc(), User.last_name.asc())
        )).all()
        entries = (await db.execute(
            select(TimeEntry).where(TimeEntry.shift_id.in_(ids)).order_by(TimeEntry.clock_in_time.asc())
        )).scalars().all()
        for e in entries:
            entries_map[(e.shift_id, e.worker_id)].append(e)
        entry_ids = [e.id for e in entries]
        if entry_ids:
            edited_ids = set((await db.execute(
                select(distinct(TimeEntryEdit.time_entry_id))
                .where(TimeEntryEdit.time_entry_id.in_(entry_ids), TimeEntryEdit.action.in_(EDITED_ACTIONS))
            )).scalars().all())

    people = []
    for req, worker in rows:
        s = by_id[req.shift_id]
        es = entries_map.get((req.shift_id, req.worker_id), [])
        rate = float(req.pay_rate) if req.pay_rate is not None else float(s.hourly_rate)
        total = sum(entry_hours(e) for e in es)
        people.append(TimesheetPerson(
            request_id=req.id,
            worker_id=worker.id,
            name=f"{worker.first_name or ''} {worker.last_name or ''}".strip() or worker.email,
            shift_id=s.id,
            role_type=s.role_type,
            status=(req.status or "").lower(),
            status_reason=req.status_reason,
            pay_rate=rate,
            pay_rate_custom=req.pay_rate is not None,
            rate_min=float(s.hourly_rate),
            rate_max=float(s.hourly_rate_max) if s.hourly_rate_max is not None else None,
            entries=[
                TimeEntryRow(
                    id=e.id, clock_in_time=e.clock_in_time, clock_out_time=e.clock_out_time,
                    hours=round(entry_hours(e), 2), edited=e.id in edited_ids,
                )
                for e in es
            ],
            total_hours=round(total, 2),
            est_pay=round(total * rate, 2),
        ))

    return EventTimesheet(
        event_id=event.id,
        title=event.title,
        start_time=event.start_time,
        end_time=event.end_time,
        timezone=venue.timezone or "America/New_York",
        cancelled=event.cancelled_at is not None,
        started=as_utc(event.start_time) <= datetime.now(timezone.utc),
        people=people,
        total_hours=round(sum(p.total_hours for p in people), 2),
        total_pay=round(sum(p.est_pay for p in people), 2),
    )
