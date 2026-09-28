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
    website_url: Optional[str] = None       # Phase 34.6
    arrival_instructions: Optional[str] = None
    dress_code: Optional[str] = None
    default_shift_notes: Optional[str] = None
    approval_policy: str = "team_auto"
    show_rates_publicly: bool = True
    geofence_enabled: bool = False          # Phase 27
    geofence_buffer_meters: int = 150       # Phase 27
    clock_in_early_minutes: int = 30        # Phase 27
    auto_clock_out_hours: int = 2           # Phase 27
    allow_public_cover: bool = True         # Phase 34

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
    website_url: Optional[str] = Field(None, max_length=500)          # Phase 34.6
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
    website_url: Optional[str] = Field(None, max_length=500)          # Phase 34.6: "" clears it
    arrival_instructions: Optional[str] = None
    dress_code: Optional[str] = None
    default_shift_notes: Optional[str] = None
    approval_policy: Optional[str] = None
    show_rates_publicly: Optional[bool] = None
    geofence_enabled: Optional[bool] = None           # Phase 27
    geofence_buffer_meters: Optional[int] = None      # Phase 27
    clock_in_early_minutes: Optional[int] = None      # Phase 27
    auto_clock_out_hours: Optional[int] = None        # Phase 27
    allow_public_cover: Optional[bool] = None         # Phase 34

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
    dropped_at: Optional[datetime] = None            # Phase 29.4
    previous_drop_at: Optional[datetime] = None      # Phase 29.4: asking back / rebooked after dropping this event
    rebook_reason: Optional[str] = None              # Phase 29.4
    outside_department: bool = False                 # Phase 32.2: asked for a shift outside their departments
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
    # Phase 34.5: same limits as ClockBody (these legacy routes build a ClockBody from them)
    latitude: float = Field(..., ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(..., ge=-180, le=180, allow_inf_nan=False)

class CheckOutRequest(BaseModel):
    latitude: float = Field(..., ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(..., ge=-180, le=180, allow_inf_nan=False)

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
    cover_request_id: Optional[UUID] = None  # Phase 34: this hand-off came from a cover post
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
    dropped_at: Optional[datetime] = None        # Phase 29.4: when they dropped (dropped list)
    drop_reason: Optional[str] = None            # Phase 29.4: what they said when dropping
    previous_drop_at: Optional[datetime] = None  # Phase 29.4: came back / asking back after a drop
    rebook_reason: Optional[str] = None          # Phase 29.4
    cert_issues: List[str] = []                  # Phase 32: e.g. "Alcohol server card (expired)", "Food handler card not verified"
    time_off: Optional[str] = None               # Phase 32.1: 'blocked' when a time-off block overlaps this shift
    time_off_reason: Optional[str] = None        # Phase 32.1: the block's reason (managers see it)
    outside_department: bool = False             # Phase 32.2: their request is outside their departments
    cover: Optional[str] = None                  # Phase 34: open | pending_approval (they asked for cover)


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
    dropped: List[RosterPerson] = []         # Phase 29.4: people who dropped this position (can be booked back)
    waitlist: List[str] = []                 # Phase 34: names in line order ("Ana R.")


class VenueEventResponse(BaseModel):
    event_key: str
    event_id: Optional[UUID] = None
    status: str = "published"                # Phase 29.3: draft | published
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
    required_certs: List[str] = []           # Phase 32: cert type keys (services/fit.py CERT_TYPES)
    department: Optional[str] = None         # Phase 32.2: None = guessed from the name


class VenuePositionUpdate(BaseModel):
    name: Optional[str] = None
    default_rate: Optional[float] = None
    default_rate_max: Optional[float] = None
    hide_rate: Optional[bool] = None
    tips_eligible: Optional[bool] = None
    tip_pool: Optional[bool] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None
    required_certs: Optional[List[str]] = None   # Phase 32
    department: Optional[str] = None             # Phase 32.2


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
    required_certs: List[str] = []           # Phase 32
    department: str = "general"              # Phase 32.2

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
    website_url: Optional[str] = None        # Phase 34.6
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
    # Phase 34.5: the server does the distance check, so the numbers must be real coordinates.
    # NaN / Infinity / out-of-range values are refused (422) instead of crashing the distance math (500).
    latitude: Optional[float] = Field(None, ge=-90, le=90, allow_inf_nan=False)
    longitude: Optional[float] = Field(None, ge=-180, le=180, allow_inf_nan=False)
    accuracy_m: Optional[float] = Field(None, ge=0, allow_inf_nan=False)


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
    publish: bool = True                     # Phase 29.3: False = save as a draft (workers can't see it)


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
    status: str = "published"                           # Phase 29.3: draft | published
    published_at: Optional[datetime] = None             # Phase 29.3
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
    as_draft: bool = False                   # Phase 29.3: copies of a draft are always drafts


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


class ListingWaitlist(BaseModel):
    """Phase 34: the viewer's place on a full position's waitlist."""
    entry_id: UUID
    status: str                                # waiting | offered
    place: int = 1                             # 1 = next in line
    auto_book: bool = True                     # True = book me (or send my request) as soon as a spot opens
    offer_expires_at: Optional[datetime] = None


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
    my_dropped_at: Optional[datetime] = None   # Phase 29.4: the viewer dropped this position
    staff_notes: Optional[str] = None          # Phase 26.2: only when the viewer is booked here (or manages)
    required_certs: List[str] = []             # Phase 32: labels of what this position needs
    department: str = "general"                # Phase 32.2: foh | bar | kitchen | tech | security | ops | general
    department_match: str = "not_set"          # Phase 32.2: match | outside | not_set (for THIS viewer)
    missing_certs: List[str] = []              # Phase 32: what the VIEWER is missing (non-empty = can't request)
    waitlist_count: int = 0                    # Phase 34: people waiting for this position (live entries)
    my_waitlist: Optional[ListingWaitlist] = None   # Phase 34: the viewer's place in line
    can_waitlist: bool = False                 # Phase 34: full, and the viewer could join the waitlist


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
    dropped_here: Optional[datetime] = None           # Phase 29.4: viewer dropped a position in this event -> asking back needs a reason + approval
    availability: str = "not_set"                     # Phase 31: fits | outside | not_set (the viewer's weekly availability)
    time_off: Optional[str] = None                    # Phase 32.1: 'blocked' = overlaps one of the viewer's time-off blocks
    department_match: str = "not_set"                 # Phase 32.2: match if any open position fits the viewer's departments
    series_id: Optional[UUID] = None                  # Phase 32.3: set when this event was copied to other dates
    series: List["EventListing"] = []                 # Phase 32.3: single-event view only: the series' other upcoming dates
    series_more: int = 0                              # Phase 32.3: list view: how many other dates of this series are listed too
    full: bool = False                                # Phase 34: no open spots (shown so people can join a waitlist)


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
    push_enabled: bool = True                # Phase 33: phone / browser notifications (on the devices you turned on)
    quiet_start: Optional[int] = None        # hour 0-23
    quiet_end: Optional[int] = None
    timezone: str = "America/New_York"
    email: Optional[str] = None              # the account email (read-only here)
    phone: Optional[str] = None              # users.phone (texts go here)
    email_available: bool = True             # server can send email (not console-only)
    sms_available: bool = False              # server has SMS configured
    is_manager: bool = False                 # show manager-only options
    discoverable: str = "private"            # Phase 29.1: private | venues | everyone


class PushKeys(BaseModel):
    """Phase 33: from the browser's PushSubscription.toJSON().keys"""
    p256dh: str = Field(..., max_length=200)
    auth: str = Field(..., max_length=100)


class PushSubscribeBody(BaseModel):
    provider: str = "webpush"                          # Phase 33.0.1: webpush | fcm
    endpoint: Optional[str] = Field(None, max_length=2000)   # webpush
    keys: Optional[PushKeys] = None                          # webpush
    token: Optional[str] = Field(None, max_length=4096)      # fcm: from firebase getToken()
    device_label: Optional[str] = Field(None, max_length=120)


class PushUnsubscribeBody(BaseModel):
    endpoint: str = Field(..., max_length=4096)              # the Web Push URL, or the Firebase token


class PushDevice(BaseModel):
    id: UUID
    provider: str = "webpush"                          # Phase 33.0.1
    device_label: Optional[str] = None
    created_at: datetime
    last_success_at: Optional[datetime] = None
    last_error: Optional[str] = None


class PushConfigResponse(BaseModel):
    public_key: str                          # VAPID application server key (base64url) for pushManager.subscribe
    devices: List[PushDevice] = []
    provider: str = "webpush"                # Phase 33.0.1: the route new devices use (fcm when Firebase messaging is set up)
    fcm_vapid_key: Optional[str] = None      # Phase 33.0.1: Firebase "Web Push certificate" key, for getToken()
    fcm_config: Optional[dict] = None        # Phase 33.0.1: the public Firebase web config, for initializeApp()


class PushTestResult(BaseModel):
    reached: int
    error: Optional[str] = None


class NotificationPreferencesUpdate(BaseModel):
    email_enabled: Optional[bool] = None
    sms_enabled: Optional[bool] = None
    reminders_enabled: Optional[bool] = None
    new_shift_alerts: Optional[str] = None
    manager_alerts_email: Optional[bool] = None
    push_enabled: Optional[bool] = None      # Phase 33
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
    certs: List[str] = []                    # Phase 32: cert keys that are verified and in date
    cert_attention: int = 0                  # Phase 32: certificates waiting for a check (not verified yet)


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
    dropped_at: Optional[datetime] = None    # Phase 29.4: dropped this event; Assign needs a reason, offers are skipped
    drop_reason: Optional[str] = None
    availability: str = "not_set"            # Phase 31: fits | outside | not_set
    time_off: Optional[str] = None           # Phase 32.1: 'blocked' (can't be assigned / offered)
    time_off_reason: Optional[str] = None    # Phase 32.1: the block's reason
    department_match: str = "not_set"        # Phase 32.2: match | outside | not_set
    missing_certs: List[str] = []            # Phase 32: labels (offers skip them; Assign asks first)
    unverified_certs: List[str] = []         # Phase 32: on file but no manager has checked them


class AssignRequest(BaseModel):
    worker_id: UUID
    reason: Optional[str] = Field(None, max_length=500)   # Phase 29.4: required to book back someone who dropped this event


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
    bio: Optional[str] = None                                     # Phase 32
    avatar_url: Optional[str] = None
    skills: List[str] = []                                        # "positions I work" from their profile
    departments: List[str] = []                                   # Phase 32.2: departments they picked
    emergency_contact_name: Optional[str] = None                  # only for people on the team / booked here
    emergency_contact_phone: Optional[str] = None
    certifications: List["CertificationItem"] = []
    availability: List["AvailabilityWindow"] = []                 # Phase 31
    time_off: List["TimeOffBlockItem"] = []                       # Phase 32.1: upcoming blocks (no private notes)


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
    app_version: str = ""                    # Phase 34.5: the server's version (backend/src/version.py)
    app_base_url: str = ""
    app_base_url_ok: bool = False
    email_provider: str = "console"
    email_from: str = ""
    email_ready: bool = False
    push_route: str = "webpush"              # Phase 33.0.1: fcm | webpush (what new devices use)
    push_firebase_missing: List[str] = []    # Phase 33.0.1: what Firebase messaging still needs
    push_firebase_error: Optional[str] = None
    push_devices: int = 0
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


# ------------------------------------------------------------------------------
# Phase 29.3: Event templates
# ------------------------------------------------------------------------------
class EventTemplatePosition(BaseModel):
    role_type: str
    capacity: int = 1
    hourly_rate: float
    hourly_rate_max: Optional[float] = None
    hide_rate: bool = False
    tips_eligible: bool = False
    tip_pool: bool = False
    role_notes: Optional[str] = None
    staff_notes: Optional[str] = None
    approval_mode: str = "venue_default"


class EventTemplateInput(BaseModel):
    name: str                                # what managers pick from ("Friday Jazz")
    title: str                               # the event name it fills in
    start_local: str                         # 'HH:MM' venue time
    end_local: str                           # 'HH:MM'; earlier than start = ends the next day
    notes: Optional[str] = None
    staff_notes: Optional[str] = None
    location_id: Optional[UUID] = None       # a saved venue location (None = venue address)
    geofence_mode: str = "venue_default"
    location_staff_notes: Optional[str] = None
    positions: List[EventTemplatePosition]


class EventTemplateResponse(BaseModel):
    id: UUID
    venue_id: UUID
    name: str
    title: str
    start_local: str
    end_local: str
    overnight: bool = False                  # end_local is on the next day
    notes: Optional[str] = None
    staff_notes: Optional[str] = None
    location: Optional[VenueLocationResponse] = None
    geofence_mode: str = "venue_default"
    location_staff_notes: Optional[str] = None
    positions: List[EventTemplatePosition]
    created_by_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class SaveAsTemplateRequest(BaseModel):
    name: str


# ------------------------------------------------------------------------------
# Phase 29.4: Drops
# ------------------------------------------------------------------------------
class DropShiftBody(BaseModel):
    reason: Optional[str] = Field(None, max_length=500)   # optional; managers see it


# ------------------------------------------------------------------------------
# Phase 30: Manager "Tonight" board
# ------------------------------------------------------------------------------
class TonightPerson(BaseModel):
    request_id: UUID
    worker_id: UUID
    first_name: str = ""
    last_name: str = ""
    phone: Optional[str] = None
    request_status: str                          # approved | confirmed | checked_in | completed | no_show
    clock_state: str                             # upcoming | due | late | in | done | missed | no_show
    clock_in_time: Optional[datetime] = None     # first clock-in
    clock_out_time: Optional[datetime] = None    # last clock-out (when done)
    late_minutes: int = 0                        # late: minutes past start right now; in/done: recorded lateness
    geo_flag: bool = False                       # clocked in outside the geofence
    manager_clock: bool = False                  # a manager entered the clock-in
    info_seen: Optional[bool] = None             # None = nothing to read
    previous_drop_at: Optional[datetime] = None  # Phase 29.4 re-booked after a drop


class TonightPosition(BaseModel):
    shift_id: UUID
    role_type: str
    capacity: int
    spots_filled: int
    open_spots: int
    pending_requests: int = 0
    pending_offers: int = 0
    people: List[TonightPerson] = []


class TonightEvent(BaseModel):
    event_key: str
    event_id: Optional[UUID] = None
    title: str
    start_time: datetime
    end_time: datetime
    location_name: Optional[str] = None
    state: str                                   # upcoming | live | ended
    clock_in_opens_at: datetime
    positions: List[TonightPosition] = []
    booked: int = 0
    clocked_in: int = 0
    done: int = 0
    late: int = 0
    missed: int = 0
    no_show: int = 0
    unread: int = 0
    open_spots: int = 0


class TonightAlert(BaseModel):
    kind: str                                    # late | missed | open_spot | unread | geo
    severity: str                                # high | medium | low
    text: str
    event_id: Optional[UUID] = None
    event_key: Optional[str] = None
    shift_id: Optional[UUID] = None
    request_id: Optional[UUID] = None
    worker_id: Optional[UUID] = None


class WeekEvent(BaseModel):
    event_key: str
    event_id: Optional[UUID] = None
    title: str
    start_time: datetime
    end_time: datetime
    status: str = "published"                    # draft | published
    capacity: int = 0
    filled: int = 0
    requested: int = 0
    open_spots: int = 0
    unread: int = 0


class WeekDay(BaseModel):
    date: str                                    # YYYY-MM-DD in the venue's time zone
    label: str                                   # Today | Tomorrow | Wed
    events: List[WeekEvent] = []
    capacity: int = 0
    filled: int = 0
    time_off: List[str] = []                     # Phase 32.1: team members with time off that day ("Sam Taylor (5:00 PM – 11:00 PM)")


class TonightResponse(BaseModel):
    venue_id: UUID
    timezone: str
    now: datetime
    date: str                                    # today's YYYY-MM-DD (venue time)
    events: List[TonightEvent] = []
    alerts: List[TonightAlert] = []
    counts: dict = {}
    week: List[WeekDay] = []


class NoShowResult(BaseModel):
    detail: str
    spot_reopened: bool = False


# ------------------------------------------------------------------------------
# Phase 31: Availability & time off
# ------------------------------------------------------------------------------
class AvailabilityWindow(BaseModel):
    weekday: int = Field(..., ge=0, le=6)            # 0 = Monday ... 6 = Sunday
    start_local: str                                 # 'HH:MM'
    end_local: str                                   # 'HH:MM' or '24:00'; earlier than start = runs past midnight


class AvailabilityUpdate(BaseModel):
    windows: List[AvailabilityWindow] = []           # [] = clear (no availability set)


class TimeOffBlockInput(BaseModel):
    """Phase 32.1: a block of time off the worker sets. No approval."""
    all_day: bool = True
    start_date: date
    end_date: Optional[date] = None              # one-off: last day (default = start_date). Repeating: until (None = no end)
    start_local: Optional[str] = None            # 'HH:MM' when all_day is False
    end_local: Optional[str] = None              # 'HH:MM' or '24:00'; at/before start = runs past midnight
    repeat: str = "none"                         # none | weekly | biweekly
    weekdays: List[int] = []                     # repeating: 0 = Monday ... 6 = Sunday (default: start_date's weekday)
    reason: Optional[str] = Field(None, max_length=200)          # managers see this
    private_note: Optional[str] = Field(None, max_length=500)    # only the worker sees this


class TimeOffBlockItem(BaseModel):
    id: UUID
    worker_id: UUID
    worker_name: Optional[str] = None
    all_day: bool = True
    start_date: date
    end_date: Optional[date] = None
    start_local: Optional[str] = None
    end_local: Optional[str] = None
    repeat: str = "none"
    weekdays: List[int] = []
    reason: Optional[str] = None
    private_note: Optional[str] = None           # only in the worker's own views
    summary: str = ""                            # "Every Tue & Thu, 5:00 PM – 11:00 PM"
    active: bool = True                          # False once it's over
    conflicts: List[str] = []                    # booked shifts inside the block (next 90 days)
    created_at: datetime


# ------------------------------------------------------------------------------
# Phase 32: Profile & certifications
# ------------------------------------------------------------------------------
class CertTypeInfo(BaseModel):
    key: str
    label: str
    hint: Optional[str] = None
    expires: bool = True


class CertificationItem(BaseModel):
    id: UUID
    cert_type: str
    label: str
    number: Optional[str] = None
    issued_on: Optional[date] = None
    expires_on: Optional[date] = None
    file_id: Optional[UUID] = None
    status: str                                      # unverified | verified | rejected
    verified_at: Optional[datetime] = None
    verified_by_name: Optional[str] = None
    verified_venue_name: Optional[str] = None
    review_note: Optional[str] = None
    expired: bool = False
    expiring_soon: bool = False                      # within 30 days


class CertificationUpsert(BaseModel):
    number: Optional[str] = Field(None, max_length=100)
    issued_on: Optional[date] = None
    expires_on: Optional[date] = None
    file_id: Optional[UUID] = None                   # from POST /api/me/files
    remove_file: bool = False


class CertReview(BaseModel):
    status: str                                      # verified | rejected
    note: Optional[str] = Field(None, max_length=500)


class FileUploadResult(BaseModel):
    id: UUID
    url: str
    content_type: str
    size_bytes: int


class MyProfile(BaseModel):
    id: UUID
    email: str
    role: str
    first_name: str = ""
    last_name: str = ""
    phone: Optional[str] = None
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
    skills: List[str] = []
    departments: List[str] = []                      # Phase 32.2
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    discoverable: str = "private"
    availability: List[AvailabilityWindow] = []
    time_off: List[TimeOffBlockItem] = []        # Phase 32.1
    certifications: List[CertificationItem] = []
    cert_types: List[CertTypeInfo] = []
    missing: List[str] = []                          # phone | photo | emergency_contact | availability | departments
    department_options: List["DepartmentInfo"] = []  # Phase 32.2: the catalogue


class DepartmentInfo(BaseModel):
    key: str
    label: str
    short: str
    examples: str


class MyProfileUpdate(BaseModel):
    first_name: Optional[str] = Field(None, max_length=100)
    last_name: Optional[str] = Field(None, max_length=100)
    phone: Optional[str] = Field(None, max_length=30)
    bio: Optional[str] = Field(None, max_length=600)
    skills: Optional[List[str]] = None
    departments: Optional[List[str]] = None          # Phase 32.2: foh | bar | kitchen | tech | security | ops
    emergency_contact_name: Optional[str] = Field(None, max_length=100)
    emergency_contact_phone: Optional[str] = Field(None, max_length=30)



# ------------------------------------------------------------------------------
# Phase 33.1: a worker's own hours & pay
# ------------------------------------------------------------------------------
class EarningsShift(BaseModel):
    entry_id: UUID
    shift_id: UUID
    request_id: Optional[UUID] = None
    event_title: str
    venue_id: UUID
    venue_name: str
    venue_timezone: str = "America/New_York"
    role_type: str
    clock_in_time: datetime
    clock_out_time: Optional[datetime] = None
    in_progress: bool = False                # still clocked in (counts 0 h until clock-out)
    hours: float = 0
    rate: float = 0
    rate_custom: bool = False                # the manager set this person's rate for the shift
    pay: float = 0                           # hours x rate, before tips and taxes
    tips_eligible: bool = False
    auto_closed: bool = False                # clocked out automatically
    edited: bool = False                     # a manager changed the times


class EarningsVenue(BaseModel):
    venue_id: UUID
    name: str
    hours: float = 0
    pay: float = 0
    shifts: int = 0


class EarningsUpcoming(BaseModel):
    shifts: int = 0                          # booked, not started, inside the period
    hours: float = 0
    est_pay: float = 0


class EarningsResponse(BaseModel):
    period: str                              # week | last_week | month | last_month | custom
    label: str                               # "This week"
    start_date: date
    end_date: date
    timezone: str
    total_hours: float = 0
    total_pay: float = 0
    shifts_worked: int = 0
    in_progress: int = 0
    any_tips: bool = False
    venues: List[EarningsVenue] = []
    shifts: List[EarningsShift] = []         # newest first
    upcoming: EarningsUpcoming = EarningsUpcoming()



# ------------------------------------------------------------------------------------------------
# Phase 34: cover requests + waitlists
# ------------------------------------------------------------------------------------------------
class CoverPostBody(BaseModel):
    request_id: UUID
    audience: str = "team"                   # team | public
    note: Optional[str] = Field(None, max_length=300)


class CoverListing(BaseModel):
    cover_id: UUID
    shift_id: UUID
    event_id: Optional[UUID] = None
    title: str
    role_type: str
    venue_id: UUID
    venue_name: str
    venue_timezone: str = "America/New_York"
    start_time: datetime
    end_time: datetime
    hours: float = 0
    hourly_rate: Optional[float] = None      # None = hidden
    hourly_rate_max: Optional[float] = None
    hide_rate: bool = False
    tips_eligible: bool = False
    from_first_name: str
    note: Optional[str] = None
    audience: str = "team"                   # what actually applies (public falls back to team if the venue turned it off)
    on_team: bool = False
    can_take: bool = False
    problem: Optional[str] = None            # why the viewer can't take it
    booking: str = "approval"                # instant | approval (for THIS viewer)
    take_note: Optional[str] = None          # e.g. "Your waiting request for Server at this event will be withdrawn."
    department_match: str = "not_set"
    created_at: datetime


class CoverMine(BaseModel):
    cover_id: UUID
    request_id: UUID
    shift_id: UUID
    status: str                              # open | pending_approval
    audience: str
    note: Optional[str] = None
    taker_first_name: Optional[str] = None
    created_at: datetime


class CoverPostResult(BaseModel):
    cover_id: UUID
    message: str


class CoverTakeResult(BaseModel):
    status: str                              # covered | pending_approval
    message: str
    request_id: Optional[UUID] = None        # the taker's booking when covered


class WaitlistJoinBody(BaseModel):
    shift_id: UUID
    auto_book: bool = True


class WaitlistMine(BaseModel):
    entry_id: UUID
    shift_id: UUID
    event_id: Optional[UUID] = None
    title: str
    role_type: str
    venue_name: str
    venue_timezone: str = "America/New_York"
    start_time: datetime
    end_time: datetime
    status: str                              # waiting | offered
    place: int = 1
    auto_book: bool = True
    offer_expires_at: Optional[datetime] = None


class WaitlistActionResult(BaseModel):
    status: str                              # waiting | booked | requested | passed | left
    message: str
    entry_id: Optional[UUID] = None
    request_id: Optional[UUID] = None


WorkerProfile.model_rebuild()
EventListing.model_rebuild()   # Phase 32.3: series is a list of EventListing
MyProfile.model_rebuild()
