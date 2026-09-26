"""
Phase 28: Background notification worker (started from main.py's lifespan).

Every minute:
  1. auto clock-out sweep (Phase 27 rule, now also runs when nobody opens a screen)
  2. reminders to booked workers: ~24h before and ~2h before (each once, via dedupe keys)
  3. "not clocked in" 10 minutes after start -> the worker (urgent) and the venue's managers
  4. managers: people who haven't read an UPDATE to a shift starting within 24h (once per update)
  5. send due email / SMS from the outbox

Only one process runs a tick at a time (Redis lock). If Redis is unreachable the tick still runs;
dedupe keys keep reminders from doubling.
"""
import asyncio
import logging
import os
from collections import defaultdict
from datetime import datetime, timezone, timedelta

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database import AsyncSessionLocal
from src.models import Shift, ShiftEvent, ShiftRequest, TimeEntry, User, Venue, VenueLocation
from src.services.notify import notify_in, deliver_pending
from src.services.notify_events import (
    manager_ids, when_text, person, place_text, worker_shift_link, manager_link, _as_utc,
)
from src.services.worker_calendar import has_any_notes, latest_info_update, needs_ack
from src.services.clock import auto_close_open_entries
from src.services.activity import record_in

logger = logging.getLogger("shiftboard.notification_worker")

TICK_SECONDS = 60
LOCK_KEY = "shiftboard:notification-worker"
BOOKED_NOT_STARTED = ("approved", "confirmed")
BOOKED = ("approved", "confirmed", "checked_in")
LATE_AFTER = timedelta(minutes=10)


async def _booked_rows(db: AsyncSession, start_from: datetime, start_to: datetime, statuses):
    """(request, shift, event, venue, location) for booked requests whose shift starts in [from, to)."""
    rows = (await db.execute(
        select(ShiftRequest, Shift)
        .join(Shift, Shift.id == ShiftRequest.shift_id)
        .where(
            func.lower(ShiftRequest.status).in_(statuses),
            Shift.start_time >= start_from,
            Shift.start_time < start_to,
            func.upper(Shift.status) != "CANCELLED",
        )
    )).all()
    if not rows:
        return []
    event_ids = {s.event_id for _, s in rows if s.event_id}
    venue_ids = {s.venue_id for _, s in rows}
    events = {e.id: e for e in (await db.execute(select(ShiftEvent).where(ShiftEvent.id.in_(event_ids)))).scalars().all()} if event_ids else {}
    venues = {v.id: v for v in (await db.execute(select(Venue).where(Venue.id.in_(venue_ids)))).scalars().all()}
    loc_ids = {e.location_id for e in events.values() if e.location_id}
    locations = {l.id: l for l in (await db.execute(select(VenueLocation).where(VenueLocation.id.in_(loc_ids)))).scalars().all()} if loc_ids else {}
    out = []
    for r, s in rows:
        ev = events.get(s.event_id)
        if ev is not None and ev.cancelled_at is not None:
            continue
        out.append((r, s, ev, venues.get(s.venue_id), locations.get(ev.location_id) if ev is not None and ev.location_id else None))
    return out


def _needs_ack(r, s, ev, venue, loc) -> bool:
    return needs_ack(
        booked=True,
        has_notes=has_any_notes(venue, ev, s, loc),
        updated_at=latest_info_update(ev, s),
        seen_at=r.info_seen_at,
        booked_at=r.approved_at or r.created_at,
    )


async def scan_reminders(db: AsyncSession, now: datetime) -> int:
    sent = 0
    for r, s, ev, venue, loc in await _booked_rows(db, now, now + timedelta(hours=24), BOOKED_NOT_STARTED):
        start = _as_utc(s.start_time)
        booked_at = _as_utc(r.approved_at or r.created_at) or now
        until = start - now
        if until <= timedelta(hours=2):
            if booked_at > start - timedelta(hours=2):
                continue             # booked at the last minute; they know
            kind, key, urgent, lead = "reminder_2h", f"rem2:{r.id}", True, "Starts soon"
        else:
            if booked_at > start - timedelta(hours=24):
                continue
            kind, key, urgent, lead = "reminder_24h", f"rem24:{r.id}", False, "Tomorrow"
        title = f"{lead}: {s.role_type} · {ev.title if ev else s.title}"
        body = f"{when_text(s.start_time, venue)} at {place_text(venue, loc)}."
        if _needs_ack(r, s, ev, venue, loc):
            body += "\nYou haven't read the latest shift info yet. Open it and tap “Got it”."
        sent += await notify_in(
            db, [r.worker_id], kind, title, body, worker_shift_link(r.id),
            venue_id=s.venue_id, event_id=s.event_id, request_id=r.id, urgent=urgent, dedupe_key=key,
        )
    return sent


async def scan_late(db: AsyncSession, now: datetime) -> int:
    sent = 0
    rows = await _booked_rows(db, now - timedelta(hours=24), now - LATE_AFTER, BOOKED_NOT_STARTED)
    for r, s, ev, venue, loc in rows:
        if _as_utc(s.end_time) <= now:
            continue
        has_entry = await db.scalar(
            select(func.count(TimeEntry.id)).where(TimeEntry.shift_id == s.id, TimeEntry.worker_id == r.worker_id)
        )
        if has_entry:
            continue
        worker = await db.scalar(select(User).where(User.id == r.worker_id))
        name = ev.title if ev else s.title
        first_alert = await notify_in(
            db, [r.worker_id], "not_clocked_in",
            f"You haven't clocked in: {s.role_type} · {name}",
            f"Your shift started at {when_text(s.start_time, venue)}. Clock in now, or message your manager if you're running late.",
            worker_shift_link(r.id), venue_id=s.venue_id, event_id=s.event_id, request_id=r.id,
            urgent=True, dedupe_key=f"late-w:{r.id}",
        )
        sent += first_alert
        if first_alert:   # Phase 29.1: once per booking, in the venue's activity log
            await record_in(db, s.venue_id, "not_clocked_in",
                            f"{person(worker)} hadn't clocked in 10 min after the start: {s.role_type} · {name}",
                            event_id=s.event_id, request_id=r.id, worker_id=r.worker_id)
        sent += await notify_in(
            db, await manager_ids(db, s.venue_id), "late_worker",
            f"{person(worker)} hasn't clocked in",
            f"{s.role_type} · {name} started {when_text(s.start_time, venue)}.",
            manager_link(s.venue_id, s.event_id), venue_id=s.venue_id, event_id=s.event_id, request_id=r.id,
            urgent=True, dedupe_key=f"late-m:{r.id}",
        )
    return sent


async def scan_unread_updates(db: AsyncSession, now: datetime) -> int:
    """One alert per event per update: 'N people haven't read the update'."""
    by_event = defaultdict(list)
    for r, s, ev, venue, loc in await _booked_rows(db, now, now + timedelta(hours=24), BOOKED):
        updated = latest_info_update(ev, s)
        booked_at = _as_utc(r.approved_at or r.created_at)
        if updated is None or booked_at is None or updated <= booked_at:
            continue                 # only real updates after they booked, not first-time notes
        if not _needs_ack(r, s, ev, venue, loc):
            continue
        by_event[(s.venue_id, s.event_id)].append((r, s, ev, venue, updated))
    sent = 0
    for (venue_id, event_id), items in by_event.items():
        names = []
        for r, *_ in items:
            u = await db.scalar(select(User).where(User.id == r.worker_id))
            names.append(person(u))
        _, s, ev, venue, updated = items[0]
        latest = max(i[4] for i in items)
        n = len(names)
        sent += await notify_in(
            db, await manager_ids(db, venue_id), "unread_update",
            f"{n} {'person hasn' if n == 1 else 'people haven'}'t read the update: {ev.title if ev else s.title}",
            f"Starts {when_text(s.start_time, venue)}. Not read yet: {', '.join(names)}.",
            manager_link(venue_id, event_id), venue_id=venue_id, event_id=event_id,
            dedupe_key=f"unread:{event_id or s.id}:{int(latest.timestamp())}",
        )
    return sent


async def run_tick() -> None:
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        await auto_close_open_entries(db)
    for label, fn in (("reminders", scan_reminders), ("late", scan_late), ("unread", scan_unread_updates)):
        try:
            async with AsyncSessionLocal() as db:
                await fn(db, now)
                await db.commit()
        except Exception:
            logger.exception(f"notification scan '{label}' failed")
    try:
        async with AsyncSessionLocal() as db:
            await deliver_pending(db)
    except Exception:
        logger.exception("notification delivery failed")


# Phase 29.2: health for the admin System page (this process) + a Redis heartbeat (any process)
WORKER_STATE = {"started_at": None, "last_tick_at": None, "last_ok": None, "last_error": None, "ticks": 0}
HEARTBEAT_KEY = "shiftboard:notification-worker:last-tick"


async def _acquire_lock():
    """Returns (redis_client or None, got_lock: bool)."""
    try:
        import redis.asyncio as aioredis
        client = aioredis.from_url(settings.REDIS_URL, socket_timeout=3)
        got = await client.set(LOCK_KEY, str(os.getpid()), nx=True, ex=TICK_SECONDS - 5)
        return client, bool(got)
    except Exception:
        return None, True   # no Redis: run anyway (single-process dev setup)


async def notification_worker_loop() -> None:
    logger.info("Notification worker started.")
    WORKER_STATE["started_at"] = datetime.now(timezone.utc)
    await asyncio.sleep(10)   # let startup/seed finish
    while True:
        client = None
        try:
            client, got = await _acquire_lock()
            if got:
                await run_tick()
                now = datetime.now(timezone.utc)
                WORKER_STATE.update(last_tick_at=now, last_ok=True, last_error=None, ticks=WORKER_STATE["ticks"] + 1)
                if client is not None:
                    try:
                        await client.set(HEARTBEAT_KEY, now.isoformat(), ex=3600)
                    except Exception:
                        pass
        except asyncio.CancelledError:
            raise
        except Exception as e:
            WORKER_STATE.update(last_tick_at=datetime.now(timezone.utc), last_ok=False, last_error=str(e)[:300])
            logger.exception("notification worker tick failed")
        finally:
            if client is not None:
                try:
                    await client.aclose()
                except Exception:
                    pass
        await asyncio.sleep(TICK_SECONDS)
