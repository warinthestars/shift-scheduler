"""
Phase 25.2: Turn Shift ORM rows into ShiftResponse objects for any viewer:
- fills event_notes (explicit query, never touches shift.event)
- removes pay for hide_rate shifts unless the viewer manages the venue, is an admin,
  or the shift id is in reveal_shift_ids (e.g. the worker is booked on it)
Shifts passed in MUST have `venue` selectinload-ed.
"""
from typing import Iterable, List, Optional, Set

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import Shift, ShiftEvent, User, VenueManager
from src.schemas import ShiftResponse
from src.auth import normalize_role


async def viewer_managed_venue_ids(db: AsyncSession, user: Optional[User]) -> Optional[Set]:
    """None = can see every venue (admin). Empty set = none."""
    if user is None:
        return set()
    if normalize_role(user.role) in ("platform_admin", "super_admin"):
        return None
    rows = (await db.execute(select(VenueManager.venue_id).where(VenueManager.user_id == user.id))).scalars().all()
    return set(rows)


async def to_shift_responses(
    db: AsyncSession,
    shifts: Iterable[Shift],
    user: Optional[User],
    reveal_shift_ids: Optional[Set] = None,
    worker_view: bool = False,
) -> List[ShiftResponse]:
    """
    worker_view=True (Phase 26.3): apply WORKER rules to everyone, admins and managers included,
    so worker-facing screens always show exactly what a worker would see. Hidden pay is then
    only revealed for shift ids in reveal_shift_ids (positions the viewer is booked on).
    """
    shifts = list(shifts)
    reveal = reveal_shift_ids or set()
    managed = set() if worker_view else await viewer_managed_venue_ids(db, user)

    event_ids = {s.event_id for s in shifts if s.event_id}
    notes = {}
    if event_ids:
        notes = dict((await db.execute(
            select(ShiftEvent.id, ShiftEvent.notes).where(ShiftEvent.id.in_(event_ids))
        )).all())

    out = []
    for s in shifts:
        r = ShiftResponse.model_validate(s)
        r.event_notes = notes.get(s.event_id) if s.event_id else None
        can_see = (managed is None) or (s.venue_id in managed) or (s.id in reveal)
        if s.hide_rate and not can_see:
            r.hourly_rate = None
            r.hourly_rate_max = None
        out.append(r)
    return out
