"""
Phase 32.1: Time off is a BLOCK the worker sets, not a request a manager approves.

A block is:
  all_day   True  -> the whole day(s)
            False -> start_local..end_local on each day ('HH:MM'; an end at or before the start runs past midnight;
                     '24:00' = midnight)
  repeat    'none'     -> every day from start_date to end_date (inclusive)
            'weekly'   -> on `weekdays` (0 = Monday ... 6 = Sunday) from start_date, until end_date (None = no end)
            'biweekly' -> same, every other week, counting from the week start_date falls in
  reason    shown to managers ("Class", "Custody weekend")
  private_note  only the worker ever sees it

Times are wall-clock where they work, so a block is judged in the shift's VENUE time zone (like availability).
Nobody approves a block. Managers can't assign or offer shifts that overlap one, and hand-offs to someone
blocked off are refused. The worker can still pick up a shift in their own block (the screens warn first).
"""
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from typing import Iterable, List, Optional, Tuple
from zoneinfo import ZoneInfo

REPEATS = ("none", "weekly", "biweekly")
WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MAX_ONE_OFF_DAYS = 90
MAX_BLOCKS = 50


@dataclass
class BlockSpec:
    id: object = None
    all_day: bool = True
    start_date: date = None
    end_date: Optional[date] = None
    start_local: Optional[str] = None
    end_local: Optional[str] = None
    repeat: str = "none"
    weekdays: List[int] = field(default_factory=list)
    reason: Optional[str] = None

    @classmethod
    def of(cls, row) -> "BlockSpec":
        return cls(
            id=row.id, all_day=bool(row.all_day), start_date=row.start_date, end_date=row.end_date,
            start_local=row.start_local, end_local=row.end_local, repeat=row.repeat or "none",
            weekdays=sorted(int(d) for d in (row.weekdays or [])), reason=row.reason,
        )


def _hm(value: str) -> Tuple[int, int]:
    h, m = int(value[:2]), int(value[3:5])
    return h, m


def _as_utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def applies_on(b: BlockSpec, d: date) -> bool:
    """Does an occurrence of the block START on local day d?"""
    if d < b.start_date:
        return False
    if b.end_date is not None and d > b.end_date:
        return False
    if b.repeat == "none":
        return True
    if d.weekday() not in b.weekdays:
        return False
    if b.repeat == "biweekly":
        anchor = b.start_date - timedelta(days=b.start_date.weekday())
        return ((d - anchor).days // 7) % 2 == 0
    return True


def interval_on(b: BlockSpec, d: date, tz: ZoneInfo) -> Tuple[datetime, datetime]:
    if b.all_day:
        return datetime.combine(d, time(0, 0), tzinfo=tz), datetime.combine(d + timedelta(days=1), time(0, 0), tzinfo=tz)
    sh, sm = _hm(b.start_local)
    eh, em = _hm(b.end_local)
    start = datetime.combine(d, time(sh % 24, sm), tzinfo=tz)
    runs_over = (eh, em) == (24, 0) or (eh, em) <= (sh, sm)
    end = datetime.combine(d + timedelta(days=1) if runs_over else d, time(eh % 24, em), tzinfo=tz)
    return start, end


def overlapping_block(blocks: Iterable[BlockSpec], start: datetime, end: datetime, tz: ZoneInfo) -> Optional[BlockSpec]:
    """The first block with an occurrence overlapping [start, end)."""
    s, e = _as_utc(start), _as_utc(end)
    s_loc, e_loc = s.astimezone(tz), e.astimezone(tz)
    days = []
    d = s_loc.date() - timedelta(days=1)            # yesterday's overnight block can reach into today
    while d <= e_loc.date():
        days.append(d)
        d += timedelta(days=1)
    for b in blocks:
        for d in days:
            if applies_on(b, d):
                a, z = interval_on(b, d, tz)
                if a < e and z > s:
                    return b
    return None


def occurs_on_day(b: BlockSpec, d: date) -> bool:
    """For calendars: does this block cover any part of local day d (counting yesterday's overnight part)?"""
    if applies_on(b, d):
        return True
    if not b.all_day and applies_on(b, d - timedelta(days=1)):
        sh, sm = _hm(b.start_local)
        eh, em = _hm(b.end_local)
        return (eh, em) != (24, 0) and (eh, em) < (sh, sm) and (eh, em) != (0, 0)
    return False


def fmt_hm(value: str) -> str:
    h, m = _hm(value)
    if (h, m) in ((24, 0), (0, 0)):
        return "midnight"
    hh = h % 24
    return f"{hh % 12 or 12}:{m:02d} {'AM' if hh < 12 else 'PM'}"


def _day(d: date) -> str:
    return d.strftime("%a %b %-d")


def summary(b: BlockSpec, today: Optional[date] = None) -> str:
    """'Fri Oct 2 – Sun Oct 4, all day' · 'Every Tue & Thu, 5:00 PM – 11:00 PM until Dec 20'"""
    hours = "all day" if b.all_day else f"{fmt_hm(b.start_local)} – {fmt_hm(b.end_local)}"
    if b.repeat == "none":
        if b.end_date is None or b.end_date == b.start_date:
            return f"{_day(b.start_date)}, {hours}"
        return f"{_day(b.start_date)} – {_day(b.end_date)}, {hours}{'' if b.all_day else ' each day'}"
    names = [WEEKDAY_SHORT[d] for d in b.weekdays]
    days = names[0] if len(names) == 1 else ", ".join(names[:-1]) + f" & {names[-1]}"
    if len(names) == 7:
        days = "day"
    text = f"{'Every other' if b.repeat == 'biweekly' else 'Every'} {days}, {hours}"
    today = today or datetime.now(timezone.utc).date()
    if b.start_date > today:
        text += f" from {b.start_date.strftime('%b %-d')}"
    if b.end_date is not None:
        text += f" until {b.end_date.strftime('%b %-d')}"
    return text


def day_label(b: BlockSpec) -> str:
    """Short text for a calendar cell: '' for all day, else '5:00 PM – 11:00 PM'."""
    return "" if b.all_day else f"{fmt_hm(b.start_local)} – {fmt_hm(b.end_local)}"


def is_over(b: BlockSpec, today: date) -> bool:
    return b.end_date is not None and b.end_date < today


def validate(
    *, all_day: bool, start_date: date, end_date: Optional[date], start_local: Optional[str], end_local: Optional[str],
    repeat: str, weekdays: List[int], today: date, is_new: bool,
) -> Tuple[Optional[date], Optional[str], Optional[str], List[int]]:
    """Returns cleaned (end_date, start_local, end_local, weekdays). Raises ValueError with a friendly message."""
    if repeat not in REPEATS:
        raise ValueError("Repeat must be none, weekly or biweekly.")
    if is_new and start_date < today - timedelta(days=1):
        raise ValueError("Time off has to start today or later.")
    if all_day:
        start_local = end_local = None
    else:
        for v in (start_local, end_local):
            if not v or len(v) != 5 or v[2] != ":" or not (v[:2].isdigit() and v[3:].isdigit()):
                raise ValueError("Pick a start and end time.")
            h, m = _hm(v)
            if not (0 <= h <= 24 and 0 <= m <= 59) or (h == 24 and m != 0):
                raise ValueError(f"'{v}' isn't a valid time.")
        if start_local == "24:00":
            raise ValueError("A block can't start at midnight at the end of the day. Use 00:00.")
        if start_local == end_local:
            raise ValueError("Start and end can't be the same. For the whole day, choose All day.")
    if repeat == "none":
        end_date = end_date or start_date
        if end_date < start_date:
            raise ValueError("The last day can't be before the first day.")
        if (end_date - start_date).days + 1 > MAX_ONE_OFF_DAYS:
            raise ValueError(f"Block up to {MAX_ONE_OFF_DAYS} days at a time. For something regular, use Repeats.")
        weekdays = []
    else:
        weekdays = sorted({int(d) for d in (weekdays or [start_date.weekday()])})
        if any(d < 0 or d > 6 for d in weekdays):
            raise ValueError("Weekdays go from 0 (Monday) to 6 (Sunday).")
        if end_date is not None and end_date < start_date:
            raise ValueError("The end date can't be before the start date.")
    return end_date, start_local, end_local, weekdays
