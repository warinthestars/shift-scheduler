import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Text, Boolean, Integer, Numeric,
    DateTime, ForeignKey, Enum as SQLEnum, ARRAY, CheckConstraint, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import UUID, DOUBLE_PRECISION
from sqlalchemy.orm import relationship
from src.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    firebase_uid = Column(String(128), unique=True, nullable=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=True)
    role = Column(
        SQLEnum("platform_admin", "venue_manager", "worker", name="user_role"),
        nullable=False,
        default="worker",
        index=True
    )
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    phone = Column(String(30), nullable=True)
    avatar_url = Column(Text, nullable=True)
    bio = Column(Text, nullable=True)
    skills = Column(ARRAY(String), default=list)
    rating_average = Column(Numeric(3, 2), nullable=False, default=5.00)
    rating_count = Column(Integer, nullable=False, default=0)
    total_shifts_completed = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

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
    latitude = Column(DOUBLE_PRECISION, nullable=False)
    longitude = Column(DOUBLE_PRECISION, nullable=False)
    geofence_radius_meters = Column(Integer, nullable=False, default=100)
    logo_url = Column(Text, nullable=True)
    global_auto_approve_min_rating = Column(Numeric(3, 2), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

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
    role_required = Column(String(100), nullable=False, index=True)
    start_time = Column(DateTime(timezone=True), nullable=False, index=True)
    end_time = Column(DateTime(timezone=True), nullable=False)
    hourly_rate = Column(Numeric(10, 2), nullable=False)
    spots_needed = Column(Integer, nullable=False, default=1)
    spots_filled = Column(Integer, nullable=False, default=0)
    auto_confirm_anyone = Column(Boolean, nullable=False, default=False)
    min_rating_override = Column(Numeric(3, 2), nullable=True)
    description = Column(Text, nullable=True)
    dress_code = Column(Text, nullable=True)
    status = Column(
        SQLEnum("open", "filled", "in_progress", "completed", "cancelled", name="shift_status"),
        nullable=False,
        default="open",
        index=True
    )
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    venue = relationship("Venue", back_populates="shifts")
    requests = relationship("ShiftRequest", back_populates="shift", cascade="all, delete-orphan")

class ShiftRequest(Base):
    __tablename__ = "shift_requests"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    shift_id = Column(UUID(as_uuid=True), ForeignKey("shifts.id", ondelete="CASCADE"), nullable=False, index=True)
    worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(
        SQLEnum("pending", "approved", "rejected", "cancelled", "completed", name="request_status"),
        nullable=False,
        default="pending",
        index=True
    )
    approval_source = Column(
        SQLEnum("shift_auto_confirm", "venue_whitelist", "rating_threshold", "manager_manual", name="approval_source"),
        nullable=True
    )
    approved_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)

    # Check-in/out tracking
    check_in_time = Column(DateTime(timezone=True), nullable=True)
    check_in_lat = Column(DOUBLE_PRECISION, nullable=True)
    check_in_lng = Column(DOUBLE_PRECISION, nullable=True)
    check_in_verified = Column(Boolean, nullable=False, default=False)
    check_out_time = Column(DateTime(timezone=True), nullable=True)
    check_out_lat = Column(DOUBLE_PRECISION, nullable=True)
    check_out_lng = Column(DOUBLE_PRECISION, nullable=True)
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

class ShiftSwap(Base):
    __tablename__ = "shift_swaps"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    shift_request_id = Column(UUID(as_uuid=True), ForeignKey("shift_requests.id", ondelete="CASCADE"), nullable=False, index=True)
    proposing_worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    receiving_worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    status = Column(
        SQLEnum("pending", "approved", "rejected", "cancelled", name="swap_status"),
        nullable=False,
        default="pending",
        index=True
    )
    manager_approval_required = Column(Boolean, nullable=False, default=True)
    approved_by_manager_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
