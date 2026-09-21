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
    aggregate_rating: float
    rating_count: int
    total_shifts: int
    is_active: bool
    created_at: datetime

    # For UI compatibility
    @property
    def rating_average(self) -> float:
        return self.aggregate_rating

    @property
    def total_shifts_completed(self) -> int:
        return self.total_shifts

    class Config:
        from_attributes = True

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
    auto_approve_rating_threshold: Optional[float] = 4.5
    description: Optional[str] = None
    logo_url: Optional[str] = None

class VenueCreate(BaseModel):
    name: str
    address: str
    lat: Optional[float] = 40.7128
    lng: Optional[float] = -74.0060
    geofence_radius_meters: Optional[int] = 100
    auto_approve_rating_threshold: Optional[float] = 4.5
    description: Optional[str] = None
    logo_url: Optional[str] = None
    manager_email: Optional[EmailStr] = None
    initial_manager_email: Optional[EmailStr] = None

class VenueUpdateSettings(BaseModel):
    auto_approve_rating_threshold: Optional[float] = None
    geofence_radius_meters: Optional[int] = None
    name: Optional[str] = None
    address: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    description: Optional[str] = None

class VenueResponse(VenueBase):
    id: UUID
    created_at: datetime
    updated_at: datetime

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

class ShiftCreate(BaseModel):
    venue_id: UUID
    title: str
    role_type: Optional[str] = "Worker"
    start_time: datetime
    end_time: datetime
    capacity: Optional[int] = 1
    is_shift_auto_confirm: Optional[bool] = False
    hourly_rate: Optional[float] = 25.00
    description: Optional[str] = None
    role_requirements: Optional[List[RoleRequirement]] = None

class ShiftResponse(BaseModel):
    id: UUID
    venue_id: UUID
    title: str
    role_type: str
    start_time: datetime
    end_time: datetime
    capacity: int
    spots_filled: int
    is_shift_auto_confirm: bool
    hourly_rate: float
    description: Optional[str] = None
    status: str
    created_at: datetime
    venue: Optional[VenueResponse] = None

    # Aliases
    @property
    def role_required(self) -> str:
        return self.role_type

    @property
    def spots_needed(self) -> int:
        return self.capacity

    @property
    def auto_confirm_anyone(self) -> bool:
        return self.is_shift_auto_confirm

    class Config:
        from_attributes = True

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
    shift: Optional[ShiftResponse] = None
    worker: Optional[UserBrief] = None

    class Config:
        from_attributes = True

class ShiftRequestStatusUpdate(BaseModel):
    status: str = Field(description="Must be APPROVED or REJECTED")

class CheckInRequest(BaseModel):
    latitude: float
    longitude: float

class CheckOutRequest(BaseModel):
    latitude: float
    longitude: float

TokenResponse.model_rebuild()
