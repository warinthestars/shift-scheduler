from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List
from datetime import datetime, date
from uuid import UUID
from enum import Enum

class RoleEnum(str, Enum):
    platform_admin = "platform_admin"
    venue_manager = "venue_manager"
    worker = "worker"

    # Backward compatibility aliases
    PLATFORM_ADMIN = "platform_admin"
    VENUE_MANAGER = "venue_manager"
    WORKER = "worker"
    SUPER_ADMIN = "platform_admin"

UserRole = RoleEnum

class RequestStatusEnum(str, Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    CHECKED_IN = "CHECKED_IN"
    COMPLETED = "COMPLETED"
    DROPPED = "dropped"
    dropped = "dropped"
    pending_manager_approval = "pending_manager_approval"
    approved = "approved"
    confirmed = "confirmed"

RequestStatus = RequestStatusEnum

class ShiftStatus(str, Enum):
    OPEN = "OPEN"
    FILLED = "FILLED"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    open = "open"
    filled = "filled"
    completed = "completed"
    cancelled = "cancelled"

ShiftStatusEnum = ShiftStatus


# ------------------------------------------------------------------------------
# Auth Schemas
# ------------------------------------------------------------------------------
class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    role: Optional[str] = "worker"  # "platform_admin", "venue_manager", or "worker"
    first_name: Optional[str] = ""
    last_name: Optional[str] = ""
    phone: Optional[str] = None
    skills: Optional[List[str]] = []
    bio: Optional[str] = None

class RegisterRequest(UserCreate):
    pass

class FirebaseLoginRequest(BaseModel):
    firebase_token: str
    email: Optional[EmailStr] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: Optional["UserResponse"] = None

# ------------------------------------------------------------------------------
# User Schemas
# ------------------------------------------------------------------------------
class UserBase(BaseModel):
    email: EmailStr
    first_name: str
    last_name: str
    role: str
    phone: Optional[str] = None
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
    skills: List[str] = []

class UserResponse(UserBase):
    id: UUID
    venue_id: Optional[str] = None
    venue_ids: Optional[List[UUID]] = []
    venue_names: Optional[List[str]] = []
    aggregate_rating: float
    rating_count: int
    total_shifts: int
    is_active: bool
    created_at: datetime
    auth_source: Optional[str] = None     # "local" | "firebase" | "both"
    has_password: bool = False
    temporary_password: Optional[str] = None   # Phase 29.2: only on admin create, when generated

    # For UI compatibility
    @property
    def rating_average(self) -> float:
        return self.aggregate_rating

    @property
    def total_shifts_completed(self) -> int:
        return self.total_shifts

    class Config:
        from_attributes = True

class UserCreateAdmin(BaseModel):
    email: EmailStr
    password: Optional[str] = None           # Phase 29.2: blank = generate a temporary password (returned once)
    first_name: str
    last_name: str
    phone: Optional[str] = None
    role: str = "worker"
    venue_ids: Optional[List[UUID]] = []

class UserUpdateAdmin(BaseModel):
    role: Optional[str] = None
    is_active: Optional[bool] = None
    email: Optional[EmailStr] = None         # Phase 29.2
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    venue_ids: Optional[List[UUID]] = None

class UserUpdateMe(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
    skills: Optional[List[str]] = None

class UserBrief(BaseModel):
    id: UUID
    first_name: str
    last_name: str
    email: str
    role: str
    aggregate_rating: float
    rating_count: int = 0                    # Phase 29: 0 = "New" (no real ratings yet)

    class Config:
        from_attributes = True

# ------------------------------------------------------------------------------
# Venue Schemas
# ------------------------------------------------------------------------------
class VenueBase(BaseModel):
    name: str
    address: str
    lat: float
    lng: float
    geofence_radius_meters: int = 100
    auto_approve_rating_threshold: Optional[float] = None
    description: Optional[str] = None
    logo_url: Optional[str] = None
    timezone: str = "America/New_York"
    phone: Optional[str] = None
    arrival_instructions: Optional[str] = None
    dress_code: Optional[str] = None
    default_shift_notes: Optional[str] = None
    approval_policy: str = "team_auto"
    show_rates_publicly: bool = True
    geofence_enabled: bool = False          # Phase 27
    geofence_buffer_meters: int = 150       # Phase 27
    clock_in_early_minutes: int = 30        # Phase 27
    auto_clock_out_hours: int = 2           # Phase 27

class VenueCreate(BaseModel):
    name: str
    address: str
    lat: Optional[float] = 40.7128
    lng: Optional[float] = -74.0060
    geofence_radius_meters: Optional[int] = 100
    auto_approve_rating_threshold: Optional[float] = None
    description: Optional[str] = None
    logo_url: Optional[str] = None
    timezone: Optional[str] = "America/New_York"
    phone: Optional[str] = None
    arrival_instructions: Optional[str] = None
    dress_code: Optional[str] = None
    default_shift_notes: Optional[str] = None
    approval_policy: Optional[str] = "team_auto"
    show_rates_publicly: Optional[bool] = True
    geofence_enabled: Optional[bool] = False          # Phase 27
    geofence_buffer_meters: Optional[int] = 150       # Phase 27
    clock_in_early_minutes: Optional[int] = 30        # Phase 27
    auto_clock_out_hours: Optional[int] = 2           # Phase 27
    manager_email: Optional[EmailStr] = None
    initial_manager_email: Optional[EmailStr] = None

class VenueUpdateSettings(BaseModel):
    """Phase 25: partial update — only fields that are sent are changed."""
    name: Optional[str] = None
    address: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    geofence_radius_meters: Optional[int] = None
    auto_approve_rating_threshold: Optional[float] = None
    description: Optional[str] = None
    logo_url: Optional[str] = None
    timezone: Optional[str] = None
    phone: Optional[str] = None
    arrival_instructions: Optional[str] = None
    dress_code: Optional[str] = None
    default_shift_notes: Optional[str] = None
    approval_policy: Optional[str] = None
    show_rates_publicly: Optional[bool] = None
    geofence_enabled: Optional[bool] = None           # Phase 27
    geofence_buffer_meters: Optional[int] = None      # Phase 27
    clock_in_early_minutes: Optional[int] = None      # Phase 27
    auto_clock_out_hours: Optional[int] = None        # Phase 27

class VenueResponse(VenueBase):
    id: UUID
    created_at: datetime
    updated_at: datetime
    total_shifts: Optional[int] = 0
    total_managers: Optional[int] = 0
    assigned_workers_count: Optional[int] = 0
    total_assigned_workers: Optional[int] = 0

    class Config:
        from_attributes = True

class WhitelistAddRequest(BaseModel):
    worker_id: UUID
    notes: Optional[str] = None

class WhitelistResponse(BaseModel):
    id: UUID
    venue_id: UUID
    worker_id: UUID
    notes: Optional[str] = None
    is_active: bool
    created_at: datetime
    worker: Optional[UserBrief] = None

    class Config:
        from_attributes = True

# ------------------------------------------------------------------------------
# Shift Schemas
# ------------------------------------------------------------------------------
class RoleRequirement(BaseModel):
    role: str
    quantity: int = 1
    hourly_rate: Optional[float] = None
    tips_eligible: bool = False
    tip_pool: bool = False
    hourly_rate_max: Optional[float] = None
    hide_rate: bool = False
    role_notes: Optional[str] = None
    approval_mode: Optional[str] = None

class ShiftCreate(BaseModel):
    venue_id: UUID
    title: str
    role_type: Optional[str] = "Worker"
    start_time: datetime
    end_time: datetime
    capacity: Optional[int] = 1
    is_shift_auto_confirm: Optional[bool] = False
    hourly_rate: Optional[float] = 25.00
    tips_eligible: Optional[bool] = False
    tip_pool: Optional[bool] = False
    description: Optional[str] = None
    role_requirements: Optional[List[RoleRequirement]] = None

class ShiftResponse(BaseModel):
    id: UUID
    venue_id: UUID
    title: Optional[str] = "Shift"
    name: Optional[str] = None
    role_type: Optional[str] = "Worker"
    start_time: datetime
    end_time: datetime
    capacity: Optional[int] = 1
    spots_filled: Optional[int] = 0
    available_spots: Optional[int] = None
    is_shift_auto_confirm: Optional[bool] = False
    hourly_rate: Optional[float] = None
    tips_eligible: Optional[bool] = False
    tip_pool: Optional[bool] = False
    hourly_rate_max: Optional[float] = None
    hide_rate: Optional[bool] = False
    approval_mode: Optional[str] = "venue_default"
    event_id: Optional[UUID] = None
    event_notes: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = "OPEN"
    created_at: Optional[datetime] = None
    venue: Optional[VenueResponse] = None

    # Aliases
    @property
    def role_required(self) -> str:
        return self.role_type or "Worker"

    @property
    def spots_needed(self) -> int:
        return self.capacity or 1

    @property
    def auto_confirm_anyone(self) -> bool:
        return bool(self.is_shift_auto_confirm)

    class Config:
        from_attributes = True

class WorkerContactSchema(BaseModel):
    id: UUID
    first_name: Optional[str] = ""
    last_name: Optional[str] = ""
    email: Optional[str] = None
    phone: Optional[str] = None
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
    aggregate_rating: Optional[float] = 5.0
    rating_count: int = 0                    # Phase 29

    class Config:
        from_attributes = True

class ShiftRosterResponse(ShiftResponse):
    name: Optional[str] = None
    assigned_workers: Optional[List[WorkerContactSchema]] = []

class ShiftRequestResponse(BaseModel):
    id: UUID
    shift_id: UUID
    worker_id: UUID
    status: str
    approval_source: Optional[str] = None
    approved_at: Optional[datetime] = None
    check_in_time: Optional[datetime] = None
    check_in_verified: bool
    check_out_time: Optional[datetime] = None
    check_out_verified: bool
    created_at: datetime
    status_reason: Optional[str] = None
    pay_rate: Optional[float] = None
    notes: Optional[str] = None         # Phase 26.1: the worker's note with the request
    shift: Optional[ShiftResponse] = None
    worker: Optional[UserBrief] = None

    class Config:
        from_attributes = True

class WorkerReliability(BaseModel):
    worker_id: UUID
    score: Optional[float] = None   # None = no commitments yet ("New")
    commitments: int = 0
    completed: int = 0
    on_time: int = 0
    late: int = 0
    no_show: int = 0
    late_drop: int = 0

class ShiftRequestStatusUpdate(BaseModel):
    status: str = Field(description="Must be APPROVED or REJECTED")

class CheckInRequest(BaseModel):
    latitude: float
    longitude: float

class CheckOutRequest(BaseModel):
    latitude: float
    longitude: float

# ------------------------------------------------------------------------------
# Time Tracking Schemas
# ------------------------------------------------------------------------------
class TimeEntryResponse(BaseModel):
    id: UUID
    worker_id: UUID
    shift_id: UUID
    clock_in_time: datetime
    clock_out_time: Optional[datetime] = None
    clock_in_geo_status: Optional[str] = None       # Phase 27
    clock_in_distance_m: Optional[int] = None       # Phase 27
    clock_out_geo_status: Optional[str] = None      # Phase 27
    clock_out_distance_m: Optional[int] = None      # Phase 27
    auto_closed: bool = False                       # Phase 27

    class Config:
        from_attributes = True

# ------------------------------------------------------------------------------
# Shift Transfer Schemas
# ------------------------------------------------------------------------------
class ShiftTransferCreate(BaseModel):
    shift_id: UUID
    to_worker_id: UUID
    notes: Optional[str] = None

class ShiftTransferRespond(BaseModel):
    action: str = Field(..., description="'accept' or 'decline'")

class ShiftTransferManagerReview(BaseModel):
    action: str = Field(..., description="'approve' or 'deny'")

class ShiftTransferResponse(BaseModel):
    id: UUID
    shift_id: UUID
    from_worker_id: UUID
    to_worker_id: UUID
    status: str
    notes: Optional[str] = None              # Phase 29.1: the note with the hand-off (was never sent)
    created_at: datetime
    updated_at: datetime
    shift: Optional[ShiftResponse] = None
    from_worker: Optional[UserBrief] = None
    to_worker: Optional[UserBrief] = None

    class Config:
        from_attributes = True

# ------------------------------------------------------------------------------
# Shift Board Message Schemas
# ------------------------------------------------------------------------------
class ShiftBoardMessageCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=5000)

class ShiftBoardMessageResponse(BaseModel):
    id: UUID
    shift_id: UUID
    author_id: UUID
    content: str
    created_at: datetime
    author: Optional[UserBrief] = None

    class Config:
        from_attributes = True

TokenResponse.model_rebuild()

# ------------------------------------------------------------------------------
# Phase 23: Posted Shifts board (event-grouped roster)
# ------------------------------------------------------------------------------
class PositionOffer(BaseModel):
    """Phase 29: an offer sent for this position (shown on the manager's roster)."""
    offer_id: UUID
    worker_id: UUID
    first_name: str = ""
    last_name: str = ""
    status: str                              # pending | accepted | declined | filled | cancelled
    created_at: datetime
    responded_at: Optional[datetime] = None


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
    note: Optional[str] = None          # Phase 26.1: worker's note with their request
    info_seen: Optional[bool] = None    # Phase 26.2: booked person has read the latest shift info (None = nothing to read)
    rating_count: int = 0               # Phase 29: 0 = "New"
    my_rating: Optional[int] = None     # Phase 29: this venue's rating for THIS shift (1-5)
    would_book_again: Optional[bool] = None
    rating_review: Optional[str] = None
    approval_source: Optional[str] = None   # Phase 29: e.g. manager_assign, offer


class EventPosition(BaseModel):
    shift_id: UUID
    role_type: str
    hourly_rate: float
    tips_eligible: bool = False
    tip_pool: bool = False
    hourly_rate_max: Optional[float] = None
    hide_rate: bool = False
    role_notes: Optional[str] = None
    staff_notes: Optional[str] = None        # Phase 26.2
    approval_mode: str = "venue_default"
    capacity: int
    spots_filled: int
    status: str
    assigned: List[RosterPerson] = []
    requested: List[RosterPerson] = []
    offers: List[PositionOffer] = []         # Phase 29: pending + recently answered offers


class VenueEventResponse(BaseModel):
    event_key: str
    event_id: Optional[UUID] = None
    location_name: Optional[str] = None      # Phase 27: None = venue address
    cancelled: bool = False
    cancel_reason: Optional[str] = None
    title: str
    start_time: datetime
    end_time: datetime
    description: Optional[str] = None
    staff_notes: Optional[str] = None        # Phase 26.2
    total_capacity: int
    total_assigned: int
    total_requested: int
    positions: List[EventPosition]

# ------------------------------------------------------------------------------
# Phase 25: Venue positions
# ------------------------------------------------------------------------------
class VenuePositionCreate(BaseModel):
    name: str
    default_rate: float
    default_rate_max: Optional[float] = None
    hide_rate: bool = False
    tips_eligible: bool = False
    tip_pool: bool = False


class VenuePositionUpdate(BaseModel):
    name: Optional[str] = None
    default_rate: Optional[float] = None
    default_rate_max: Optional[float] = None
    hide_rate: Optional[bool] = None
    tips_eligible: Optional[bool] = None
    tip_pool: Optional[bool] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


class VenuePositionResponse(BaseModel):
    id: UUID
    venue_id: UUID
    name: str
    default_rate: float
    default_rate_max: Optional[float] = None
    hide_rate: bool = False
    tips_eligible: bool
    tip_pool: bool
    sort_order: int
    is_active: bool

    class Config:
        from_attributes = True


# ------------------------------------------------------------------------------
# Phase 25.1: Public venue directory & profile (no worker PII)
# ------------------------------------------------------------------------------
class VenueDirectoryItem(BaseModel):
    id: UUID
    name: str
    address: str
    description: Optional[str] = None
    logo_url: Optional[str] = None
    timezone: str = "America/New_York"
    lat: float
    lng: float
    open_spots: int = 0
    upcoming_shift_count: int = 0
    total_shifts_posted: int = 0
    next_shift_start: Optional[datetime] = None
    show_rates_publicly: bool = True
    rate_min: Optional[float] = None
    rate_max: Optional[float] = None


class PublicPosition(BaseModel):
    name: str
    default_rate: Optional[float] = None
    default_rate_max: Optional[float] = None
    tips_eligible: bool = False
    tip_pool: bool = False


class VenueProfileResponse(BaseModel):
    id: UUID
    name: str
    address: str
    description: Optional[str] = None
    logo_url: Optional[str] = None
    phone: Optional[str] = None
    timezone: str = "America/New_York"
    lat: float
    lng: float
    dress_code: Optional[str] = None
    arrival_instructions: Optional[str] = None
    show_rates_publicly: bool = True
    positions: List[PublicPosition] = []
    events_last_90_days: int = 0
    spots_posted_last_90_days: int = 0
    spots_filled_last_90_days: int = 0
    workers_booked_all_time: int = 0
    can_manage: bool = False


class PublicEventPosition(BaseModel):
    shift_id: UUID
    role_type: str
    hourly_rate: Optional[float] = None
    hourly_rate_max: Optional[float] = None
    hide_rate: bool = False
    role_notes: Optional[str] = None
    tips_eligible: bool = False
    tip_pool: bool = False
    capacity: int
    filled: int
    spots_left: int
    status: str
    my_status: Optional[str] = None


class PublicVenueEvent(BaseModel):
    event_key: str
    event_id: Optional[UUID] = None     # Phase 26.1: opens the worker listing modal
    location_name: Optional[str] = None # Phase 27
    title: str
    start_time: datetime
    end_time: datetime
    description: Optional[str] = None
    total_capacity: int
    total_filled: int
    positions: List[PublicEventPosition]


# ------------------------------------------------------------------------------
# Phase 25.2: Events (create / edit / detail)
# ------------------------------------------------------------------------------
# ------------------------------------------------------------------------------
# Phase 27: Saved locations, geofence, clocking
# ------------------------------------------------------------------------------
class VenueLocationInput(BaseModel):
    name: str
    address: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    radius_meters: Optional[int] = None      # None = use the venue's radius
    notes: Optional[str] = None              # "Location notes": everyone viewing the event sees these


class VenueLocationUpdate(BaseModel):
    """Partial update: only fields that are sent change. Edits are global (every event using it)."""
    name: Optional[str] = None
    address: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    clear_pin: bool = False                  # true = remove lat/lng
    radius_meters: Optional[int] = None
    clear_radius: bool = False               # true = back to the venue radius
    notes: Optional[str] = None


class VenueLocationResponse(BaseModel):
    id: UUID
    venue_id: UUID
    name: str
    address: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    radius_meters: Optional[int] = None
    notes: Optional[str] = None
    is_archived: bool = False
    event_count: int = 0                     # how many events use it (all time)
    upcoming_count: int = 0                  # upcoming, not-cancelled events using it

    class Config:
        from_attributes = True


class ListingLocation(BaseModel):
    """What a worker sees for an event held somewhere other than the venue's own address."""
    id: UUID
    name: str
    address: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    notes: Optional[str] = None


class ClockBody(BaseModel):
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    accuracy_m: Optional[float] = None


class ClockResult(BaseModel):
    status: str                               # clocked_in | clocked_out | undone | already_clocked_in
    message: str
    entry: Optional[TimeEntryResponse] = None
    geo_status: Optional[str] = None          # on_site | outside_geofence | not_checked
    distance_m: Optional[int] = None
    late_minutes: int = 0


class EventPositionInput(BaseModel):
    shift_id: Optional[UUID] = None          # present = update existing position, absent = new
    role_type: str
    capacity: int = 1
    hourly_rate: float
    hourly_rate_max: Optional[float] = None
    hide_rate: bool = False
    tips_eligible: bool = False
    tip_pool: bool = False
    role_notes: Optional[str] = None
    staff_notes: Optional[str] = None        # Phase 26.2: only shown to people booked on this position
    approval_mode: str = "venue_default"     # venue_default | auto | manual


class EventCreate(BaseModel):
    venue_id: UUID
    title: str
    start_time: datetime
    end_time: datetime
    notes: Optional[str] = None
    staff_notes: Optional[str] = None        # Phase 26.2: only shown to booked staff
    location_id: Optional[UUID] = None       # Phase 27: saved location (None = venue address)
    new_location: Optional[VenueLocationInput] = None   # Phase 27: create + save to the list, then use it
    geofence_mode: str = "venue_default"     # Phase 27: venue_default | on | off
    location_staff_notes: Optional[str] = None          # Phase 27: event-specific, confirmed staff only
    positions: List[EventPositionInput]


class EventUpdate(BaseModel):
    title: str
    start_time: datetime
    end_time: datetime
    notes: Optional[str] = None
    staff_notes: Optional[str] = None        # Phase 26.2
    location_id: Optional[UUID] = None       # Phase 27
    new_location: Optional[VenueLocationInput] = None   # Phase 27
    geofence_mode: str = "venue_default"     # Phase 27
    location_staff_notes: Optional[str] = None          # Phase 27
    positions: List[EventPositionInput]


class EventDetailPosition(BaseModel):
    shift_id: UUID
    role_type: str
    capacity: int
    spots_filled: int
    assigned_count: int
    pending_count: int
    hourly_rate: float
    hourly_rate_max: Optional[float] = None
    hide_rate: bool = False
    tips_eligible: bool = False
    tip_pool: bool = False
    role_notes: Optional[str] = None
    staff_notes: Optional[str] = None        # Phase 26.2
    approval_mode: str = "venue_default"
    status: str


class EventDetail(BaseModel):
    id: UUID
    venue_id: UUID
    title: str
    start_time: datetime
    end_time: datetime
    notes: Optional[str] = None
    staff_notes: Optional[str] = None        # Phase 26.2
    location: Optional[VenueLocationResponse] = None    # Phase 27 (None = venue address)
    geofence_mode: str = "venue_default"                # Phase 27
    geofence_on: bool = False                           # Phase 27: effective setting
    location_staff_notes: Optional[str] = None          # Phase 27
    cancelled: bool = False
    cancel_reason: Optional[str] = None
    positions: List[EventDetailPosition]


# ------------------------------------------------------------------------------
# Phase 25.4: Admin password reset
# ------------------------------------------------------------------------------
class AdminPasswordReset(BaseModel):
    new_password: Optional[str] = None     # omit to generate a temporary password


class AdminPasswordResetResponse(BaseModel):
    user_id: UUID
    generated: bool
    temporary_password: Optional[str] = None   # only returned when generated=True


# ------------------------------------------------------------------------------
# Phase 26: Lifecycle + time sheets
# ------------------------------------------------------------------------------
class ReasonBody(BaseModel):
    reason: Optional[str] = None


class DuplicateEventRequest(BaseModel):
    dates: List[date]


class DuplicateEventResult(BaseModel):
    created_event_ids: List[UUID]
    count: int


class TimeEntryInput(BaseModel):
    clock_in_time: datetime
    clock_out_time: Optional[datetime] = None
    reason: Optional[str] = None


class PayRateInput(BaseModel):
    pay_rate: Optional[float] = None      # null = back to the posted rate
    reason: Optional[str] = None


class TimeEntryRow(BaseModel):
    id: UUID
    clock_in_time: datetime
    clock_out_time: Optional[datetime] = None
    hours: float
    edited: bool = False
    clock_in_geo_status: Optional[str] = None    # Phase 27
    clock_in_distance_m: Optional[int] = None
    clock_out_geo_status: Optional[str] = None
    clock_out_distance_m: Optional[int] = None
    auto_closed: bool = False
    late_minutes: int = 0


class TimesheetPerson(BaseModel):
    request_id: UUID
    worker_id: UUID
    name: str
    shift_id: UUID
    role_type: str
    status: str
    status_reason: Optional[str] = None
    pay_rate: float
    pay_rate_custom: bool
    rate_min: float
    rate_max: Optional[float] = None
    entries: List[TimeEntryRow]
    total_hours: float
    est_pay: float


class EventTimesheet(BaseModel):
    event_id: UUID
    title: str
    start_time: datetime
    end_time: datetime
    timezone: str
    cancelled: bool = False
    started: bool = False
    people: List[TimesheetPerson]
    total_hours: float
    total_pay: float


# ------------------------------------------------------------------------------
# Phase 26.1: Worker event listings (one card per event)
# ------------------------------------------------------------------------------
class ListingVenue(BaseModel):
    id: UUID
    name: str
    address: Optional[str] = None
    timezone: str = "America/New_York"
    logo_url: Optional[str] = None
    phone: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    dress_code: Optional[str] = None
    arrival_instructions: Optional[str] = None
    default_shift_notes: Optional[str] = None


class ListingPosition(BaseModel):
    shift_id: UUID
    role_type: str
    role_notes: Optional[str] = None
    hourly_rate: Optional[float] = None        # None = hidden from this viewer
    hourly_rate_max: Optional[float] = None
    hide_rate: bool = False
    tips_eligible: bool = False
    tip_pool: bool = False
    capacity: int
    spots_left: int
    status: str                                # OPEN | FILLED
    booking: str                               # instant | approval  (for THIS viewer)
    est_pay_min: Optional[float] = None        # hours x rate, None when pay is hidden
    est_pay_max: Optional[float] = None
    my_status: Optional[str] = None            # viewer's request status on this position
    my_status_reason: Optional[str] = None
    staff_notes: Optional[str] = None          # Phase 26.2: only when the viewer is booked here (or manages)


class ListingMyRequest(BaseModel):
    request_id: UUID
    shift_id: UUID
    role_type: str
    status: str
    note: Optional[str] = None


class EventListing(BaseModel):
    event_id: UUID
    title: str
    notes: Optional[str] = None
    location: Optional[ListingLocation] = None        # Phase 27: None = at the venue's address
    location_staff_notes: Optional[str] = None        # Phase 27: booked viewers only
    geofence_on: bool = False                         # Phase 27
    start_time: datetime
    end_time: datetime
    hours: float
    venue: ListingVenue
    positions: List[ListingPosition]
    total_capacity: int
    total_spots_left: int
    open_positions: int
    pay_min: Optional[float] = None
    pay_max: Optional[float] = None
    any_tips: bool = False
    any_instant: bool = False
    on_team: bool = False
    my_request: Optional[ListingMyRequest] = None     # the viewer's ACTIVE request in this event
    conflict: Optional[str] = None                    # "Blue Bar · Friday Service" when it overlaps a booked shift
    staff_notes: Optional[str] = None                 # Phase 26.2: only when the viewer is booked in this event (or manages)
    cancelled: bool = False
    cancel_reason: Optional[str] = None
    started: bool = False
    can_request: bool = True


class PositionRequestBody(BaseModel):
    shift_id: UUID
    note: Optional[str] = Field(None, max_length=500)
    switch: bool = False


class PositionRequestResult(BaseModel):
    request_id: UUID
    status: str
    instant: bool
    message: str
    listing: Optional[EventListing] = None


# ------------------------------------------------------------------------------
# Phase 26.2: Worker calendar + "make sure they read it"
# ------------------------------------------------------------------------------
class WorkerCalendarItem(BaseModel):
    request_id: UUID
    shift_id: UUID
    event_id: Optional[UUID] = None
    status: str                                   # the worker's request status
    status_reason: Optional[str] = None
    booked: bool                                  # approved / confirmed / checked_in / completed
    title: str
    role_type: str
    start_time: datetime
    end_time: datetime
    hours: float
    venue: ListingVenue
    location: Optional[ListingLocation] = None    # Phase 27: None = at the venue's address
    location_staff_notes: Optional[str] = None    # Phase 27: booked only
    geofence_on: bool = False                     # Phase 27: phone location needed to clock in
    clock_in_opens_at: Optional[datetime] = None  # Phase 27
    time_entry_id: Optional[UUID] = None          # Phase 27: open entry, if clocked in
    hourly_rate: Optional[float] = None           # None = hidden until booked
    hourly_rate_max: Optional[float] = None
    pay_rate: Optional[float] = None              # manager-set rate for this person (booked only)
    tips_eligible: bool = False
    tip_pool: bool = False
    event_notes: Optional[str] = None
    role_notes: Optional[str] = None
    event_staff_notes: Optional[str] = None       # booked only
    position_staff_notes: Optional[str] = None    # booked only
    staff_notes_locked: bool = False              # waiting + staff notes exist -> "more details once confirmed"
    info_change: Optional[str] = None             # what changed since the worker last read it
    info_updated_at: Optional[datetime] = None
    info_seen_at: Optional[datetime] = None
    needs_ack: bool = False                       # show "Please read" until they tap "Got it"
    clocked_in: bool = False
    cancelled: bool = False
    cancel_reason: Optional[str] = None


class WorkerCalendarResponse(BaseModel):
    range_start: datetime
    range_end: datetime
    unread_count: int
    items: List[WorkerCalendarItem]


class InfoAckResponse(BaseModel):
    request_id: UUID
    info_seen_at: datetime





# ------------------------------------------------------------------------------
# Phase 28: Notifications
# ------------------------------------------------------------------------------
class NotificationResponse(BaseModel):
    id: UUID
    kind: str
    title: str
    body: Optional[str] = None
    link: Optional[str] = None
    urgent: bool = False
    read: bool = False
    created_at: datetime


class UnreadCountResponse(BaseModel):
    count: int


class NotificationPreferencesResponse(BaseModel):
    email_enabled: bool = True
    sms_enabled: bool = False
    reminders_enabled: bool = True
    new_shift_alerts: str = "daily"          # off | instant | daily
    manager_alerts_email: bool = True
    quiet_start: Optional[int] = None        # hour 0-23
    quiet_end: Optional[int] = None
    timezone: str = "America/New_York"
    email: Optional[str] = None              # the account email (read-only here)
    phone: Optional[str] = None              # users.phone (texts go here)
    email_available: bool = True             # server can send email (not console-only)
    sms_available: bool = False              # server has SMS configured
    is_manager: bool = False                 # show manager-only options
    discoverable: str = "private"            # Phase 29.1: private | venues | everyone


class NotificationPreferencesUpdate(BaseModel):
    email_enabled: Optional[bool] = None
    sms_enabled: Optional[bool] = None
    reminders_enabled: Optional[bool] = None
    new_shift_alerts: Optional[str] = None
    manager_alerts_email: Optional[bool] = None
    quiet_start: Optional[int] = None
    quiet_end: Optional[int] = None
    clear_quiet_hours: bool = False
    timezone: Optional[str] = None
    phone: Optional[str] = None              # saved to users.phone; "" clears it
    discoverable: Optional[str] = None       # Phase 29.1: private | venues | everyone


# ------------------------------------------------------------------------------
# Phase 29: Team, invites, direct assign / offers, ratings
# ------------------------------------------------------------------------------
class TeamMember(BaseModel):
    worker_id: UUID
    first_name: str = ""
    last_name: str = ""
    email: Optional[str] = None
    phone: Optional[str] = None
    avatar_url: Optional[str] = None
    status: str = "active"                   # active | removed | blocked | none (Phase 29.1: no relationship yet)
    on_list: bool = False                    # has a team-list row (added / invited), not just "worked here"
    source: Optional[str] = None             # manager | invite | import | admin | worked
    positions: List[str] = []
    notes: Optional[str] = None              # private to this venue's managers
    shifts_worked: int = 0                   # finished shifts at this venue
    upcoming: int = 0                        # booked, not finished yet, at this venue
    last_worked: Optional[datetime] = None
    aggregate_rating: float = 5.0            # across all venues
    rating_count: int = 0                    # 0 = "New"
    venue_rating: Optional[float] = None     # average of THIS venue's ratings
    venue_rating_count: int = 0
    would_book_again_yes: int = 0
    would_book_again_no: int = 0
    reliability: Optional[WorkerReliability] = None
    added_at: Optional[datetime] = None


class TeamMemberUpdate(BaseModel):
    status: Optional[str] = None             # active | removed | blocked
    positions: Optional[List[str]] = None
    notes: Optional[str] = None


class TeamMemberUpdateResult(BaseModel):
    member: TeamMember
    message: str
    booked_upcoming: int = 0                 # blocking doesn't remove existing bookings; this says how many remain


class TeamAddExisting(BaseModel):
    email: Optional[str] = None              # Phase 29.1: email OR worker_id (from People search)
    worker_id: Optional[UUID] = None
    positions: List[str] = []


class TeamCreateWorker(BaseModel):
    first_name: str
    last_name: str = ""
    email: str
    phone: Optional[str] = None
    positions: List[str] = []


class AccountCreateResult(BaseModel):
    user_id: UUID
    created: bool                            # False = existing account was linked instead
    temporary_password: Optional[str] = None # shown once
    message: str


class VenueManagerItem(BaseModel):
    user_id: UUID
    first_name: str = ""
    last_name: str = ""
    email: str
    phone: Optional[str] = None
    is_primary: bool = False
    is_you: bool = False


class ManagerCreate(BaseModel):
    email: str
    first_name: str = ""
    last_name: str = ""
    phone: Optional[str] = None


class InviteLinkResponse(BaseModel):
    id: UUID
    token: str
    url: str
    expires_at: datetime
    uses: int = 0
    qr_svg: str                              # SVG markup of the QR code for `url`


class InviteRow(BaseModel):
    first_name: str = ""
    last_name: str = ""
    email: Optional[str] = None
    phone: Optional[str] = None
    positions: List[str] = []


class InviteBatchCreate(BaseModel):
    rows: List[InviteRow]
    send: bool = True                        # email / text the invite now
    source: str = "manual"                   # manual | import


class InviteRowResult(BaseModel):
    row: int                                 # 1-based, as uploaded
    name: str = ""
    email: Optional[str] = None
    result: str                              # invited | already_member | already_invited | invalid
    message: str = ""
    invite_id: Optional[UUID] = None
    url: Optional[str] = None


class InviteBatchResult(BaseModel):
    results: List[InviteRowResult]
    invited: int = 0
    skipped: int = 0
    emailed: int = 0
    texted: int = 0
    email_available: bool = False


class PersonalInvite(BaseModel):
    id: UUID
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    positions: List[str] = []
    status: str                              # pending | accepted | expired | revoked
    url: str
    created_at: datetime
    expires_at: datetime
    last_sent_at: Optional[datetime] = None
    accepted_at: Optional[datetime] = None
    accepted_by_name: Optional[str] = None


class PublicInvite(BaseModel):
    valid: bool
    reason: Optional[str] = None             # why it can't be used (expired / revoked / used)
    venue_id: Optional[UUID] = None
    venue_name: Optional[str] = None
    venue_address: Optional[str] = None
    logo_url: Optional[str] = None
    kind: Optional[str] = None
    first_name: Optional[str] = None
    email: Optional[str] = None
    positions: List[str] = []
    expires_at: Optional[datetime] = None


class InviteAcceptResult(BaseModel):
    venue_id: UUID
    venue_name: str
    already_member: bool = False


class AssignCandidate(BaseModel):
    worker_id: UUID
    first_name: str = ""
    last_name: str = ""
    email: Optional[str] = None
    phone: Optional[str] = None
    aggregate_rating: float = 5.0
    rating_count: int = 0
    reliability_score: Optional[float] = None
    on_team: bool = True
    positions: List[str] = []
    position_match: bool = False             # their team positions include this position
    available: bool = True                   # can be assigned / offered right now
    reason: Optional[str] = None             # why not (overlap, already booked in this event, ...)
    requested_this: bool = False             # has a waiting request on this position (assign = approve it)
    offered: bool = False                    # has a pending offer for this position
    venue_shifts: int = 0


class AssignRequest(BaseModel):
    worker_id: UUID


class AssignResult(BaseModel):
    request_id: UUID
    message: str


class OfferCreate(BaseModel):
    worker_ids: List[UUID]                   # 1-5 people
    message: Optional[str] = None


class OfferSkip(BaseModel):
    worker_id: UUID
    name: str = ""
    reason: str


class OfferCreateResult(BaseModel):
    batch_id: Optional[UUID] = None
    offered: int = 0
    skipped: List[OfferSkip] = []
    message: str = ""


class WorkerOffer(BaseModel):
    offer_id: UUID
    shift_id: UUID
    event_id: Optional[UUID] = None
    venue_id: UUID
    venue_name: str
    venue_timezone: Optional[str] = None
    title: str
    role_type: str
    start_time: datetime
    end_time: datetime
    hourly_rate: Optional[float] = None      # None when hidden
    hourly_rate_max: Optional[float] = None
    tips_eligible: bool = False
    tip_pool: bool = False
    location_name: Optional[str] = None
    address: Optional[str] = None
    message: Optional[str] = None
    offered_by: Optional[str] = None
    others_offered: int = 0                  # other people offered the same spot (first to accept wins)
    created_at: datetime
    expires_at: datetime


class OfferAcceptResult(BaseModel):
    request_id: UUID
    message: str


class RatingInput(BaseModel):
    rating: int = Field(ge=1, le=5)
    would_book_again: Optional[bool] = None
    review: Optional[str] = None


class RatingResponse(BaseModel):
    request_id: UUID
    worker_id: UUID
    rating: Optional[int] = None             # None after delete
    would_book_again: Optional[bool] = None
    review: Optional[str] = None
    aggregate_rating: float
    rating_count: int


# ------------------------------------------------------------------------------
# Phase 29.1: People search, worker profile, team summary, activity log
# ------------------------------------------------------------------------------
class PersonResult(BaseModel):
    worker_id: UUID
    first_name: str = ""
    last_name: str = ""
    email: Optional[str] = None              # masked (j***@gmail.com) unless related or exact match
    phone: Optional[str] = None              # only for people related to this venue
    avatar_url: Optional[str] = None
    relation: str = "none"                   # active | removed | blocked | worked | requested | none
    positions: List[str] = []
    aggregate_rating: float = 5.0
    rating_count: int = 0
    reliability_score: Optional[float] = None
    can_add: bool = True


class WorkerHistoryItem(BaseModel):
    request_id: UUID
    event_id: Optional[UUID] = None
    title: str
    role_type: str
    start_time: datetime
    end_time: datetime
    status: str
    late_minutes: Optional[int] = None
    my_rating: Optional[int] = None
    would_book_again: Optional[bool] = None


class WorkerProfile(BaseModel):
    member: TeamMember
    history: List[WorkerHistoryItem] = []    # this venue only, newest first
    pending_here: int = 0                    # waiting requests at this venue
    other_venues: int = 0                    # other venues they've worked at (count only)


class TeamSummary(BaseModel):
    active: int = 0
    removed: int = 0
    blocked: int = 0
    invites_pending: int = 0
    managers: int = 0


class ActivityItem(BaseModel):
    id: UUID
    kind: str
    category: str
    summary: str
    actor_name: Optional[str] = None
    event_id: Optional[UUID] = None
    request_id: Optional[UUID] = None
    worker_id: Optional[UUID] = None
    created_at: datetime


# ------------------------------------------------------------------------------
# Phase 29.2: Admin console
# ------------------------------------------------------------------------------
class AdminNameRef(BaseModel):
    id: UUID
    name: str


class AdminPersonRef(BaseModel):
    user_id: UUID
    name: str
    email: Optional[str] = None


class AdminMembership(BaseModel):
    venue_id: UUID
    venue_name: str
    status: str                              # active | removed | blocked | worked
    source: Optional[str] = None
    positions: List[str] = []
    notes: Optional[str] = None              # the venue's private note (admins see all)


class AdminUserRow(BaseModel):
    id: UUID
    first_name: str = ""
    last_name: str = ""
    email: str
    phone: Optional[str] = None
    avatar_url: Optional[str] = None
    role: str
    is_active: bool = True
    auth_source: str = "local"               # local | firebase | both
    has_password: bool = False
    created_at: datetime
    managed_venues: List[AdminNameRef] = []
    memberships: List[AdminMembership] = []
    shifts_worked: int = 0
    upcoming: int = 0
    aggregate_rating: float = 5.0
    rating_count: int = 0
    last_activity_at: Optional[datetime] = None
    discoverable: str = "private"
    always_admin: bool = False


class AdminUserPage(BaseModel):
    total: int
    items: List[AdminUserRow]


class AdminHistoryItem(BaseModel):
    request_id: UUID
    venue_id: UUID
    venue_name: str
    event_id: Optional[UUID] = None
    title: str
    role_type: str
    start_time: datetime
    end_time: datetime
    status: str


class AdminAuditItem(BaseModel):
    id: UUID
    actor_name: Optional[str] = None
    action: str
    target_type: str
    target_id: Optional[UUID] = None
    summary: str
    created_at: datetime


class AdminUserDetail(BaseModel):
    user: AdminUserRow
    reliability: Optional[WorkerReliability] = None
    email_enabled: bool = True
    sms_enabled: bool = False
    history: List[AdminHistoryItem] = []
    audit: List[AdminAuditItem] = []


class AdminVenueRow(BaseModel):
    id: UUID
    name: str
    address: str
    timezone: str = "America/New_York"
    created_at: datetime
    managers: List[AdminPersonRef] = []
    team_active: int = 0
    upcoming_events: int = 0                 # next 30 days, not cancelled
    open_spots_7d: int = 0
    pending_requests: int = 0
    approval_policy: str = "team_auto"
    geofence_enabled: bool = False
    positions_count: int = 0
    locations_count: int = 0
    last_activity_at: Optional[datetime] = None
    warnings: List[str] = []


class AdminAttention(BaseModel):
    level: str                               # error | warn | info
    text: str
    kind: str = "system"                     # venue | users | system | deliveries
    target_id: Optional[UUID] = None


class AdminActivityItem(BaseModel):
    id: UUID
    venue_id: UUID
    venue_name: str
    kind: str
    category: str
    summary: str
    actor_name: Optional[str] = None
    event_id: Optional[UUID] = None
    worker_id: Optional[UUID] = None
    created_at: datetime


class AdminOverview(BaseModel):
    users_total: int = 0
    workers: int = 0
    managers: int = 0
    admins: int = 0
    deactivated: int = 0
    new_users_7d: int = 0
    venues: int = 0
    events_next_7d: int = 0
    spots_next_7d: int = 0
    open_spots_next_7d: int = 0
    fill_rate_next_7d: Optional[float] = None
    urgent_open_spots_48h: int = 0
    pending_requests: int = 0
    stale_requests_24h: int = 0
    pending_handoffs: int = 0
    deliveries_sent_24h: int = 0
    deliveries_failed_24h: int = 0
    attention: List[AdminAttention] = []
    recent_activity: List[AdminActivityItem] = []
    recent_audit: List[AdminAuditItem] = []


class AdminDeliveryStats(BaseModel):
    pending: int = 0
    sent_24h: int = 0
    failed_24h: int = 0
    failed_7d: int = 0
    skipped_24h: int = 0


class AdminSystem(BaseModel):
    app_base_url: str = ""
    app_base_url_ok: bool = False
    email_provider: str = "console"
    email_from: str = ""
    email_ready: bool = False
    sms_provider: str = "off"
    sms_ready: bool = False
    firebase: str = "off"                    # real | mock | off
    self_registration: bool = True
    always_admin_count: int = 0
    worker_enabled: bool = True
    worker_started_at: Optional[datetime] = None
    worker_last_tick_at: Optional[datetime] = None
    worker_last_ok: Optional[bool] = None
    worker_last_error: Optional[str] = None
    worker_heartbeat_at: Optional[datetime] = None   # from Redis (any backend process)
    digest_hour: int = 9
    deliveries: AdminDeliveryStats = AdminDeliveryStats()
    table_counts: dict = {}


class AdminDelivery(BaseModel):
    id: UUID
    channel: str
    status: str
    attempts: int = 0
    last_error: Optional[str] = None
    created_at: datetime
    send_after: Optional[datetime] = None
    user_id: UUID
    user_name: str = ""
    user_email: Optional[str] = None
    title: str = ""


class AdminTestEmail(BaseModel):
    to: EmailStr
