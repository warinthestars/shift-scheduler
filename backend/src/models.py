import uuid
from enum import Enum
from datetime import datetime
from sqlalchemy import (
    Column, String, Text, Boolean, Integer, Float, Numeric,
    DateTime, ForeignKey, Enum as SQLEnum, ARRAY, CheckConstraint, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import UUID, DOUBLE_PRECISION
from sqlalchemy.orm import relationship
from src.database import Base

class UserRole(str, Enum):
    platform_admin = "platform_admin"
    venue_manager = "venue_manager"
    worker = "worker"

    # Backward compatibility aliases
    PLATFORM_ADMIN = "platform_admin"
    VENUE_MANAGER = "venue_manager"
    WORKER = "worker"

class RequestStatus(str, Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    CHECKED_IN = "CHECKED_IN"
    COMPLETED = "COMPLETED"
    DROPPED = "dropped"
    dropped = "dropped"


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=True)
    role = Column(String(50), nullable=False, default="worker", index=True)
    first_name = Column(String(100), nullable=False, default="")
    last_name = Column(String(100), nullable=False, default="")
    phone = Column(String(30), nullable=True)
    avatar_url = Column(Text, nullable=True)
    bio = Column(Text, nullable=True)
    skills = Column(ARRAY(String), default=list)
    aggregate_rating = Column(Float, nullable=False, default=5.00)
    rating_count = Column(Integer, nullable=False, default=0)
    total_shifts = Column(Integer, nullable=False, default=0)
    firebase_uid = Column(String(128), unique=True, nullable=True, index=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Aliases for Phase 2 compatibility
    @property
    def password_hash(self):
        return self.hashed_password

    @password_hash.setter
    def password_hash(self, val):
        self.hashed_password = val

    @property
    def venue_id(self):
        if self.managed_venues and len(self.managed_venues) > 0:
            return str(self.managed_venues[0].venue_id)
        return None

    @property
    def rating_average(self):
        return self.aggregate_rating

    @rating_average.setter
    def rating_average(self, val):
        self.aggregate_rating = float(val)

    @property
    def total_shifts_completed(self):
        return self.total_shifts

    @total_shifts_completed.setter
    def total_shifts_completed(self, val):
        self.total_shifts = int(val)

    # Relationships
    managed_venues = relationship("VenueManager", back_populates="user", cascade="all, delete-orphan")
    shift_requests = relationship("ShiftRequest", back_populates="worker", foreign_keys="ShiftRequest.worker_id")
    ratings_received = relationship("Rating", back_populates="worker", foreign_keys="Rating.worker_id")
    whitelist_entries = relationship("VenueWhitelist", back_populates="worker", cascade="all, delete-orphan")

class Venue(Base):
    __tablename__ = "venues"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    address = Column(Text, nullable=False)
    lat = Column(DOUBLE_PRECISION, nullable=False)
    lng = Column(DOUBLE_PRECISION, nullable=False)
    geofence_radius_meters = Column(Integer, nullable=False, default=100)
    auto_approve_rating_threshold = Column(Float, nullable=True, default=4.5)
    logo_url = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Aliases
    @property
    def latitude(self):
        return self.lat

    @latitude.setter
    def latitude(self, val):
        self.lat = float(val)

    @property
    def longitude(self):
        return self.lng

    @longitude.setter
    def longitude(self, val):
        self.lng = float(val)

    @property
    def global_auto_approve_min_rating(self):
        return self.auto_approve_rating_threshold

    @global_auto_approve_min_rating.setter
    def global_auto_approve_min_rating(self, val):
        self.auto_approve_rating_threshold = float(val) if val is not None else None

    # Relationships
    managers = relationship("VenueManager", back_populates="venue", cascade="all, delete-orphan")
    shifts = relationship("Shift", back_populates="venue", cascade="all, delete-orphan")
    whitelists = relationship("VenueWhitelist", back_populates="venue", cascade="all, delete-orphan")

class VenueManager(Base):
    __tablename__ = "venue_managers"

    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), primary_key=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    is_primary = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    # Relationships
    venue = relationship("Venue", back_populates="managers")
    user = relationship("User", back_populates="managed_venues")

class VenueWhitelist(Base):
    __tablename__ = "venue_whitelists"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False)
    worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (UniqueConstraint("venue_id", "worker_id", name="uq_venue_whitelist"),)

    venue = relationship("Venue", back_populates="whitelists")
    worker = relationship("User", back_populates="whitelist_entries")

class Shift(Base):
    __tablename__ = "shifts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    title = Column(String(255), nullable=False)
    role_type = Column(String(100), nullable=False, index=True)
    start_time = Column(DateTime(timezone=True), nullable=False, index=True)
    end_time = Column(DateTime(timezone=True), nullable=False)
    hourly_rate = Column(Numeric(10, 2), nullable=False, default=25.00)
    capacity = Column(Integer, nullable=False, default=1)
    spots_filled = Column(Integer, nullable=False, default=0)
    is_shift_auto_confirm = Column(Boolean, nullable=False, default=False)
    description = Column(Text, nullable=True)
    status = Column(String(50), nullable=False, default="OPEN", index=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Aliases
    @property
    def role_required(self):
        return self.role_type

    @role_required.setter
    def role_required(self, val):
        self.role_type = val

    @property
    def spots_needed(self):
        return self.capacity

    @spots_needed.setter
    def spots_needed(self, val):
        self.capacity = int(val)

    @property
    def auto_confirm_anyone(self):
        return self.is_shift_auto_confirm

    @auto_confirm_anyone.setter
    def auto_confirm_anyone(self, val):
        self.is_shift_auto_confirm = bool(val)

    @property
    def available_spots(self):
        return max(0, self.capacity - self.spots_filled)

    @available_spots.setter
    def available_spots(self, val):
        self.spots_filled = max(0, self.capacity - int(val))


    venue = relationship("Venue", back_populates="shifts")
    requests = relationship("ShiftRequest", back_populates="shift", cascade="all, delete-orphan")

class ShiftRequest(Base):
    __tablename__ = "shift_requests"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    shift_id = Column(UUID(as_uuid=True), ForeignKey("shifts.id", ondelete="CASCADE"), nullable=False, index=True)
    worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(
        SQLEnum(RequestStatus, name="request_status", native_enum=False, values_callable=lambda obj: [e.value for e in obj]),
        nullable=False,
        default=RequestStatus.PENDING,
        index=True
    )
    approval_source = Column(String(50), nullable=True)
    approved_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)

    check_in_time = Column(DateTime(timezone=True), nullable=True)
    check_in_verified = Column(Boolean, nullable=False, default=False)
    check_out_time = Column(DateTime(timezone=True), nullable=True)
    check_out_verified = Column(Boolean, nullable=False, default=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (UniqueConstraint("shift_id", "worker_id", name="uq_shift_worker"),)

    shift = relationship("Shift", back_populates="requests")
    worker = relationship("User", back_populates="shift_requests", foreign_keys=[worker_id])
    rating = relationship("Rating", back_populates="shift_request", uselist=False, cascade="all, delete-orphan")

class Rating(Base):
    __tablename__ = "ratings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    shift_request_id = Column(UUID(as_uuid=True), ForeignKey("shift_requests.id", ondelete="CASCADE"), unique=True, nullable=False)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False, index=True)
    worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    rated_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    rating = Column(Integer, CheckConstraint("rating >= 1 AND rating <= 5"), nullable=False)
    review = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    shift_request = relationship("ShiftRequest", back_populates="rating")
    venue = relationship("Venue")
    worker = relationship("User", back_populates="ratings_received", foreign_keys=[worker_id])

class TimeEntry(Base):
    __tablename__ = "time_entries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    shift_id = Column(UUID(as_uuid=True), ForeignKey("shifts.id", ondelete="CASCADE"), nullable=False, index=True)
    clock_in_time = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    clock_out_time = Column(DateTime(timezone=True), nullable=True)

    worker = relationship("User", foreign_keys=[worker_id])
    shift = relationship("Shift", foreign_keys=[shift_id])

class ShiftTransfer(Base):
    __tablename__ = "shift_transfers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    shift_id = Column(UUID(as_uuid=True), ForeignKey("shifts.id", ondelete="CASCADE"), nullable=False, index=True)
    from_worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    to_worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(50), nullable=False, default="pending_worker_acceptance", index=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    shift = relationship("Shift", foreign_keys=[shift_id])
    from_worker = relationship("User", foreign_keys=[from_worker_id])
    to_worker = relationship("User", foreign_keys=[to_worker_id])

class ShiftBoardMessage(Base):
    __tablename__ = "shift_board_messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    shift_id = Column(UUID(as_uuid=True), ForeignKey("shifts.id", ondelete="CASCADE"), nullable=False, index=True)
    author_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    shift = relationship("Shift", foreign_keys=[shift_id])
    author = relationship("User", foreign_keys=[author_id])

