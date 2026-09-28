"""
Phase 34: Notifications for cover requests and waitlists.

Public functions open their own session, commit and NEVER raise (call them after the main commit).
`*_in` functions run inside a session you already have (the notification worker) and don't commit.

Links:
  cover posts to take  : /worker?tab=find       ("Need cover" section at the top of Find shifts)
  my shifts / offers   : /worker?tab=schedule   (cover status on the card, waitlist offers panel)
  managers             : /venue?venue=<id>&event=<id>
"""
import logging
from datetime import datetime, timezone, timedelta

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import AsyncSessionLocal
from src.models import CoverRequest, Shift, ShiftRequest, ShiftTransfer, User, Venue, VenueWhitelist, WaitlistEntry
from src.services.notify import notify_in, deliver_soon
from src.services.notify_events import (
    _run, _shift_bundle, _as_utc, when_text, person, place_text, manager_ids, manager_link, worker_shift_link,
)

logger = logging.getLogger("shiftboard.notify_cover")

TEAM_CAP = 50                        # most teammates told about one cover post
URGENT_WITHIN = timedelta(hours=24)
FIND = "/worker?tab=find"
SCHEDULE = "/worker?tab=schedule"


def _what(shift, event, venue) -> str:
    return f"{shift.role_type} · {event.title if event else shift.title}, {when_text(shift.start_time, venue)}"


def _first(u) -> str:
    return (u.first_name if u is not None and u.first_name else None) or person(u)


# ---------------------------------------------------------------------------------------------
# Cover posted
# ---------------------------------------------------------------------------------------------
async def _cover_posted(db: AsyncSession, cover_id) -> None:
    from src.services.cover import taker_check
    from src.services.departments import load_dept_context
    cover = await db.scalar(select(CoverRequest).where(CoverRequest.id == cover_id))
    if cover is None or cover.status != "open":
        return
    shift, venue, event, location = await _shift_bundle(db, cover.shift_id)
    if shift is None or venue is None:
        return
    frm = await db.scalar(select(User).where(User.id == cover.from_worker_id))
    what = _what(shift, event, venue)
    urgent = _as_utc(shift.start_time) - datetime.now(timezone.utc) <= URGENT_WITHIN
    common = dict(venue_id=shift.venue_id, event_id=shift.event_id)

    team = (await db.execute(
        select(User).join(VenueWhitelist, VenueWhitelist.worker_id == User.id).where(
            VenueWhitelist.venue_id == venue.id, VenueWhitelist.is_active == True, VenueWhitelist.status == "active",
            User.is_active == True, func.lower(User.role) == "worker", User.id != cover.from_worker_id,
        ).limit(300)
    )).scalars().all()
    depts = await load_dept_context(db, [u.id for u in team], [venue.id])
    told = []
    for u in team:
        if len(told) >= TEAM_CAP:
            break
        if depts.match(u.id, shift) == "outside":
            continue                                            # not their department: they can still find it on the board
        problem, _mode, _note = await taker_check(db, u, cover, shift, venue, depts=depts)
        if problem is None:
            told.append(u.id)
    body = what + (f"\n“{cover.note}”" if cover.note else "") + "\nOpen Find shifts to take it."
    await notify_in(db, told, "cover_needed", f"{_first(frm)} needs someone to cover their shift", body, FIND,
                    urgent=urgent, dedupe_key=f"cover:{cover.id}:posted", **common)
    await notify_in(db, await manager_ids(db, venue.id), "cover_manager",
                    f"{person(frm)} asked for cover", f"{what}\nThey stay booked until someone takes it."
                    + (" Posted on the public shift board too." if cover.audience == "public" and venue.allow_public_cover else ""),
                    manager_link(venue.id, shift.event_id), dedupe_key=f"cover:{cover.id}:posted-mgr", **common)


async def cover_posted(cover_id) -> None:
    await _run("cover_posted", _cover_posted, cover_id)


# ---------------------------------------------------------------------------------------------
# Cover taken (instantly, or waiting for the manager)
# ---------------------------------------------------------------------------------------------
async def _cover_taken(db: AsyncSession, cover_id) -> None:
    cover = await db.scalar(select(CoverRequest).where(CoverRequest.id == cover_id))
    if cover is None or cover.taken_by_worker_id is None:
        return
    shift, venue, event, location = await _shift_bundle(db, cover.shift_id)
    if shift is None:
        return
    frm = await db.scalar(select(User).where(User.id == cover.from_worker_id))
    taker = await db.scalar(select(User).where(User.id == cover.taken_by_worker_id))
    what = _what(shift, event, venue)
    common = dict(venue_id=shift.venue_id, event_id=shift.event_id)
    key = f"cover:{cover.id}:{cover.transfer_id}:{cover.status}"
    if cover.status == "covered":
        to_req = await db.scalar(select(ShiftRequest).where(
            ShiftRequest.shift_id == shift.id, ShiftRequest.worker_id == taker.id))
        await notify_in(db, [taker.id], "request_approved",
                        f"You're booked: {shift.role_type} · {event.title if event else shift.title}",
                        f"{when_text(shift.start_time, venue)} at {place_text(venue, location)} "
                        f"(covering for {_first(frm)}). Open the shift for arrival info and notes.",
                        worker_shift_link(to_req.id) if to_req else SCHEDULE,
                        request_id=to_req.id if to_req else None, dedupe_key=key, **common)
        await notify_in(db, [frm.id], "cover_update", f"{person(taker)} is covering your shift",
                        f"{what}\nYou're off this shift.", SCHEDULE, dedupe_key=key, **common)
        await notify_in(db, await manager_ids(db, shift.venue_id), "cover_manager",
                        f"{person(taker)} is covering for {person(frm)}", what,
                        manager_link(shift.venue_id, shift.event_id), dedupe_key=key, **common)
    elif cover.status == "pending_approval":
        await notify_in(db, await manager_ids(db, shift.venue_id), "swap_pending",
                        f"Cover waiting: {person(taker)} wants to cover for {person(frm)}", what,
                        manager_link(shift.venue_id, shift.event_id), dedupe_key=key, **common)
        await notify_in(db, [frm.id], "cover_update", f"{person(taker)} wants to cover your shift",
                        f"{what}\nWaiting for the manager to approve. You're still on it until then.",
                        SCHEDULE, dedupe_key=key, **common)


async def cover_taken(cover_id) -> None:
    await _run("cover_taken", _cover_taken, cover_id)


async def transfer_decided_in(db: AsyncSession, t: ShiftTransfer) -> None:
    """Called by notify_events._transfer_changed for hand-offs that came from a cover post."""
    cover = await db.scalar(select(CoverRequest).where(CoverRequest.id == t.cover_request_id))
    shift, venue, event, location = await _shift_bundle(db, t.shift_id)
    if cover is None or shift is None:
        return
    frm = await db.scalar(select(User).where(User.id == t.from_worker_id))
    taker = await db.scalar(select(User).where(User.id == t.to_worker_id))
    what = _what(shift, event, venue)
    common = dict(venue_id=shift.venue_id, event_id=shift.event_id)
    st = (t.status or "").lower()
    key = f"cover-transfer:{t.id}:{st}"
    if st == "approved":
        to_req = await db.scalar(select(ShiftRequest).where(
            ShiftRequest.shift_id == shift.id, ShiftRequest.worker_id == t.to_worker_id))
        await notify_in(db, [t.to_worker_id], "request_approved",
                        f"You're booked: {shift.role_type} · {event.title if event else shift.title}",
                        f"{when_text(shift.start_time, venue)} at {place_text(venue, location)} "
                        f"(covering for {_first(frm)}). Open the shift for arrival info and notes.",
                        worker_shift_link(to_req.id) if to_req else SCHEDULE,
                        request_id=to_req.id if to_req else None, dedupe_key=key, **common)
        await notify_in(db, [t.from_worker_id], "cover_update", f"Cover approved: {person(taker)} is taking your shift",
                        f"{what}\nYou're off this shift.", SCHEDULE, dedupe_key=key, **common)
    elif st == "cancelled_by_sender":
        await notify_in(db, [t.to_worker_id], "cover_update", f"{_first(frm)} doesn't need cover anymore",
                        f"{what}\nThey're keeping the shift.", FIND, dedupe_key=key, **common)
    elif st in ("denied", "declined"):
        await notify_in(db, [t.to_worker_id], "cover_update", "The manager didn't approve you covering this shift",
                        f"{what}\n{_first(frm)} stays on it.", FIND, dedupe_key=key, **common)
        still_open = cover.status == "open"
        await notify_in(db, [t.from_worker_id], "cover_update", f"The manager didn't approve {person(taker)} covering",
                        f"{what}\nYou're still on this shift." + (" Your cover request is open again." if still_open else ""),
                        SCHEDULE, dedupe_key=key, **common)


# ---------------------------------------------------------------------------------------------
# 12 h / 3 h warnings (notification worker)
# ---------------------------------------------------------------------------------------------
async def warnings_in(db: AsyncSession, warnings) -> int:
    sent = 0
    for which, cover_id in warnings:
        cover = await db.scalar(select(CoverRequest).where(CoverRequest.id == cover_id))
        if cover is None:
            continue
        shift, venue, event, location = await _shift_bundle(db, cover.shift_id)
        if shift is None:
            continue
        frm = await db.scalar(select(User).where(User.id == cover.from_worker_id))
        what = _what(shift, event, venue)
        urgent = which == "3h"
        hours = "3 hours" if urgent else "12 hours"
        common = dict(venue_id=shift.venue_id, event_id=shift.event_id)
        sent += await notify_in(
            db, [cover.from_worker_id], "cover_warning", f"Nobody has taken your shift yet (starts in about {hours})",
            f"{what}\nYou're still booked. If you can't make it, message your manager now.",
            SCHEDULE, urgent=urgent, dedupe_key=f"cover:{cover.id}:warn-{which}", **common)
        sent += await notify_in(
            db, await manager_ids(db, shift.venue_id), "cover_manager",
            f"Still needs cover: {person(frm)}'s shift starts in about {hours}",
            f"{what}\nNobody has taken it. {_first(frm)} is still booked.",
            manager_link(shift.venue_id, shift.event_id), urgent=urgent,
            dedupe_key=f"cover:{cover.id}:warn-{which}-mgr", **common)
    return sent


# ---------------------------------------------------------------------------------------------
# Waitlist
# ---------------------------------------------------------------------------------------------
async def waitlist_events_in(db: AsyncSession, events) -> int:
    sent = 0
    for kind, entry_id in events:
        e = await db.scalar(select(WaitlistEntry).where(WaitlistEntry.id == entry_id))
        if e is None:
            continue
        shift, venue, event, location = await _shift_bundle(db, e.shift_id)
        if shift is None:
            continue
        what = _what(shift, event, venue)
        common = dict(venue_id=shift.venue_id, event_id=shift.event_id)
        key = f"waitlist:{e.id}:{kind}:{e.offered_at.isoformat() if e.offered_at else ''}"
        if kind == "offer":
            mins = max(1, round((_as_utc(e.offer_expires_at) - datetime.now(timezone.utc)).total_seconds() / 60)) if e.offer_expires_at else 10
            sent += await notify_in(db, [e.worker_id], "waitlist_offer", f"A spot opened up: {shift.role_type}",
                                    f"{what}\nYou're next on the waitlist. Take it in the next {mins} minutes or it goes to the next person.",
                                    SCHEDULE, urgent=True, dedupe_key=key, **common)
        elif kind == "booked":
            sent += await notify_in(db, [e.worker_id], "waitlist_update", f"You're booked from the waitlist: {shift.role_type}",
                                    f"{when_text(shift.start_time, venue)} at {place_text(venue, location)}. "
                                    "Open the shift for arrival info and notes.",
                                    worker_shift_link(e.request_id) if e.request_id else SCHEDULE,
                                    request_id=e.request_id, urgent=True, dedupe_key=key, **common)
        elif kind == "requested":
            sent += await notify_in(db, [e.worker_id], "waitlist_update", f"A spot opened up: {shift.role_type}",
                                    f"{what}\nWe sent your request from the waitlist. The manager will review it.",
                                    SCHEDULE, dedupe_key=key, **common)
        elif kind == "expired":
            sent += await notify_in(db, [e.worker_id], "waitlist_update", "Your waitlist offer ran out of time",
                                    f"{what}\nThe spot went to the next person. You can join the waitlist again.",
                                    FIND, dedupe_key=key, **common)
        elif kind == "closed":
            sent += await notify_in(db, [e.worker_id], "waitlist_update", "You're off a waitlist",
                                    f"{what}\n{e.closed_reason or 'The waitlist closed.'}", FIND, dedupe_key=key, **common)
    return sent


async def waitlist_events(events) -> None:
    if not events:
        return
    try:
        async with AsyncSessionLocal() as db:
            await waitlist_events_in(db, events)
            await db.commit()
        deliver_soon()
    except Exception:
        logger.exception("waitlist notifications failed")
