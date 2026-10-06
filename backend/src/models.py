import uuid
from enum import Enum
from datetime import datetime
from sqlalchemy import (
    Column, String, Text, Boolean, Integer, Float, Numeric,
    DateTime, ForeignKey, ARRAY, CheckConstraint, UniqueConstraint,   # Phase 34.5: no SQLAlchemy Enum (no native PG ENUMs)
    Date, SmallInteger, LargeBinary, Index,                           # Phase 35: Index
)
from sqlalchemy.dialects.postgresql import UUID, DOUBLE_PRECISION, JSONB
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
    pending_manager_approval = "pending_manager_approval"
    approved = "approved"
    confirmed = "confirmed"

class ShiftStatus(str, Enum):
    OPEN = "OPEN"
    FILLED = "FILLED"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    open = "open"
    filled = "filled"
    completed = "completed"
    cancelled = "cancelled"


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
    discoverable = Column(String(20), nullable=False, default="private")   # Phase 29.1: private | venues | everyone
    emergency_contact_name = Column(String(100), nullable=True)            # Phase 32
    emergency_contact_phone = Column(String(30), nullable=True)            # Phase 32
    departments = Column(ARRAY(String), nullable=False, default=list)     # Phase 32.2: departments they work
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
    whitelist_entries = relationship("VenueWhitelist", back_populates="worker", cascade="all, delete-orphan", foreign_keys="VenueWhitelist.worker_id")

class OrgRole(str, Enum):
    """Phase 36: roles inside an organization. Stored as VARCHAR; checked here (no native PG ENUM)."""
    owner = "owner"


class Organization(Base):
    """Phase 36: a group of venues with one or more owners. An owner manages every venue in it."""
    __tablename__ = "organizations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class OrganizationMember(Base):
    """Phase 36: who owns an organization. services/organizations.py keeps venue_managers in step."""
    __tablename__ = "organization_members"

    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    role = Column(String(20), nullable=False, default="owner")               # OrgRole
    venue_alerts = Column(Boolean, nullable=False, default=False)            # also send this owner each venue's manager alerts
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)


class Venue(Base):
    __tablename__ = "venues"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    address = Column(Text, nullable=False)
    lat = Column(DOUBLE_PRECISION, nullable=False)
    lng = Column(DOUBLE_PRECISION, nullable=False)
    geofence_radius_meters = Column(Integer, nullable=False, default=100)
    auto_approve_rating_threshold = Column(Float, nullable=True, default=None)
    logo_url = Column(Text, nullable=True)
    timezone = Column(String(64), nullable=False, default="America/New_York")
    phone = Column(String(30), nullable=True)
    website_url = Column(String(500), nullable=True)                           # Phase 34.6: public profile link
    arrival_instructions = Column(Text, nullable=True)
    dress_code = Column(Text, nullable=True)
    default_shift_notes = Column(Text, nullable=True)
    approval_policy = Column(String(20), nullable=False, default="team_auto")
    show_rates_publicly = Column(Boolean, nullable=False, default=True)
    geofence_enabled = Column(Boolean, nullable=False, default=False)          # Phase 27: opt-in
    geofence_buffer_meters = Column(Integer, nullable=False, default=150)      # Phase 27: flagged, not blocked
    clock_in_early_minutes = Column(Integer, nullable=False, default=30)       # Phase 27
    auto_clock_out_hours = Column(Integer, nullable=False, default=2)          # Phase 27
    allow_public_cover = Column(Boolean, nullable=False, default=True)         # Phase 34
    team_time_tracking = Column(String(20), nullable=False, default="shiftboard")   # Phase 35: shiftboard | payroll
    ot_weekly_hours = Column(Numeric(5, 2), nullable=True, default=40)             # Phase 35: None = off
    ot_daily_hours = Column(Numeric(5, 2), nullable=True)                          # Phase 35: None = off
    work_week_start = Column(SmallInteger, nullable=False, default=0)              # Phase 35: 0 = Monday
    pay_period = Column(String(20), nullable=False, default="weekly")              # Phase 35
    pay_period_anchor = Column(Date, nullable=True)                                # Phase 35: biweekly
    pay_period_approval = Column(Boolean, nullable=False, default=True)            # Phase 35
    tips_enabled = Column(Boolean, nullable=False, default=True)                   # Phase 35.2
    tip_pool_split = Column(String(20), nullable=False, default="hours")           # Phase 35.2: hours | equal
    tip_pool_payroll = Column(Boolean, nullable=False, default=True)               # Phase 35.2
    tips_shown_to_workers = Column(Boolean, nullable=False, default=True)          # Phase 35.2
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True, index=True)  # Phase 36
    public_board = Column(Boolean, nullable=False, default=True)                   # Phase 36: listed on the public event board
    city = Column(String(120), nullable=True)                                      # Phase 36: shown on the public board (never the address)
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
    positions = relationship("VenuePosition", back_populates="venue", cascade="all, delete-orphan")
    locations = relationship("VenueLocation", back_populates="venue", cascade="all, delete-orphan")

class VenueManager(Base):
    __tablename__ = "venue_managers"

    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), primary_key=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    is_primary = Column(Boolean, nullable=False, default=False)
    via_org = Column(Boolean, nullable=False, default=False)                 # Phase 36: row exists because they own the venue's organization
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    # Relationships
    venue = relationship("Venue", back_populates="managers")
    user = relationship("User", back_populates="managed_venues")

class VenueWhitelist(Base):
    __tablename__ = "venue_whitelists"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False)
    worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    notes = Column(Text, nullable=True)                                      # Phase 29: private manager notes
    is_active = Column(Boolean, nullable=False, default=True)                # TRUE only when status == 'active'
    status = Column(String(20), nullable=False, default="active")            # Phase 29: active | removed | blocked
    positions = Column(ARRAY(String), nullable=False, default=list)          # Phase 29
    source = Column(String(20), nullable=False, default="manager")           # Phase 29: manager | invite | import | admin
    time_tracking = Column(String(20), nullable=True)                        # Phase 35: payroll | shiftboard | None = venue setting
    works_through = Column(String(120), nullable=True)                       # Phase 35: staffing company / agency
    is_lead = Column(Boolean, nullable=False, default=False)                 # Phase 36: shift lead at this venue (runs the floor, never sees pay)
    added_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (UniqueConstraint("venue_id", "worker_id", name="uq_venue_whitelist"),)

    venue = relationship("Venue", back_populates="whitelists")
    worker = relationship("User", back_populates="whitelist_entries", foreign_keys=[worker_id])

class VenuePosition(Base):
    __tablename__ = "venue_positions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    default_rate = Column(Numeric(10, 2), nullable=False, default=25.00)
    default_rate_max = Column(Numeric(10, 2), nullable=True)
    hide_rate = Column(Boolean, nullable=False, default=False)
    tips_eligible = Column(Boolean, nullable=False, default=False)
    tip_pool = Column(Boolean, nullable=False, default=False)
    sort_order = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    required_certs = Column(ARRAY(String), nullable=False, default=list)   # Phase 32: cert type keys
    department = Column(String(20), nullable=False, default="general")    # Phase 32.2: services/departments.py
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("venue_id", "name", name="uq_venue_position_name"),
        CheckConstraint("tip_pool = FALSE OR tips_eligible = TRUE", name="chk_position_tip_pool"),
        CheckConstraint("default_rate > 0", name="chk_position_rate"),
        CheckConstraint("default_rate_max IS NULL OR default_rate_max >= default_rate", name="chk_position_rate_range"),
    )

    venue = relationship("Venue", back_populates="positions")

class VenueLocation(Base):
    """Phase 27: a saved place a venue works at (client site, off-site event, second room)."""
    __tablename__ = "venue_locations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    address = Column(Text, nullable=False)
    lat = Column(DOUBLE_PRECISION, nullable=True)
    lng = Column(DOUBLE_PRECISION, nullable=True)
    radius_meters = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)
    is_archived = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (UniqueConstraint("venue_id", "name", name="uq_venue_location_name"),)

    venue = relationship("Venue", back_populates="locations")

class ShiftEvent(Base):
    __tablename__ = "shift_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    title = Column(String(255), nullable=False)
    start_time = Column(DateTime(timezone=True), nullable=False, index=True)
    end_time = Column(DateTime(timezone=True), nullable=False)
    notes = Column(Text, nullable=True)
    staff_notes = Column(Text, nullable=True)                              # Phase 26.2: booked staff only
    info_updated_at = Column(DateTime(timezone=True), nullable=True)       # Phase 26.2: last time/notes change
    info_change = Column(Text, nullable=True)                              # Phase 26.2: "Time changed: …"
    location_id = Column(UUID(as_uuid=True), ForeignKey("venue_locations.id", ondelete="SET NULL"), nullable=True)  # Phase 27
    geofence_mode = Column(String(20), nullable=False, default="venue_default")  # Phase 27: venue_default | on | off
    location_staff_notes = Column(Text, nullable=True)                     # Phase 27: event-specific, booked staff only
    cancelled_at = Column(DateTime(timezone=True), nullable=True)
    cancel_reason = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="published")      # Phase 29.3: draft | published
    published_at = Column(DateTime(timezone=True), nullable=True)          # Phase 29.3
    series_id = Column(UUID(as_uuid=True), nullable=True, index=True)      # Phase 32.3: shared by an event and its "Copy to dates" copies
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    shifts = relationship("Shift", back_populates="event", cascade="all, delete-orphan")


class EventTemplate(Base):
    """Phase 29.3: A venue's reusable event setup. Times are venue-local 'HH:MM' (end earlier = next day)."""
    __tablename__ = "event_templates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(120), nullable=False)
    title = Column(String(255), nullable=False)
    start_local = Column(String(5), nullable=False)
    end_local = Column(String(5), nullable=False)
    notes = Column(Text, nullable=True)
    staff_notes = Column(Text, nullable=True)
    location_id = Column(UUID(as_uuid=True), ForeignKey("venue_locations.id", ondelete="SET NULL"), nullable=True)
    geofence_mode = Column(String(20), nullable=False, default="venue_default")
    location_staff_notes = Column(Text, nullable=True)
    positions = Column(JSONB, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

class Shift(Base):
    __tablename__ = "shifts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False, index=True)
    event_id = Column(UUID(as_uuid=True), ForeignKey("shift_events.id", ondelete="CASCADE"), nullable=True, index=True)
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    title = Column(String(255), nullable=False)
    role_type = Column(String(100), nullable=False, index=True)
    start_time = Column(DateTime(timezone=True), nullable=False, index=True)
    end_time = Column(DateTime(timezone=True), nullable=False)
    hourly_rate = Column(Numeric(10, 2), nullable=False, default=25.00)
    hourly_rate_max = Column(Numeric(10, 2), nullable=True)
    hide_rate = Column(Boolean, nullable=False, default=False)
    approval_mode = Column(String(20), nullable=False, default="venue_default")
    cancelled_at = Column(DateTime(timezone=True), nullable=True)
    cancel_reason = Column(Text, nullable=True)
    tips_eligible = Column(Boolean, nullable=False, default=False)
    tip_pool = Column(Boolean, nullable=False, default=False)
    capacity = Column(Integer, nullable=False, default=1)
    spots_filled = Column(Integer, nullable=False, default=0)
    is_shift_auto_confirm = Column(Boolean, nullable=False, default=False)
    description = Column(Text, nullable=True)
    staff_notes = Column(Text, nullable=True)                              # Phase 26.2: booked staff only
    info_updated_at = Column(DateTime(timezone=True), nullable=True)       # Phase 26.2
    info_change = Column(Text, nullable=True)                              # Phase 26.2
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
        cap = self.capacity if self.capacity is not None else 1
        filled = self.spots_filled if self.spots_filled is not None else 0
        return max(0, cap - filled)

    @available_spots.setter
    def available_spots(self, val):
        new_val = int(val) if val is not None else 0
        if self.capacity is None:
            self.capacity = new_val
            self.spots_filled = 0
        else:
            self.spots_filled = max(0, self.capacity - new_val)


    venue = relationship("Venue", back_populates="shifts")
    event = relationship("ShiftEvent", back_populates="shifts")
    requests = relationship("ShiftRequest", back_populates="shift", cascade="all, delete-orphan")

class ShiftRequest(Base):
    __tablename__ = "shift_requests"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    shift_id = Column(UUID(as_uuid=True), ForeignKey("shifts.id", ondelete="CASCADE"), nullable=False, index=True)
    worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(50), nullable=False, default="pending", index=True)
    approval_source = Column(String(50), nullable=True)
    approved_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)

    check_in_time = Column(DateTime(timezone=True), nullable=True)
    check_in_verified = Column(Boolean, nullable=False, default=False)
    check_out_time = Column(DateTime(timezone=True), nullable=True)
    check_out_verified = Column(Boolean, nullable=False, default=False)
    notes = Column(Text, nullable=True)
    dropped_at = Column(DateTime(timezone=True), nullable=True)
    status_reason = Column(Text, nullable=True)
    previous_drop_at = Column(DateTime(timezone=True), nullable=True)   # Phase 29.4: rebooked / asking back after a drop
    rebook_reason = Column(Text, nullable=True)                         # Phase 29.4
    outside_department = Column(Boolean, nullable=False, default=False)  # Phase 32.2: outside their departments (needs a manager)
    pay_rate = Column(Numeric(10, 2), nullable=True)
    info_seen_at = Column(DateTime(timezone=True), nullable=True)          # Phase 26.2: worker read the shift info
    time_tracking = Column(String(20), nullable=True)                       # Phase 35: written when the shift starts
    tip_amount = Column(Numeric(10, 2), nullable=True)                      # Phase 35.2: own tips (NULL = none)
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
    would_book_again = Column(Boolean, nullable=True)                        # Phase 29
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

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
    # Phase 27: where the clock happened and what the geofence said
    clock_in_lat = Column(DOUBLE_PRECISION, nullable=True)
    clock_in_lng = Column(DOUBLE_PRECISION, nullable=True)
    clock_in_distance_m = Column(Integer, nullable=True)
    clock_in_geo_status = Column(String(20), nullable=False, default="not_checked")  # on_site | outside_geofence | not_checked | manager
    clock_out_lat = Column(DOUBLE_PRECISION, nullable=True)
    clock_out_lng = Column(DOUBLE_PRECISION, nullable=True)
    clock_out_distance_m = Column(Integer, nullable=True)
    clock_out_geo_status = Column(String(20), nullable=True)                         # same values + auto
    auto_closed = Column(Boolean, nullable=False, default=False)

    worker = relationship("User", foreign_keys=[worker_id])
    shift = relationship("Shift", foreign_keys=[shift_id])

class TimeEntryEdit(Base):
    __tablename__ = "time_entry_edits"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    shift_request_id = Column(UUID(as_uuid=True), ForeignKey("shift_requests.id", ondelete="CASCADE"), nullable=True, index=True)
    time_entry_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    editor_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(30), nullable=False)
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

class Notification(Base):
    """Phase 28: one message for one user (shown in the bell; may also go out by email / SMS)."""
    __tablename__ = "notifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = Column(String(40), nullable=False)
    title = Column(String(200), nullable=False)
    body = Column(Text, nullable=True)
    link = Column(String(300), nullable=True)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=True)
    event_id = Column(UUID(as_uuid=True), ForeignKey("shift_events.id", ondelete="CASCADE"), nullable=True)
    request_id = Column(UUID(as_uuid=True), ForeignKey("shift_requests.id", ondelete="CASCADE"), nullable=True)
    urgent = Column(Boolean, nullable=False, default=False)
    dedupe_key = Column(String(200), nullable=True, unique=True)
    read_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

class NotificationDelivery(Base):
    """Phase 28: outbox row for one channel (email / sms) of one notification."""
    __tablename__ = "notification_deliveries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    notification_id = Column(UUID(as_uuid=True), ForeignKey("notifications.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    channel = Column(String(10), nullable=False)                     # email | sms | push (Phase 33)
    status = Column(String(12), nullable=False, default="pending")   # pending | sent | failed | skipped
    digest = Column(Boolean, nullable=False, default=False)
    send_after = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    attempts = Column(Integer, nullable=False, default=0)
    last_error = Column(Text, nullable=True)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

class NotificationPreference(Base):
    """Phase 28: what a user wants sent where. No row = defaults."""
    __tablename__ = "notification_preferences"

    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    email_enabled = Column(Boolean, nullable=False, default=True)
    sms_enabled = Column(Boolean, nullable=False, default=False)
    reminders_enabled = Column(Boolean, nullable=False, default=True)
    new_shift_alerts = Column(String(10), nullable=False, default="daily")   # off | instant | daily
    manager_alerts_email = Column(Boolean, nullable=False, default=True)
    push_enabled = Column(Boolean, nullable=False, default=True)             # Phase 33: phone / browser notifications
    quiet_start = Column(SmallInteger, nullable=True)                        # hour 0-23 (Phase 34.5: SMALLINT, as in init.sql)
    quiet_end = Column(SmallInteger, nullable=True)
    timezone = Column(String(64), nullable=False, default="America/New_York")
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

class VenueInvite(Base):
    """Phase 29: an invite to join a venue's team. kind 'link' = the shareable link / QR code; 'personal' = one person."""
    __tablename__ = "venue_invites"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False, index=True)
    token = Column(String(64), nullable=False, unique=True)
    kind = Column(String(20), nullable=False, default="personal")          # link | personal
    email = Column(String(255), nullable=True)
    phone = Column(String(30), nullable=True)
    first_name = Column(String(100), nullable=True)
    last_name = Column(String(100), nullable=True)
    positions = Column(ARRAY(String), nullable=False, default=list)
    created_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    uses = Column(Integer, nullable=False, default=0)
    accepted_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    accepted_at = Column(DateTime(timezone=True), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    last_sent_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

class ShiftOffer(Base):
    """Phase 29: a manager offers a position to 1-5 people; the first to accept is booked."""
    __tablename__ = "shift_offers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    shift_id = Column(UUID(as_uuid=True), ForeignKey("shifts.id", ondelete="CASCADE"), nullable=False, index=True)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False)
    worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    batch_id = Column(UUID(as_uuid=True), nullable=False)
    offered_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    status = Column(String(20), nullable=False, default="pending")          # pending | accepted | declined | filled | cancelled
    message = Column(Text, nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    responded_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

class AdminAudit(Base):
    """Phase 29.2: one platform-admin action (user / venue / system)."""
    __tablename__ = "admin_audit"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(40), nullable=False)
    target_type = Column(String(20), nullable=False)          # user | venue | system
    target_id = Column(UUID(as_uuid=True), nullable=True)      # no FK: the target may be deleted
    summary = Column(String(400), nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

class VenueActivity(Base):
    """Phase 29.1: one line in a venue's activity log."""
    __tablename__ = "venue_activity"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False, index=True)
    actor_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    kind = Column(String(40), nullable=False)
    category = Column(String(20), nullable=False)
    summary = Column(String(400), nullable=False)
    event_id = Column(UUID(as_uuid=True), ForeignKey("shift_events.id", ondelete="SET NULL"), nullable=True)
    request_id = Column(UUID(as_uuid=True), ForeignKey("shift_requests.id", ondelete="SET NULL"), nullable=True)
    worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

class ShiftTransfer(Base):
    __tablename__ = "shift_transfers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    shift_id = Column(UUID(as_uuid=True), ForeignKey("shifts.id", ondelete="CASCADE"), nullable=False, index=True)
    from_worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    to_worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(50), nullable=False, default="pending_worker_acceptance", index=True)
    notes = Column(Text, nullable=True)
    cover_request_id = Column(UUID(as_uuid=True), nullable=True)                # Phase 34: came from a cover post
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


# ------------------------------------------------------------------------------
# Phase 31: Availability  /  Phase 32.1: time off blocks
# ------------------------------------------------------------------------------
class WorkerAvailability(Base):
    """One weekly window. A worker with no rows hasn't set availability (treated as open)."""
    __tablename__ = "worker_availability"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    weekday = Column(SmallInteger, nullable=False)          # 0 = Monday ... 6 = Sunday
    start_local = Column(String(5), nullable=False)         # 'HH:MM'
    end_local = Column(String(5), nullable=False)           # 'HH:MM' or '24:00'; earlier than start = next day
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (CheckConstraint("weekday BETWEEN 0 AND 6", name="chk_availability_weekday"),)


class TimeOffBlock(Base):
    """Phase 32.1: time the worker has blocked off. No approval; managers can't book over it."""
    __tablename__ = "time_off_blocks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    all_day = Column(Boolean, nullable=False, default=True)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=True)                  # inclusive; None = repeats with no end
    start_local = Column(String(5), nullable=True)          # 'HH:MM' when not all day
    end_local = Column(String(5), nullable=True)            # 'HH:MM' or '24:00'
    repeat = Column(String(20), nullable=False, default="none")          # none | weekly | biweekly
    weekdays = Column(ARRAY(SmallInteger), nullable=False, default=list)  # 0 = Monday ... 6 = Sunday
    reason = Column(String(200), nullable=True)             # managers see this
    private_note = Column(Text, nullable=True)              # only the worker sees this
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (CheckConstraint("end_date IS NULL OR end_date >= start_date", name="chk_time_off_block_range"),)


# ------------------------------------------------------------------------------
# Phase 32: Profile files & certifications
# ------------------------------------------------------------------------------
class UserFile(Base):
    """Small uploads kept in the database (profile photos, certificate scans)."""
    __tablename__ = "user_files"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = Column(String(20), nullable=False)               # avatar | certificate
    filename = Column(String(255), nullable=True)
    content_type = Column(String(100), nullable=False)
    size_bytes = Column(Integer, nullable=False)
    data = Column(LargeBinary, nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)


class WorkerCertification(Base):
    __tablename__ = "worker_certifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    cert_type = Column(String(50), nullable=False)          # keys in services/certs.py CERT_TYPES
    number = Column(String(100), nullable=True)
    issued_on = Column(Date, nullable=True)
    expires_on = Column(Date, nullable=True)
    file_id = Column(UUID(as_uuid=True), ForeignKey("user_files.id", ondelete="SET NULL"), nullable=True)
    status = Column(String(20), nullable=False, default="unverified")   # unverified | verified | rejected
    verified_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    verified_venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="SET NULL"), nullable=True)
    verified_at = Column(DateTime(timezone=True), nullable=True)
    review_note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (UniqueConstraint("worker_id", "cert_type", name="uq_worker_cert"),)


class PushSubscription(Base):
    """Phase 33: one browser / installed app that turned on notifications (Web Push)."""
    __tablename__ = "push_subscriptions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    endpoint = Column(Text, nullable=False, unique=True)                # Web Push URL, or the Firebase token (Phase 33.0.1)
    p256dh = Column(String(200), nullable=True)                         # Web Push only
    auth = Column(String(100), nullable=True)                           # Web Push only
    provider = Column(String(10), nullable=False, default="webpush")    # Phase 33.0.1: webpush | fcm
    device_label = Column(String(120), nullable=True)                   # "iPhone", "Android · Chrome", ...
    last_success_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)


class AppKey(Base):
    """Phase 33: server-generated keys (the Web Push VAPID key pair when .secrets doesn't set one)."""
    __tablename__ = "app_keys"

    name = Column(String(50), primary_key=True)
    value = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)


class CoverRequest(Base):
    """Phase 34: a booked worker asks their venue team (and optionally the public board) to take their shift.
    They stay booked until someone takes it."""
    __tablename__ = "cover_requests"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    shift_id = Column(UUID(as_uuid=True), ForeignKey("shifts.id", ondelete="CASCADE"), nullable=False, index=True)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False, index=True)
    request_id = Column(UUID(as_uuid=True), ForeignKey("shift_requests.id", ondelete="CASCADE"), nullable=False)
    from_worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    audience = Column(String(10), nullable=False, default="team")              # team | public
    note = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="open", index=True)    # open | pending_approval | covered | cancelled | expired
    taken_by_worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    transfer_id = Column(UUID(as_uuid=True), ForeignKey("shift_transfers.id", ondelete="SET NULL"), nullable=True)
    warned_12h_at = Column(DateTime(timezone=True), nullable=True)
    warned_3h_at = Column(DateTime(timezone=True), nullable=True)
    closed_reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class WaitlistEntry(Base):
    """Phase 34: a place in line for a full position. When a spot opens the first person is booked
    (auto_book) or offered it for a short time."""
    __tablename__ = "waitlist_entries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    shift_id = Column(UUID(as_uuid=True), ForeignKey("shifts.id", ondelete="CASCADE"), nullable=False, index=True)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False)
    event_id = Column(UUID(as_uuid=True), ForeignKey("shift_events.id", ondelete="CASCADE"), nullable=True)
    worker_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    auto_book = Column(Boolean, nullable=False, default=True)
    status = Column(String(20), nullable=False, default="waiting")   # waiting | offered | booked | requested | passed | expired | left | closed
    offered_at = Column(DateTime(timezone=True), nullable=True)
    offer_expires_at = Column(DateTime(timezone=True), nullable=True)
    request_id = Column(UUID(as_uuid=True), ForeignKey("shift_requests.id", ondelete="SET NULL"), nullable=True)
    closed_reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class PayPeriodApproval(Base):
    """Phase 35: a pay period a manager approved. While status == 'approved' its times are locked."""
    __tablename__ = "pay_period_approvals"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    status = Column(String(20), nullable=False, default="approved")           # approved | reopened
    people = Column(Integer, nullable=False, default=0)
    total_hours = Column(Numeric(10, 2), nullable=False, default=0)
    overtime_hours = Column(Numeric(10, 2), nullable=False, default=0)
    total_pay = Column(Numeric(12, 2), nullable=False, default=0)
    total_tips = Column(Numeric(12, 2), nullable=False, default=0)             # Phase 35.2
    approved_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    reopened_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reopened_at = Column(DateTime(timezone=True), nullable=True)
    reopen_reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    __table_args__ = (Index("idx_pay_period_approvals_venue", "venue_id", "start_date"),)


class EventTip(Base):
    """Phase 35.2: an event's tip pool (own tips are on ShiftRequest.tip_amount)."""
    __tablename__ = "event_tips"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id = Column(UUID(as_uuid=True), ForeignKey("shift_events.id", ondelete="CASCADE"), nullable=False, unique=True)
    venue_id = Column(UUID(as_uuid=True), ForeignKey("venues.id", ondelete="CASCADE"), nullable=False)
    pool_amount = Column(Numeric(10, 2), nullable=False, default=0)
    split = Column(String(20), nullable=False, default="hours")                  # hours | equal
    note = Column(Text, nullable=True)
    updated_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (Index("idx_event_tips_venue", "venue_id"),)
