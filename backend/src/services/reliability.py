from datetime import datetime, timezone, timedelta
from typing import Dict, List
from uuid import UUID

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import Shift, ShiftRequest, TimeEntry

LATE_GRACE = timedelta(minutes=10)        # clock-in later than start + 10 min = late
LATE_DROP_WINDOW = timedelta(hours=72)    # dropped with < 72h notice = late drop
COMMITTED_STATUSES = ("approved", "confirmed", "checked_in", "completed")


def _aware(dt):
    if dt is None:
        return None
    if isinstance(dt, str):
        dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


async def compute_reliability(db: AsyncSession, worker_ids: List[UUID]) -> Dict[UUID, dict]:
    """
    Platform-wide reliability per worker.
    score = 100 * (on_time + 0.5 * late) / (completed + no_show + late_drop)
    Returns score=None when the worker has zero commitments.
    Shifts that have not ended yet are ignored. Drops with >= 72h notice are excused.
    """
    if not worker_ids:
        return {}

    now = datetime.now(timezone.utc)
    stats = {
        wid: {"completed": 0, "on_time": 0, "late": 0, "no_show": 0, "late_drop": 0}
        for wid in worker_ids
    }

    rows = (await db.execute(
        select(
            ShiftRequest.worker_id,
            ShiftRequest.shift_id,
            ShiftRequest.status,
            ShiftRequest.dropped_at,
            ShiftRequest.check_in_time,
            Shift.start_time,
            Shift.end_time,
        )
        .join(Shift, ShiftRequest.shift_id == Shift.id)
        .where(
            ShiftRequest.worker_id.in_(worker_ids),
            func.lower(ShiftRequest.status).in_(COMMITTED_STATUSES + ("dropped",)),
        )
    )).all()

    te_rows = (await db.execute(
        select(TimeEntry.worker_id, TimeEntry.shift_id, func.min(TimeEntry.clock_in_time))
        .where(TimeEntry.worker_id.in_(worker_ids))
        .group_by(TimeEntry.worker_id, TimeEntry.shift_id)
    )).all()
    first_clock_in = {(w, s): _aware(t) for w, s, t in te_rows}

    for worker_id, shift_id, req_status, dropped_at, check_in_time, start_time, end_time in rows:
        st = stats.get(worker_id)
        if st is None:
            continue
        status_l = (req_status or "").lower()
        start = _aware(start_time)
        end = _aware(end_time)

        if status_l == "dropped":
            d = _aware(dropped_at)
            if d is not None and (start - d) < LATE_DROP_WINDOW:
                st["late_drop"] += 1
            continue

        if end is None or end >= now:
            continue  # shift not finished yet

        clock_in = first_clock_in.get((worker_id, shift_id)) or _aware(check_in_time)
        if clock_in is None:
            st["no_show"] += 1
        else:
            st["completed"] += 1
            if clock_in > start + LATE_GRACE:
                st["late"] += 1
            else:
                st["on_time"] += 1

    result = {}
    for wid, st in stats.items():
        commitments = st["completed"] + st["no_show"] + st["late_drop"]
        score = round(100.0 * (st["on_time"] + 0.5 * st["late"]) / commitments, 1) if commitments else None
        result[wid] = {**st, "commitments": commitments, "score": score}
    return result
