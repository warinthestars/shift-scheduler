# Phase 23: Role & Venue Management, Multi-Venue Managers, and the Posted Shifts Roster

Three goals, building on the CURRENT code (Phases 20–22.1 are implemented):

1. **Admin role management.** Admins can open any user in the Admin Panel, change their role (Worker / Venue Manager / Platform Admin), and assign venues. Promoting to Venue Manager REQUIRES at least one venue. Guardrails: an admin cannot change their own role or deactivate themselves, and the last active platform admin cannot be demoted or deactivated.
2. **Multi-venue managers.** A manager assigned to several venues gets a venue switcher on their dashboard; a manager with no venues sees a clear "not assigned" message instead of someone else's venue.
3. **Posted Shifts board.** The venue dashboard's "Scheduled Shifts" section is replaced with an event-grouped board: each posted event (one "Create Shift" submission = one event) lists every position (role, rate, tips, filled/capacity), **who is assigned**, and **who has requested each position**, with Approve/Deny right there. Upcoming / Past / All filter, list and calendar views.

**Registration is already done (Phase 22.1)** — every self-registered or JIT-provisioned user is created as `worker`, and `POST /api/admin/users` defaults to `worker`. This phase does not change registration; it only verifies it (§8).

**No schema changes. No `down -v`.**

---

## 0. Guardrails (read before editing)
* DO NOT modify: `.gitignore`, anything in `.secrets/`, `docker-compose.yml`, `database/init.sql`, `backend/src/models.py`, `backend/src/auth.py`, `backend/src/main.py`, `backend/src/routers/auth.py`, `frontend/src/context/AuthContext.jsx`, `frontend/src/api/client.js`, `frontend/src/pages/LoginPage.jsx`, `frontend/src/firebase.js`.
* NEVER call `UserResponse.model_validate(<User ORM>)` and never read ORM relationship attributes (`user.managed_venues`, `shift.venue`, etc.) unless loaded with `selectinload` in the same query. Use explicit `select(...)` queries.
* All datetime comparisons use `datetime.now(timezone.utc)`.
* Route ORDER matters in `venues.py`: the new `GET /managed` route MUST be declared ABOVE `@router.get("/{venue_id}")`.
* New frontend files are created with the EXACT content given. Do not "improve" them.
* In `VenueManagerDashboard.jsx`, make ONLY the edits listed in §6. Do not delete other state, handlers, or sections.

---

## 1. Schemas (`backend/src/schemas.py`)
Append at the END of the file:
```python
# ------------------------------------------------------------------------------
# Phase 23: Posted Shifts board (event-grouped roster)
# ------------------------------------------------------------------------------
class RosterPerson(BaseModel):
    request_id: UUID
    worker_id: UUID
    first_name: str = ""
    last_name: str = ""
    email: Optional[str] = None
    phone: Optional[str] = None
    aggregate_rating: float = 5.0
    status: str
    requested_at: Optional[datetime] = None
    clocked_in: bool = False
    clocked_out: bool = False


class EventPosition(BaseModel):
    shift_id: UUID
    role_type: str
    hourly_rate: float
    tips_eligible: bool = False
    tip_pool: bool = False
    capacity: int
    spots_filled: int
    status: str
    assigned: List[RosterPerson] = []
    requested: List[RosterPerson] = []


class VenueEventResponse(BaseModel):
    event_key: str
    title: str
    start_time: datetime
    end_time: datetime
    description: Optional[str] = None
    total_capacity: int
    total_assigned: int
    total_requested: int
    positions: List[EventPosition]
```

---

## 2. Admin User Update (`backend/src/routers/admin.py`)

### A. Add a module-level constant directly below `router = APIRouter(...)`:
```python
VALID_ROLES = ("worker", "venue_manager", "platform_admin")
```

### B. Replace ONLY the `try: ... except ...` block at the top of `update_admin_user` (everything from `try:` through the `raise HTTPException(status_code=500, detail=f"Failed to update user: {str(e)}")` line). Keep the function signature and everything AFTER that block (the `await db.refresh(user)`, affiliation queries, and `return _build_user_response(...)`) exactly as is.

Also update the docstring to `"""Phase 23: Update role, active status, profile fields, and venue assignments."""`

Replacement block:
```python
    try:
        user = await db.scalar(select(User).where(User.id == user_id))
        if not user:
            raise HTTPException(status_code=404, detail="User not found.")

        old_role = normalize_role(user.role)
        new_role = normalize_role(user_update.role) if user_update.role is not None else old_role
        if new_role not in VALID_ROLES:
            raise HTTPException(status_code=400, detail=f"Invalid role '{user_update.role}'.")
        role_changed = new_role != old_role
        is_self = user.id == current_user.id

        if is_self and role_changed:
            raise HTTPException(status_code=400, detail="You cannot change your own role.")
        if is_self and user_update.is_active is False:
            raise HTTPException(status_code=400, detail="You cannot deactivate your own account.")

        losing_admin = old_role == "platform_admin" and (role_changed or user_update.is_active is False)
        if losing_admin:
            admin_count = await db.scalar(
                select(func.count(User.id)).where(
                    func.lower(User.role).in_(["platform_admin", "super_admin"]),
                    User.is_active == True
                )
            )
            if (admin_count or 0) <= 1:
                raise HTTPException(status_code=400, detail="Cannot remove the last active platform admin.")

        # Venue assignments are rebuilt whenever the role changes or venue_ids is sent.
        rebuild_venues = role_changed or user_update.venue_ids is not None
        target_ids = []
        if rebuild_venues and new_role != "platform_admin":
            seen = set()
            for vid in (user_update.venue_ids or []):
                if vid not in seen:
                    seen.add(vid)
                    target_ids.append(vid)
            if target_ids:
                found = (await db.execute(select(Venue.id).where(Venue.id.in_(target_ids)))).scalars().all()
                missing = [str(v) for v in target_ids if v not in set(found)]
                if missing:
                    raise HTTPException(status_code=400, detail=f"Unknown venue id(s): {', '.join(missing)}")
            if new_role == "venue_manager" and not target_ids:
                raise HTTPException(
                    status_code=400,
                    detail="Assign at least one venue when making someone a Venue Manager."
                )

        user.role = new_role
        if user_update.is_active is not None:
            user.is_active = user_update.is_active
        if user_update.first_name is not None:
            user.first_name = user_update.first_name.strip()
        if user_update.last_name is not None:
            user.last_name = user_update.last_name.strip()
        if user_update.phone is not None:
            user.phone = user_update.phone.strip()

        if rebuild_venues:
            await db.execute(delete(VenueManager).where(VenueManager.user_id == user.id))
            await db.execute(delete(VenueWhitelist).where(VenueWhitelist.worker_id == user.id))
            for idx, vid in enumerate(target_ids):
                if new_role == "venue_manager":
                    db.add(VenueManager(venue_id=vid, user_id=user.id, is_primary=(idx == 0)))
                elif new_role == "worker":
                    db.add(VenueWhitelist(venue_id=vid, worker_id=user.id, is_active=True))

        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update user: {str(e)}")
```

---

## 3. Venue Endpoints (`backend/src/routers/venues.py`)

### A. Imports
* Change `from fastapi import APIRouter, Depends, HTTPException, status` → `from fastapi import APIRouter, Depends, HTTPException, status, Query`
* Add `VenueEventResponse, EventPosition, RosterPerson` to the existing `from src.schemas import (...)` block.

### B. New route `GET /api/venues/managed` — place it DIRECTLY AFTER `list_venues` and BEFORE `@router.get("/{venue_id}", ...)`:
```python
@router.get("/managed", response_model=List[VenueResponse])
async def list_managed_venues(
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """Phase 23: Venues the current user can manage (platform admins: all venues)."""
    if normalize_role(current_user.role) in ("platform_admin", "super_admin"):
        result = await db.execute(select(Venue).order_by(Venue.name))
    else:
        result = await db.execute(
            select(Venue)
            .join(VenueManager, VenueManager.venue_id == Venue.id)
            .where(VenueManager.user_id == current_user.id)
            .order_by(Venue.name)
        )
    return result.scalars().all()
```

### C. New route `GET /api/venues/{venue_id}/events` — place it directly AFTER `get_venue_roster` (end of file is fine):
```python
ASSIGNED_STATUSES = ("approved", "confirmed", "checked_in", "completed")
REQUESTED_STATUSES = ("pending", "pending_manager_approval")


@router.get("/{venue_id}/events", response_model=List[VenueEventResponse])
async def get_venue_events(
    venue_id: UUID,
    scope: str = Query("upcoming", pattern="^(upcoming|past|all)$"),
    current_user: User = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Phase 23: Posted shifts grouped into events. One "Create Shift" submission creates one
    Shift row per role; rows sharing (title, start_time, end_time) are one event.
    Each position lists assigned workers and pending requests.
    """
    await verify_venue_manager_access(venue_id, current_user, db)
    now_utc = datetime.now(timezone.utc)

    q = select(Shift).where(Shift.venue_id == venue_id)
    if scope == "upcoming":
        q = q.where(Shift.end_time >= now_utc).order_by(Shift.start_time.asc(), Shift.role_type.asc())
    elif scope == "past":
        q = q.where(Shift.end_time < now_utc).order_by(Shift.start_time.desc(), Shift.role_type.asc()).limit(500)
    else:
        q = q.order_by(Shift.start_time.asc(), Shift.role_type.asc())
    shifts = (await db.execute(q)).scalars().all()
    if not shifts:
        return []

    shift_ids = [s.id for s in shifts]

    req_rows = (await db.execute(
        select(ShiftRequest, User)
        .join(User, ShiftRequest.worker_id == User.id)
        .where(
            ShiftRequest.shift_id.in_(shift_ids),
            func.lower(ShiftRequest.status).in_(ASSIGNED_STATUSES + REQUESTED_STATUSES)
        )
        .order_by(ShiftRequest.created_at.asc())
    )).all()

    te_rows = (await db.execute(
        select(
            TimeEntry.shift_id,
            TimeEntry.worker_id,
            func.count(TimeEntry.id),
            func.count(TimeEntry.clock_out_time),
        )
        .where(TimeEntry.shift_id.in_(shift_ids))
        .group_by(TimeEntry.shift_id, TimeEntry.worker_id)
    )).all()
    clock_state = {(sid, wid): (n > 0, n_out > 0 and n_out >= n) for sid, wid, n, n_out in te_rows}

    assigned_by_shift = defaultdict(list)
    requested_by_shift = defaultdict(list)
    for req, worker in req_rows:
        clocked_in, clocked_out = clock_state.get((req.shift_id, req.worker_id), (False, False))
        person = RosterPerson(
            request_id=req.id,
            worker_id=worker.id,
            first_name=worker.first_name or "",
            last_name=worker.last_name or "",
            email=worker.email,
            phone=worker.phone,
            aggregate_rating=float(worker.aggregate_rating) if worker.aggregate_rating is not None else 5.0,
            status=(req.status or "").lower(),
            requested_at=req.created_at,
            clocked_in=clocked_in or req.check_in_time is not None,
            clocked_out=clocked_out or req.check_out_time is not None,
        )
        if person.status in ASSIGNED_STATUSES:
            assigned_by_shift[req.shift_id].append(person)
        else:
            requested_by_shift[req.shift_id].append(person)

    events = {}
    order = []
    for s in shifts:
        key = f"{s.title}|{s.start_time.isoformat()}|{s.end_time.isoformat()}"
        if key not in events:
            events[key] = {
                "event_key": key,
                "title": s.title or "Shift",
                "start_time": s.start_time,
                "end_time": s.end_time,
                "description": s.description,
                "positions": [],
            }
            order.append(key)
        events[key]["positions"].append(EventPosition(
            shift_id=s.id,
            role_type=s.role_type or "Worker",
            hourly_rate=float(s.hourly_rate) if s.hourly_rate is not None else 0.0,
            tips_eligible=bool(s.tips_eligible),
            tip_pool=bool(s.tip_pool),
            capacity=s.capacity if s.capacity is not None else 1,
            spots_filled=s.spots_filled if s.spots_filled is not None else 0,
            status=s.status or "OPEN",
            assigned=assigned_by_shift[s.id],
            requested=requested_by_shift[s.id],
        ))

    result = []
    for key in order:
        ev = events[key]
        positions = ev["positions"]
        result.append(VenueEventResponse(
            **ev,
            total_capacity=sum(p.capacity for p in positions),
            total_assigned=sum(len(p.assigned) for p in positions),
            total_requested=sum(len(p.requested) for p in positions),
        ))
    return result
```

---

## 4. New Component: `frontend/src/components/EventRosterModal.jsx` (NEW FILE)
```jsx
import React from 'react';
import { X, Users, Clock, Check, MessageSquare, Phone, Mail, UserPlus } from 'lucide-react';
import TipBadge from './TipBadge';
import ReliabilityBadge from './ReliabilityBadge';

const STATUS_LABEL = {
  approved: 'Confirmed',
  confirmed: 'Confirmed',
  checked_in: 'Clocked in',
  completed: 'Completed',
};

function assignedChip(person) {
  if (person.clocked_out || person.status === 'completed') {
    return { label: 'Completed', cls: 'bg-slate-700/40 text-slate-300 border-slate-600/40' };
  }
  if (person.clocked_in || person.status === 'checked_in') {
    return { label: 'Clocked in', cls: 'bg-sky-500/10 text-sky-300 border-sky-500/30' };
  }
  return { label: STATUS_LABEL[person.status] || 'Confirmed', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' };
}

export default function EventRosterModal({
  event,
  onClose,
  reliabilityMap = {},
  onApprove,
  onDeny,
  onOpenBoard,
  actionLoading,
}) {
  if (!event) return null;

  const start = new Date(event.start_time);
  const end = new Date(event.end_time);
  const dateStr = start.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full p-6 shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-start pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center space-x-2 mb-1">
              <Users className="w-5 h-5 text-emerald-400" />
              <h3 className="text-lg font-bold text-white">{event.title}</h3>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
              <span className="flex items-center space-x-1">
                <Clock className="w-3.5 h-3.5 text-slate-500" />
                <span>{dateStr} • {timeStr}</span>
              </span>
              <span>
                Staffed: <strong className="text-white">{event.total_assigned} / {event.total_capacity}</strong>
              </span>
              {event.total_requested > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 font-semibold">
                  {event.total_requested} awaiting review
                </span>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 pt-4 space-y-5 pr-1">
          {event.positions.map((pos) => {
            const isFull = pos.assigned.length >= pos.capacity;
            return (
              <div key={pos.shift_id} className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-slate-800/40 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[11px] font-bold uppercase">{pos.role_type}</span>
                    <span className="text-xs text-emerald-400 font-semibold">${Number(pos.hourly_rate).toFixed(2)}/hr</span>
                    <TipBadge shift={pos} />
                    <span className={`text-xs font-semibold ${isFull ? 'text-emerald-400' : 'text-slate-300'}`}>
                      {pos.assigned.length} / {pos.capacity} filled
                    </span>
                  </div>
                  {onOpenBoard && (
                    <button
                      type="button"
                      onClick={() => onOpenBoard({ id: pos.shift_id, title: event.title, role_type: pos.role_type })}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 hover:text-white text-xs border border-slate-700 transition inline-flex items-center space-x-1"
                    >
                      <MessageSquare className="w-3 h-3" />
                      <span>Board</span>
                    </button>
                  )}
                </div>

                <div className="p-4 space-y-4">
                  <div>
                    <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                      Assigned ({pos.assigned.length})
                    </div>
                    {pos.assigned.length === 0 ? (
                      <p className="text-xs text-slate-500 italic">No one assigned yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {pos.assigned.map((p) => {
                          const chip = assignedChip(p);
                          return (
                            <div key={p.request_id} className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                              <div>
                                <div className="text-sm font-semibold text-white">{p.first_name} {p.last_name}</div>
                                <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 mt-0.5">
                                  {p.phone && (
                                    <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1 hover:text-emerald-400">
                                      <Phone className="w-3 h-3" />{p.phone}
                                    </a>
                                  )}
                                  {p.email && (
                                    <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1 hover:text-emerald-400">
                                      <Mail className="w-3 h-3" />{p.email}
                                    </a>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-amber-400 text-xs font-bold">★ {Number(p.aggregate_rating).toFixed(1)}</span>
                                <ReliabilityBadge data={reliabilityMap[p.worker_id]} />
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${chip.cls}`}>{chip.label}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <UserPlus className="w-3.5 h-3.5 text-amber-400" />
                      <span>Requested ({pos.requested.length})</span>
                    </div>
                    {pos.requested.length === 0 ? (
                      <p className="text-xs text-slate-500 italic">No pending requests for this position.</p>
                    ) : (
                      <div className="space-y-2">
                        {pos.requested.map((p) => {
                          const approving = actionLoading === `approve-${p.request_id}`;
                          const denying = actionLoading === `deny-${p.request_id}`;
                          return (
                            <div key={p.request_id} className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-amber-500/5 rounded-lg border border-amber-500/20">
                              <div>
                                <div className="text-sm font-semibold text-white">{p.first_name} {p.last_name}</div>
                                <div className="text-[11px] text-slate-400 mt-0.5">
                                  Requested {p.requested_at ? new Date(p.requested_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-amber-400 text-xs font-bold">★ {Number(p.aggregate_rating).toFixed(1)}</span>
                                <ReliabilityBadge data={reliabilityMap[p.worker_id]} />
                                <button
                                  type="button"
                                  onClick={() => onApprove && onApprove(p.request_id)}
                                  disabled={isFull || approving || denying}
                                  title={isFull ? 'Position is full' : 'Approve'}
                                  className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition inline-flex items-center gap-1 disabled:opacity-40"
                                >
                                  <Check className="w-3 h-3" />
                                  <span>{approving ? '…' : 'Approve'}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onDeny && onDeny(p.request_id)}
                                  disabled={approving || denying}
                                  className="px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white text-xs font-bold border border-rose-600/30 transition inline-flex items-center gap-1 disabled:opacity-40"
                                >
                                  <X className="w-3 h-3" />
                                  <span>{denying ? '…' : 'Deny'}</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

---

## 5. New Component: `frontend/src/components/PostedShiftsBoard.jsx` (NEW FILE)
```jsx
import React, { useState, useEffect, useMemo } from 'react';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { enUS } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { Calendar as CalendarIcon, List as ListIcon, Clock, Users, UserPlus } from 'lucide-react';
import api from '../api/client';
import TipBadge from './TipBadge';
import EventRosterModal from './EventRosterModal';

const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales: { 'en-US': enUS } });

const SCOPES = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'past', label: 'Past' },
  { id: 'all', label: 'All' },
];

export default function PostedShiftsBoard({
  venueId,
  refreshKey,
  reliabilityMap = {},
  onApprove,
  onDeny,
  onOpenBoard,
  actionLoading,
}) {
  const [scope, setScope] = useState('upcoming');
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'calendar'
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedKey, setSelectedKey] = useState(null);

  useEffect(() => {
    if (!venueId) {
      setEvents([]);
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    api
      .get(`/venues/${venueId}/events`, { params: { scope } })
      .then((res) => {
        if (active) setEvents(res.data || []);
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.detail || 'Could not load posted shifts.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [venueId, scope, refreshKey]);

  const selectedEvent = useMemo(
    () => events.find((e) => e.event_key === selectedKey) || null,
    [events, selectedKey]
  );

  const calendarEvents = useMemo(
    () =>
      events.map((ev) => ({
        id: ev.event_key,
        title: `${ev.title} (${ev.total_assigned}/${ev.total_capacity})`,
        start: new Date(ev.start_time),
        end: new Date(ev.end_time),
        resource: ev,
      })),
    [events]
  );

  const eventsByDate = useMemo(() => {
    const groups = [];
    const index = {};
    events.forEach((ev) => {
      const dateKey = new Date(ev.start_time).toLocaleDateString([], {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });
      if (!(dateKey in index)) {
        index[dateKey] = groups.length;
        groups.push({ dateKey, items: [] });
      }
      groups[index[dateKey]].items.push(ev);
    });
    return groups;
  }, [events]);

  const toggleBtn = (active) =>
    `flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
      active ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
    }`;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
        <div className="flex items-center space-x-2">
          <CalendarIcon className="w-5 h-5 text-emerald-400" />
          <div>
            <h2 className="text-base font-bold text-white">Posted Shifts ({events.length})</h2>
            <p className="text-xs text-slate-400">Every posted event with its positions, assigned staff and pending requests</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1">
            {SCOPES.map((s) => (
              <button key={s.id} type="button" onClick={() => setScope(s.id)} className={toggleBtn(scope === s.id)}>
                <span>{s.label}</span>
              </button>
            ))}
          </div>
          <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1">
            <button type="button" onClick={() => setViewMode('list')} className={toggleBtn(viewMode === 'list')}>
              <ListIcon className="w-3.5 h-3.5" />
              <span>List</span>
            </button>
            <button type="button" onClick={() => setViewMode('calendar')} className={toggleBtn(viewMode === 'calendar')}>
              <CalendarIcon className="w-3.5 h-3.5" />
              <span>Calendar</span>
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">{error}</div>
      )}

      {loading && events.length === 0 ? (
        <div className="text-center py-12 text-xs text-slate-400">Loading posted shifts…</div>
      ) : viewMode === 'calendar' ? (
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 min-h-[620px]">
          <Calendar
            localizer={localizer}
            events={calendarEvents}
            startAccessor="start"
            endAccessor="end"
            style={{ height: 600 }}
            onSelectEvent={(e) => setSelectedKey(e.resource.event_key)}
            views={['month', 'week', 'day', 'agenda']}
            defaultView="month"
            popup
            eventPropGetter={(e) => ({
              style: {
                backgroundColor: e.resource.total_requested > 0 ? '#b45309' : '#059669',
                borderColor: e.resource.total_requested > 0 ? '#f59e0b' : '#10b981',
                color: '#ffffff',
                borderRadius: '6px',
                padding: '2px 6px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
              },
            })}
          />
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-12 bg-slate-950/50 rounded-xl border border-slate-800">
          <CalendarIcon className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <p className="text-xs text-slate-400">
            {scope === 'upcoming' ? 'No upcoming shifts posted for this venue.' : 'No shifts found.'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {eventsByDate.map(({ dateKey, items }) => (
            <div key={dateKey}>
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2 flex items-center space-x-2">
                <CalendarIcon className="w-3.5 h-3.5 text-emerald-400" />
                <span>{dateKey}</span>
              </h3>
              <div className="space-y-3">
                {items.map((ev) => {
                  const start = new Date(ev.start_time);
                  const end = new Date(ev.end_time);
                  const timeStr = `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                  return (
                    <div key={ev.event_key} className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                      <div className="px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 bg-slate-800/30">
                        <div>
                          <div className="text-sm font-bold text-white">{ev.title}</div>
                          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 mt-0.5">
                            <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{timeStr}</span>
                            <span>Staffed <strong className="text-white">{ev.total_assigned}/{ev.total_capacity}</strong></span>
                            {ev.total_requested > 0 && (
                              <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 font-semibold">
                                {ev.total_requested} request{ev.total_requested === 1 ? '' : 's'} to review
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedKey(ev.event_key)}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white font-semibold text-xs border border-emerald-600/30 transition inline-flex items-center space-x-1.5 self-start md:self-auto"
                        >
                          <Users className="w-3.5 h-3.5" />
                          <span>View Roster</span>
                        </button>
                      </div>
                      <div className="divide-y divide-slate-800/60">
                        {ev.positions.map((pos) => {
                          const pct = pos.capacity > 0 ? Math.min(100, Math.round((pos.assigned.length / pos.capacity) * 100)) : 0;
                          return (
                            <div key={pos.shift_id} className="px-4 py-2.5 grid grid-cols-1 md:grid-cols-12 gap-2 items-center text-xs">
                              <div className="md:col-span-3 flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[11px] font-bold uppercase">{pos.role_type}</span>
                              </div>
                              <div className="md:col-span-3 flex items-center gap-1.5 text-emerald-400 font-semibold">
                                <span>${Number(pos.hourly_rate).toFixed(2)}/hr</span>
                                <TipBadge shift={pos} />
                              </div>
                              <div className="md:col-span-3">
                                <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                                  <span>{pos.assigned.length}/{pos.capacity} filled</span>
                                </div>
                                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                  <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                              <div className="md:col-span-3 text-slate-300 truncate">
                                {pos.assigned.length > 0
                                  ? pos.assigned.map((p) => `${p.first_name} ${p.last_name?.[0] ? p.last_name[0] + '.' : ''}`.trim()).join(', ')
                                  : <span className="text-slate-500 italic">Unassigned</span>}
                                {pos.requested.length > 0 && (
                                  <span className="ml-2 inline-flex items-center gap-1 text-amber-400 font-semibold">
                                    <UserPlus className="w-3 h-3" />{pos.requested.length}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedEvent && (
        <EventRosterModal
          event={selectedEvent}
          onClose={() => setSelectedKey(null)}
          reliabilityMap={reliabilityMap}
          onApprove={onApprove}
          onDeny={onDeny}
          onOpenBoard={onOpenBoard}
          actionLoading={actionLoading}
        />
      )}
    </div>
  );
}
```

---

## 6. Venue Manager Dashboard (`frontend/src/pages/VenueManagerDashboard.jsx`) — targeted edits only

### A. Import
Add: `import PostedShiftsBoard from '../components/PostedShiftsBoard';`

### B. New state (add directly below `const [reliabilityMap, setReliabilityMap] = useState({});`)
```jsx
  const [managedVenues, setManagedVenues] = useState([]);
  const [boardRefreshKey, setBoardRefreshKey] = useState(0);
```

### C. `fetchVenueData` — replace this exact block:
```jsx
      if (!activeId) {
        const vRes = await api.get('/admin/venues').catch(() => api.get('/venues'));
        if (vRes.data && vRes.data.length > 0) {
          activeId = vRes.data[0].id;
          setCurrentVenueId(activeId);
        }
      }
```
with:
```jsx
      const mvRes = await api.get('/venues/managed').catch(() => ({ data: [] }));
      const mine = mvRes.data || [];
      setManagedVenues(mine);
      if (!isPlatformAdmin && activeId && !mine.some((v) => String(v.id) === String(activeId))) {
        activeId = null;
      }
      if (!activeId && mine.length > 0) {
        activeId = mine[0].id;
      }
      setCurrentVenueId(activeId || null);
```
And directly after the existing `setReliabilityMap(reliabilityRes.data || {});` line inside the same function, add:
```jsx
      setBoardRefreshKey((k) => k + 1);
```

### D. `handleDeny` — inside its `try` block, directly after the `setNotification({ type: 'info', ... })` call, add:
```jsx
      fetchVenueData(currentVenueId);
```

### E. Manager venue switcher handler (add directly above the component's main `return (`):
```jsx
  const handleManagerVenueChange = (e) => {
    const newId = e.target.value;
    setCurrentVenueId(newId);
    fetchVenueData(newId);
  };
```

### F. "No venue assigned" early return (add directly above the component's main `return (`, AFTER the handler from §6E):
```jsx
  if (!loading && !currentVenueId) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md text-center bg-slate-900 border border-slate-800 rounded-2xl p-8">
          <Building2 className="w-10 h-10 text-amber-400 mx-auto mb-3" />
          <h1 className="text-lg font-bold text-white mb-1">No venue assigned yet</h1>
          <p className="text-sm text-slate-400">
            Your account is a Venue Manager but isn't linked to a venue. Ask a platform admin to assign you one in the Admin Panel.
          </p>
        </div>
      </div>
    );
  }
```

### G. Header switcher
In the header banner, find the `<p className="text-xs text-slate-400 mt-1">` that renders `venueDetails?.address`. Directly AFTER that `</p>`, add:
```jsx
              {!isPlatformAdmin && managedVenues.length > 1 && (
                <select
                  value={currentVenueId || ''}
                  onChange={handleManagerVenueChange}
                  className="mt-2 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-amber-500"
                >
                  {managedVenues.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              )}
```

### H. Replace Section 3
Delete the ENTIRE block that starts with the comment `{/* Section 3: Scheduled Venue Shifts & Roster Overview */}` and ends with that section's closing `</div>` (the last element before `</main>`). Replace it with:
```jsx
        {/* Section 3 (Phase 23): Posted Shifts board */}
        <PostedShiftsBoard
          venueId={currentVenueId}
          refreshKey={boardRefreshKey}
          reliabilityMap={reliabilityMap}
          onApprove={handleApprove}
          onDeny={handleDeny}
          onOpenBoard={setActiveDiscussionShift}
          actionLoading={actionLoading}
        />
```

### I. Remove the old roster modal render
Delete this block near the bottom of the file:
```jsx
      {/* Drill-Down Modal: Shift Staff Roster Details */}
      {selectedShift && (
        <ShiftRosterModal
          ...
        />
      )}
```
Leave all other state, imports, memos and effects in place (unused ones are harmless; cleanup is a later phase). Do NOT delete `ShiftRosterModal.jsx`.

---

## 7. Admin Panel — Edit User modal (`frontend/src/pages/AdminPanel.jsx`)

### A. Imports
Add `Pencil` to the existing `lucide-react` import list.

### B. State (add directly below `const [deletingUser, setDeletingUser] = useState(false);`)
```jsx
  const [editingUser, setEditingUser] = useState(null);
  const [editRole, setEditRole] = useState('worker');
  const [editVenueIds, setEditVenueIds] = useState([]);
  const [savingEdit, setSavingEdit] = useState(false);
```

### C. Handlers (add directly after `handleDeleteUser`)
```jsx
  const normalizeRole = (r) => {
    const v = (r || '').toLowerCase();
    return v === 'super_admin' ? 'platform_admin' : v || 'worker';
  };

  const openEditUser = (u) => {
    setEditingUser(u);
    setEditRole(normalizeRole(u.role));
    setEditVenueIds((u.venue_ids || []).map(String));
  };

  const toggleEditVenue = (venueId) => {
    const id = String(venueId);
    setEditVenueIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSaveUserEdit = async () => {
    if (!editingUser) return;
    if (editRole === 'venue_manager' && editVenueIds.length === 0) {
      setNotification({ type: 'error', message: 'Pick at least one venue for a Venue Manager.' });
      return;
    }
    setSavingEdit(true);
    try {
      const payload = {
        role: editRole,
        venue_ids: editRole === 'platform_admin' ? [] : editVenueIds,
      };
      const res = await api.patch(`/admin/users/${editingUser.id}`, payload);
      setUsers((prev) => prev.map((u) => (u.id === editingUser.id ? res.data : u)));
      const roleLabel = editRole === 'platform_admin' ? 'Platform Admin' : editRole === 'venue_manager' ? 'Venue Manager' : 'Worker';
      setNotification({
        type: 'success',
        message: `${res.data.first_name} ${res.data.last_name} is now a ${roleLabel}. They'll see the change the next time they refresh or sign in.`,
      });
      setEditingUser(null);
      fetchAdminData();
    } catch (err) {
      setNotification({ type: 'error', message: err.response?.data?.detail || 'Failed to update user.' });
    } finally {
      setSavingEdit(false);
    }
  };
```

### D. Actions column
In the users table, replace the ENTIRE contents of the Actions `<td className="py-3.5 px-5 text-right">` (currently only the delete button wrapped in `currentUser?.id !== u.id &&`) with:
```jsx
                            <div className="inline-flex items-center space-x-1">
                              <button
                                type="button"
                                onClick={() => openEditUser(u)}
                                className="p-2 text-slate-500 hover:text-amber-400 rounded-lg hover:bg-amber-500/10 transition"
                                title="Edit role & venues"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              {currentUser?.id !== u.id && (
                                <button
                                  type="button"
                                  onClick={() => setUserToDelete(u)}
                                  className="p-2 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-rose-500/10 transition"
                                  title="Delete user"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
```

### E. Edit modal — render directly BEFORE the existing `{userToDelete && (` delete-confirmation modal:
```jsx
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-lg font-bold text-white">Edit {editingUser.first_name} {editingUser.last_name}</h3>
                <p className="text-xs text-slate-400 font-mono">{editingUser.email}</p>
              </div>
              <button type="button" onClick={() => setEditingUser(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-2">Role</label>
              {currentUser?.id === editingUser.id && (
                <p className="text-[11px] text-amber-300 mb-2">You can't change your own role.</p>
              )}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'worker', label: 'Worker', cls: 'emerald' },
                  { id: 'venue_manager', label: 'Venue Manager', cls: 'amber' },
                  { id: 'platform_admin', label: 'Platform Admin', cls: 'indigo' },
                ].map((opt) => {
                  const selected = editRole === opt.id;
                  const disabled = currentUser?.id === editingUser.id;
                  const tone = {
                    emerald: 'border-emerald-500 bg-emerald-500/15 text-emerald-300',
                    amber: 'border-amber-500 bg-amber-500/15 text-amber-300',
                    indigo: 'border-indigo-500 bg-indigo-500/15 text-indigo-300',
                  }[opt.cls];
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => setEditRole(opt.id)}
                      className={`px-3 py-2 rounded-xl border text-xs font-semibold transition disabled:opacity-50 ${
                        selected ? tone : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {editRole === 'platform_admin' ? (
              <p className="text-xs text-slate-400 bg-slate-800/60 border border-slate-700 rounded-xl p-3">
                Platform admins can access every venue. Existing venue assignments will be cleared.
              </p>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  {editRole === 'venue_manager' ? 'Managed venues (required)' : 'Pre-approved venues (optional)'}
                </label>
                <p className="text-[11px] text-slate-500 mb-2">
                  {editRole === 'venue_manager'
                    ? 'This person will manage shifts, rosters and approvals for the selected venues.'
                    : "Workers on a venue's whitelist are pre-approved to pick up its shifts."}
                </p>
                {venues.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">No venues exist yet. Create one first.</p>
                ) : (
                  <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {venues.map((v) => {
                      const checked = editVenueIds.includes(String(v.id));
                      return (
                        <label
                          key={v.id}
                          className={`flex items-center space-x-2.5 p-2 rounded-lg border cursor-pointer transition ${
                            checked ? 'border-amber-500/50 bg-amber-500/10' : 'border-slate-800 bg-slate-950 hover:border-slate-600'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleEditVenue(v.id)}
                            className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-amber-500 focus:ring-amber-500"
                          />
                          <span className="text-sm text-white">{v.name}</span>
                          <span className="text-[11px] text-slate-500 truncate">{v.address}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
                {editRole === 'venue_manager' && editVenueIds.length === 0 && (
                  <p className="text-[11px] text-rose-400 mt-2">Select at least one venue.</p>
                )}
              </div>
            )}

            <div className="flex justify-end space-x-3 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                disabled={savingEdit}
                className="px-4 py-2 text-sm rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveUserEdit}
                disabled={savingEdit || (editRole === 'venue_manager' && editVenueIds.length === 0)}
                className="px-4 py-2 text-sm rounded-xl bg-amber-500 text-slate-950 font-semibold hover:bg-amber-400 disabled:opacity-50"
              >
                {savingEdit ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
```

---

## 8. Rebuild & Verification

No schema change:
```bash
docker compose up -d --build backend frontend
```

Verify:
1. **Registration defaults to worker:** sign up a new account from the login page ("New here? Create a worker account") → Admin Panel → Users shows them with a green **Worker** badge.
2. **Promote to manager:** Admin Panel → Users → pencil icon on that user → **Venue Manager** → the Save button stays disabled until a venue is checked → check one venue → Save → badge turns amber, "Affiliated Venues" shows the venue.
3. That user refreshes the browser (or signs out/in) → lands on / can open **Venue Manager View** showing the assigned venue.
4. Promote them to a second venue (edit → check two venues) → their dashboard header shows a venue dropdown; switching reloads shifts, approvals, and the board for that venue.
5. Demote them back to **Worker** with no venues checked → their manager rows are gone (`GET /api/venues/managed` as them returns 403, since they're a worker now), and "Venue Manager View" no longer opens.
6. Edit your OWN user → role buttons are disabled with "You can't change your own role."; `PATCH /api/admin/users/{your_id}` with `{"role":"worker"}` → 400.
7. With only one platform admin, try to demote or deactivate them from another admin session → 400 "Cannot remove the last active platform admin."
8. A venue manager with zero venues (e.g. created via API) → dashboard shows "No venue assigned yet" (NOT another venue's data).
9. **Posted Shifts board:** create "Friday Gala" with Bartender ×2 and AV Tech ×1 → the board shows ONE event card with two position rows, each with rate, tips badge, and 0/2, 0/1 filled.
10. As a worker, request the Bartender position → board shows an amber "1 request to review" on the event and a request count on the Bartender row → **View Roster** → the worker appears under Bartender → **Requested** with Approve/Deny → Approve → they move to **Assigned** (Confirmed), counts update without a page reload.
11. Upcoming / Past / All toggle changes the list; Calendar view shows one entry per event, amber when requests are pending; clicking an entry opens the same roster modal.
12. The existing Approval Queue and Pending Transfers sections still work unchanged.