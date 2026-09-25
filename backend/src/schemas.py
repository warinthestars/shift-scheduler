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
    password: str
    first_name: str
    last_name: str
    phone: Optional[str] = None
    role: str = "worker"
    venue_ids: Optional[List[UUID]] = []

class UserUpdateAdmin(BaseModel):
    role: Optional[str] = None
    is_active: Optional[bool] = None
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


class EventPosition(BaseModel):
    shift_id: UUID
    role_type: str
    hourly_rate: float
    tips_eligible: bool = False
    tip_pool: bool = False
    hourly_rate_max: Optional[float] = None
    hide_rate: bool = False
    role_notes: Optional[str] = None
    approval_mode: str = "venue_default"
    capacity: int
    spots_filled: int
    status: str
    assigned: List[RosterPerson] = []
    requested: List[RosterPerson] = []


class VenueEventResponse(BaseModel):
    event_key: str
    event_id: Optional[UUID] = None
    cancelled: bool = False
    cancel_reason: Optional[str] = None
    title: str
    start_time: datetime
    end_time: datetime
    description: Optional[str] = None
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
    approval_mode: str = "venue_default"     # venue_default | auto | manual


class EventCreate(BaseModel):
    venue_id: UUID
    title: str
    start_time: datetime
    end_time: datetime
    notes: Optional[str] = None
    positions: List[EventPositionInput]


class EventUpdate(BaseModel):
    title: str
    start_time: datetime
    end_time: datetime
    notes: Optional[str] = None
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
    approval_mode: str = "venue_default"
    status: str


class EventDetail(BaseModel):
    id: UUID
    venue_id: UUID
    title: str
    start_time: datetime
    end_time: datetime
    notes: Optional[str] = None
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


