from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List
from datetime import datetime
from uuid import UUID

# ------------------------------------------------------------------------------
# Auth Schemas
# ------------------------------------------------------------------------------
class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    first_name: str
    last_name: str
    phone: Optional[str] = None
    role: Optional[str] = "worker"
    skills: Optional[List[str]] = []

class FirebaseLoginRequest(BaseModel):
    firebase_token: str
    email: Optional[EmailStr] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserResponse"

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
    rating_average: float
    rating_count: int
    total_shifts_completed: int
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True

class UserUpdateProfile(BaseModel):
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
    rating_average: float

    class Config:
        from_attributes = True

# ------------------------------------------------------------------------------
# Venue Schemas
# ------------------------------------------------------------------------------
class VenueBase(BaseModel):
    name: str
    description: Optional[str] = None
    address: str
    latitude: float
    longitude: float
    geofence_radius_meters: int = 100
    logo_url: Optional[str] = None
    global_auto_approve_min_rating: Optional[float] = None

class VenueCreate(VenueBase):
    pass

class VenueUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    geofence_radius_meters: Optional[int] = None
    logo_url: Optional[str] = None
    global_auto_approve_min_rating: Optional[float] = None

class VenueResponse(VenueBase):
    id: UUID
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class VenueManagerAssign(BaseModel):
    user_id: UUID
    is_primary: bool = False

class WhitelistCreate(BaseModel):
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
class ShiftBase(BaseModel):
    venue_id: UUID
    title: str
    role_required: str
    start_time: datetime
    end_time: datetime
    hourly_rate: float
    spots_needed: int = 1
    auto_confirm_anyone: bool = False
    min_rating_override: Optional[float] = None
    description: Optional[str] = None
    dress_code: Optional[str] = None

class ShiftCreate(ShiftBase):
    pass

class ShiftUpdate(BaseModel):
    title: Optional[str] = None
    role_required: Optional[str] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    hourly_rate: Optional[float] = None
    spots_needed: Optional[int] = None
    auto_confirm_anyone: Optional[bool] = None
    min_rating_override: Optional[float] = None
    description: Optional[str] = None
    dress_code: Optional[str] = None
    status: Optional[str] = None

class ShiftResponse(ShiftBase):
    id: UUID
    spots_filled: int
    status: str
    created_by_user_id: Optional[UUID] = None
    created_at: datetime
    venue: Optional[VenueResponse] = None

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

    class Config:
        from_attributes = True

class CheckInRequest(BaseModel):
    latitude: float
    longitude: float

class CheckOutRequest(BaseModel):
    latitude: float
    longitude: float

# ------------------------------------------------------------------------------
# Rating Schemas
# ------------------------------------------------------------------------------
class RatingCreate(BaseModel):
    shift_request_id: UUID
    rating: int = Field(ge=1, le=5)
    review: Optional[str] = None

class RatingResponse(BaseModel):
    id: UUID
    shift_request_id: UUID
    venue_id: UUID
    worker_id: UUID
    rating: int
    review: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

# Avoid circular reference in Pydantic v2
TokenResponse.model_rebuild()
