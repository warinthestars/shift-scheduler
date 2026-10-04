"""
Phase 32.2: Departments. Every venue position belongs to one of a fixed set of departments. Venues keep
their own position names ("Main Bar", "A1 Audio"); the department is what lets the platform match people to shifts.

A worker's departments at a venue =
    the departments they picked on their profile (users.departments)
  + the department of every position a manager gave them on THAT venue's team (venue_whitelists.positions)

A shift is:
    'match'    - its department is General, or it's one of the worker's departments (or the manager gave them
                 exactly this position at this venue)
    'outside'  - the worker has departments, and this isn't one of them
    'not_set'  - the worker hasn't picked departments and has no team positions here (never warns)

Outside their departments, a worker can still request the shift, but it always waits for a manager
(even at venues that book their team instantly), and the request is flagged for the manager.
Managers can still assign or offer anyone; their screens show the flag.
"""
import re
from typing import Dict, Iterable, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import User, VenuePosition, VenueWhitelist

# key -> label, short, examples. Order = how they're listed everywhere.
DEPARTMENTS: Dict[str, dict] = {
    "foh": {"label": "Front of House", "short": "FOH", "examples": "Server, host, runner, busser"},
    "bar": {"label": "Bar", "short": "Bar", "examples": "Bartender, barback"},
    "kitchen": {"label": "Kitchen / BOH", "short": "Kitchen", "examples": "Cook, prep, dishwasher"},
    "tech": {"label": "Tech & Production", "short": "Tech", "examples": "AV, audio, lighting, stagehand"},
    "security": {"label": "Security", "short": "Security", "examples": "Door, security, bag check"},
    "ops": {"label": "Event Setup & Ops", "short": "Setup & Ops", "examples": "Load-in, setup, coat check, event staff"},
    "general": {"label": "General", "short": "General", "examples": "Open to anyone"},
}
WORKER_DEPARTMENTS = [k for k in DEPARTMENTS if k != "general"]     # what a worker can pick

# First match wins, so the more specific departments come first.
_GUESS = [
    ("bar", r"bar(tender|back)?|mixolog|barista"),
    ("kitchen", r"cook|chef|kitchen|prep|dish|porter|pastry|sous|line|boh|steward"),
    ("tech", r"\ba/?v\b|audio|sound|light|video|stage|tech|projection|rigg|camera|\bdj\b|production|engineer"),
    ("security", r"secur|door|bouncer|guard|bag check|crowd"),
    ("ops", r"set ?up|load|coat|event staff|usher|ticket|registration|attendant|clean|custod|parking|valet|runner crew|ops"),
    ("foh", r"server|host|runner|busser|bus |waiter|waitress|wait staff|captain|somm|cocktail|expo|food|banquet|foh"),
]


def guess_department(name: Optional[str]) -> str:
    n = f" {(name or '').lower()} "
    for key, pattern in _GUESS:
        if re.search(pattern, n):
            return key
    return "general"


def label(key: str) -> str:
    return DEPARTMENTS.get(key, {}).get("label", key)


def clean_departments(keys: Iterable[str], allow_general: bool = False) -> List[str]:
    """Known keys only, catalogue order, no duplicates. Raises ValueError on unknown keys."""
    wanted = {k for k in (keys or []) if k}
    allowed = set(DEPARTMENTS) if allow_general else set(WORKER_DEPARTMENTS)
    bad = wanted - allowed
    if bad:
        raise ValueError(f"Unknown department: {', '.join(sorted(bad))}.")
    return [k for k in DEPARTMENTS if k in wanted]


class DeptContext:
    """Everything needed to match many workers to many shifts with three queries."""

    def __init__(self):
        self.position_dept: Dict[tuple, str] = {}        # (venue_id, name lower) -> department
        self.worker_depts: Dict[object, List[str]] = {}  # worker_id -> profile departments
        self.team_positions: Dict[tuple, List[str]] = {} # (worker_id, venue_id) -> position names lower

    def dept_of(self, venue_id, role_type: Optional[str]) -> str:
        key = (venue_id, (role_type or "").strip().lower())
        return self.position_dept.get(key) or guess_department(role_type)

    def worker_departments_at(self, worker_id, venue_id) -> List[str]:
        own = list(self.worker_depts.get(worker_id, []))
        for name in self.team_positions.get((worker_id, venue_id), []):
            d = self.position_dept.get((venue_id, name)) or guess_department(name)
            if d not in own:
                own.append(d)
        return own

    def match(self, worker_id, shift) -> str:
        dept = self.dept_of(shift.venue_id, shift.role_type)
        if dept == "general":
            return "match"
        team = self.team_positions.get((worker_id, shift.venue_id), [])
        if (shift.role_type or "").strip().lower() in team:
            return "match"
        mine = self.worker_departments_at(worker_id, shift.venue_id)
        if not mine:
            return "not_set"
        return "match" if dept in mine else "outside"


async def load_dept_context(db: AsyncSession, worker_ids: Iterable, venue_ids: Iterable) -> DeptContext:
    ctx = DeptContext()
    wids = list({w for w in worker_ids if w})
    vids = list({v for v in venue_ids if v})
    if vids:
        for p in (await db.execute(select(VenuePosition).where(VenuePosition.venue_id.in_(vids)))).scalars().all():
            ctx.position_dept[(p.venue_id, (p.name or "").strip().lower())] = p.department or guess_department(p.name)
    if wids:
        for uid, depts in (await db.execute(select(User.id, User.departments).where(User.id.in_(wids)))).all():
            ctx.worker_depts[uid] = list(depts or [])
        if vids:
            for wl in (await db.execute(
                select(VenueWhitelist).where(
                    VenueWhitelist.worker_id.in_(wids), VenueWhitelist.venue_id.in_(vids),
                    VenueWhitelist.is_active == True,
                )
            )).scalars().all():
                if (wl.status or "active") != "active":
                    continue
                ctx.team_positions[(wl.worker_id, wl.venue_id)] = [(n or "").strip().lower() for n in (wl.positions or []) if n]
    return ctx
