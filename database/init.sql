-- ==============================================================================
-- ShiftBoard Database Initialization Schema
-- PostgreSQL 16
-- 
-- NOTE: If updating ENUM definitions or database constraints, wipe the existing
-- Docker database volume to apply changes:
--   docker compose down -v
--   docker compose up --build
-- ==============================================================================

-- Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ------------------------------------------------------------------------------
-- 1. Users Table
-- ------------------------------------------------------------------------------
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    hashed_password VARCHAR(255),
    role VARCHAR(50) NOT NULL DEFAULT 'worker',
    first_name VARCHAR(100) NOT NULL DEFAULT '',
    last_name VARCHAR(100) NOT NULL DEFAULT '',
    phone VARCHAR(30),
    avatar_url TEXT,
    bio TEXT,
    skills TEXT[] DEFAULT '{}',
    aggregate_rating DOUBLE PRECISION NOT NULL DEFAULT 5.00,
    rating_count INT NOT NULL DEFAULT 0,
    total_shifts INT NOT NULL DEFAULT 0,
    firebase_uid VARCHAR(128) UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    discoverable VARCHAR(20) NOT NULL DEFAULT 'private',   -- Phase 29.1: private | venues | everyone
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_firebase_uid ON users(firebase_uid);

-- ------------------------------------------------------------------------------
-- 2. Venues Table
-- ------------------------------------------------------------------------------
CREATE TABLE venues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    address TEXT NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    geofence_radius_meters INT NOT NULL DEFAULT 100,
    auto_approve_rating_threshold DOUBLE PRECISION,
    logo_url TEXT,
    timezone VARCHAR(64) NOT NULL DEFAULT 'America/New_York',
    phone VARCHAR(30),
    arrival_instructions TEXT,
    dress_code TEXT,
    default_shift_notes TEXT,
    approval_policy VARCHAR(20) NOT NULL DEFAULT 'team_auto',
    show_rates_publicly BOOLEAN NOT NULL DEFAULT TRUE,
    geofence_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    geofence_buffer_meters INT NOT NULL DEFAULT 150,
    clock_in_early_minutes INT NOT NULL DEFAULT 30,
    auto_clock_out_hours INT NOT NULL DEFAULT 2,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_venues_coordinates ON venues(lat, lng);

-- ------------------------------------------------------------------------------
-- 3. Venue Managers Junction Table
-- ------------------------------------------------------------------------------
CREATE TABLE venue_managers (
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (venue_id, user_id)
);

CREATE INDEX idx_venue_managers_user ON venue_managers(user_id);

-- ------------------------------------------------------------------------------
-- 4. Venue Whitelist Table
-- ------------------------------------------------------------------------------
CREATE TABLE venue_whitelists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notes TEXT,                                            -- Phase 29: private manager notes
    is_active BOOLEAN NOT NULL DEFAULT TRUE,               -- kept in sync: TRUE only when status = 'active'
    status VARCHAR(20) NOT NULL DEFAULT 'active',          -- Phase 29: active | removed | blocked
    positions TEXT[] NOT NULL DEFAULT '{}',                -- Phase 29: positions this person works here
    source VARCHAR(20) NOT NULL DEFAULT 'manager',         -- Phase 29: manager | invite | import | admin
    added_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_venue_whitelist UNIQUE (venue_id, worker_id)
);

CREATE INDEX idx_whitelist_venue ON venue_whitelists(venue_id);
CREATE INDEX idx_whitelist_worker ON venue_whitelists(worker_id);

-- ------------------------------------------------------------------------------
-- 4b. Venue Positions (Phase 25): per-venue roles with default pay
-- ------------------------------------------------------------------------------
CREATE TABLE venue_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    default_rate NUMERIC(10, 2) NOT NULL DEFAULT 25.00,
    default_rate_max NUMERIC(10, 2),
    hide_rate BOOLEAN NOT NULL DEFAULT FALSE,
    tips_eligible BOOLEAN NOT NULL DEFAULT FALSE,
    tip_pool BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_venue_position_name UNIQUE (venue_id, name),
    CONSTRAINT chk_position_tip_pool CHECK (tip_pool = FALSE OR tips_eligible = TRUE),
    CONSTRAINT chk_position_rate CHECK (default_rate > 0),
    CONSTRAINT chk_position_rate_range CHECK (default_rate_max IS NULL OR default_rate_max >= default_rate)
);

CREATE INDEX idx_venue_positions_venue ON venue_positions(venue_id);

-- Phase 27: saved service locations (caterers, off-site events)
CREATE TABLE venue_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    address TEXT NOT NULL,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    radius_meters INT,
    notes TEXT,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_venue_location_name UNIQUE (venue_id, name)
);
CREATE INDEX idx_venue_locations_venue ON venue_locations(venue_id);

-- ------------------------------------------------------------------------------
-- 4c. Shift Events (Phase 25.2): one posting = one event with 1+ positions
-- ------------------------------------------------------------------------------
CREATE TABLE shift_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    notes TEXT,
    staff_notes TEXT,
    info_updated_at TIMESTAMPTZ,
    info_change TEXT,
    location_id UUID REFERENCES venue_locations(id) ON DELETE SET NULL,
    geofence_mode VARCHAR(20) NOT NULL DEFAULT 'venue_default',
    location_staff_notes TEXT,
    cancelled_at TIMESTAMPTZ,
    cancel_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_event_time CHECK (end_time > start_time)
);

CREATE INDEX idx_shift_events_venue ON shift_events(venue_id);
CREATE INDEX idx_shift_events_start ON shift_events(start_time);

-- ------------------------------------------------------------------------------
-- 5. Shifts Table
-- ------------------------------------------------------------------------------
CREATE TABLE shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    event_id UUID REFERENCES shift_events(id) ON DELETE CASCADE,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    role_type VARCHAR(100) NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    hourly_rate NUMERIC(10, 2) NOT NULL DEFAULT 25.00,
    hourly_rate_max NUMERIC(10, 2),
    hide_rate BOOLEAN NOT NULL DEFAULT FALSE,
    approval_mode VARCHAR(20) NOT NULL DEFAULT 'venue_default',
    cancelled_at TIMESTAMPTZ,
    cancel_reason TEXT,
    tips_eligible BOOLEAN NOT NULL DEFAULT FALSE,
    tip_pool BOOLEAN NOT NULL DEFAULT FALSE,
    capacity INT NOT NULL DEFAULT 1,
    spots_filled INT NOT NULL DEFAULT 0,
    is_shift_auto_confirm BOOLEAN NOT NULL DEFAULT FALSE,
    description TEXT,
    staff_notes TEXT,
    info_updated_at TIMESTAMPTZ,
    info_change TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'OPEN',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_shift_time CHECK (end_time > start_time),
    CONSTRAINT chk_spots CHECK (spots_filled <= capacity),
    CONSTRAINT chk_tip_pool CHECK (tip_pool = FALSE OR tips_eligible = TRUE),
    CONSTRAINT chk_shift_rate_range CHECK (hourly_rate_max IS NULL OR hourly_rate_max >= hourly_rate)
);

CREATE INDEX idx_shifts_venue ON shifts(venue_id);
CREATE INDEX idx_shifts_start_time ON shifts(start_time);
CREATE INDEX idx_shifts_role_type ON shifts(role_type);
CREATE INDEX idx_shifts_event ON shifts(event_id);

-- ------------------------------------------------------------------------------
-- 6. Shift Requests Table
-- ------------------------------------------------------------------------------
CREATE TABLE shift_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    approval_source VARCHAR(50),
    approved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    check_in_time TIMESTAMPTZ,
    check_in_verified BOOLEAN NOT NULL DEFAULT FALSE,
    check_out_time TIMESTAMPTZ,
    check_out_verified BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    dropped_at TIMESTAMPTZ,
    status_reason TEXT,
    pay_rate NUMERIC(10, 2),
    info_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_shift_worker UNIQUE (shift_id, worker_id)
);

CREATE INDEX idx_shift_requests_shift ON shift_requests(shift_id);
CREATE INDEX idx_shift_requests_worker ON shift_requests(worker_id);
CREATE INDEX idx_shift_requests_status ON shift_requests(status);

-- ------------------------------------------------------------------------------
-- 7. Ratings Table
-- ------------------------------------------------------------------------------
CREATE TABLE ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_request_id UUID NOT NULL UNIQUE REFERENCES shift_requests(id) ON DELETE CASCADE,
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    review TEXT,                                           -- private to the venue's managers
    would_book_again BOOLEAN,                              -- Phase 29
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ratings_worker ON ratings(worker_id);
CREATE INDEX idx_ratings_venue ON ratings(venue_id);

-- ------------------------------------------------------------------------------
-- Trigger: Recalculate Worker Rating
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_worker_stats_on_rating()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE users
    SET
        aggregate_rating = (
            SELECT COALESCE(ROUND(AVG(rating)::numeric, 2), 5.00)
            FROM ratings
            WHERE worker_id = NEW.worker_id
        ),
        rating_count = (
            SELECT COUNT(*)
            FROM ratings
            WHERE worker_id = NEW.worker_id
        )
    WHERE id = NEW.worker_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_worker_rating
AFTER INSERT OR UPDATE ON ratings
FOR EACH ROW
EXECUTE FUNCTION update_worker_stats_on_rating();

-- ------------------------------------------------------------------------------
-- Trigger: Update updated_at
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER trg_venues_updated_at BEFORE UPDATE ON venues FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER trg_venue_positions_updated_at BEFORE UPDATE ON venue_positions FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER trg_venue_locations_updated_at BEFORE UPDATE ON venue_locations FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER trg_shift_events_updated_at BEFORE UPDATE ON shift_events FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER trg_shifts_updated_at BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER trg_shift_requests_updated_at BEFORE UPDATE ON shift_requests FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

-- ------------------------------------------------------------------------------
-- 8. Time Entries Table
-- ------------------------------------------------------------------------------
CREATE TABLE time_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    clock_in_time TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    clock_out_time TIMESTAMPTZ,
    clock_in_lat DOUBLE PRECISION,
    clock_in_lng DOUBLE PRECISION,
    clock_in_distance_m INT,
    clock_in_geo_status VARCHAR(20) NOT NULL DEFAULT 'not_checked',
    clock_out_lat DOUBLE PRECISION,
    clock_out_lng DOUBLE PRECISION,
    clock_out_distance_m INT,
    clock_out_geo_status VARCHAR(20),
    auto_closed BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_time_entries_worker ON time_entries(worker_id);
CREATE INDEX idx_time_entries_shift ON time_entries(shift_id);

-- ------------------------------------------------------------------------------
-- Time sheet audit log (Phase 26). time_entry_id has no FK so history survives deletes.
-- ------------------------------------------------------------------------------
CREATE TABLE time_entry_edits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_request_id UUID REFERENCES shift_requests(id) ON DELETE CASCADE,
    time_entry_id UUID,
    editor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(30) NOT NULL,
    old_value TEXT,
    new_value TEXT,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_time_entry_edits_request ON time_entry_edits(shift_request_id);
CREATE INDEX idx_time_entry_edits_entry ON time_entry_edits(time_entry_id);

-- ------------------------------------------------------------------------------
-- 9. Shift Transfers Table
-- ------------------------------------------------------------------------------
CREATE TABLE shift_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    from_worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending_worker_acceptance',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_shift_transfers_shift ON shift_transfers(shift_id);
CREATE INDEX idx_shift_transfers_from_worker ON shift_transfers(from_worker_id);
CREATE INDEX idx_shift_transfers_to_worker ON shift_transfers(to_worker_id);
CREATE INDEX idx_shift_transfers_status ON shift_transfers(status);

CREATE TRIGGER trg_shift_transfers_updated_at BEFORE UPDATE ON shift_transfers FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

-- ------------------------------------------------------------------------------
-- 10. Shift Board Messages Table
-- ------------------------------------------------------------------------------
CREATE TABLE shift_board_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_shift_board_messages_shift ON shift_board_messages(shift_id);
CREATE INDEX idx_shift_board_messages_author ON shift_board_messages(author_id);

-- ==============================================================================
-- Phase 28: Notifications (in-app bell + email/SMS outbox + per-user preferences)
-- ==============================================================================
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind VARCHAR(40) NOT NULL,
    title VARCHAR(200) NOT NULL,
    body TEXT,
    link VARCHAR(300),
    venue_id UUID REFERENCES venues(id) ON DELETE CASCADE,
    event_id UUID REFERENCES shift_events(id) ON DELETE CASCADE,
    request_id UUID REFERENCES shift_requests(id) ON DELETE CASCADE,
    urgent BOOLEAN NOT NULL DEFAULT FALSE,
    dedupe_key VARCHAR(200) UNIQUE,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id) WHERE read_at IS NULL;

CREATE TABLE notification_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel VARCHAR(10) NOT NULL,                 -- email | sms
    status VARCHAR(12) NOT NULL DEFAULT 'pending', -- pending | sent | failed | skipped
    digest BOOLEAN NOT NULL DEFAULT FALSE,
    send_after TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_notification_deliveries_due ON notification_deliveries(status, send_after);

CREATE TABLE notification_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sms_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    new_shift_alerts VARCHAR(10) NOT NULL DEFAULT 'daily',   -- off | instant | daily
    manager_alerts_email BOOLEAN NOT NULL DEFAULT TRUE,
    quiet_start SMALLINT,                                     -- hour 0-23, NULL = no quiet hours
    quiet_end SMALLINT,
    timezone VARCHAR(64) NOT NULL DEFAULT 'America/New_York',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- Phase 29: Team invites (link / QR / personal) and direct shift offers
-- ==============================================================================
CREATE TABLE venue_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    token VARCHAR(64) NOT NULL UNIQUE,
    kind VARCHAR(20) NOT NULL DEFAULT 'personal',          -- link (shareable / QR) | personal (one person)
    email VARCHAR(255),
    phone VARCHAR(30),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    positions TEXT[] NOT NULL DEFAULT '{}',
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    uses INT NOT NULL DEFAULT 0,
    accepted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    accepted_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    last_sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_venue_invites_venue ON venue_invites(venue_id, kind);

CREATE TABLE shift_offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    batch_id UUID NOT NULL,                                -- offers sent together; first to accept wins
    offered_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',         -- pending | accepted | declined | filled | cancelled
    message TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    responded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_shift_offers_worker ON shift_offers(worker_id, status);
CREATE INDEX idx_shift_offers_shift ON shift_offers(shift_id, status);

-- ==============================================================================
-- Phase 29.1: Venue activity log (what happened at the venue, and who did it)
-- ==============================================================================
CREATE TABLE venue_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    kind VARCHAR(40) NOT NULL,
    category VARCHAR(20) NOT NULL,                        -- bookings | staffing | team | changes | alerts
    summary VARCHAR(400) NOT NULL,
    event_id UUID REFERENCES shift_events(id) ON DELETE SET NULL,
    request_id UUID REFERENCES shift_requests(id) ON DELETE SET NULL,
    worker_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_venue_activity_venue_created ON venue_activity(venue_id, created_at DESC);

-- ==============================================================================
-- Phase 29.2: Platform admin audit log (who changed users, venues and system settings)
-- ==============================================================================
CREATE TABLE admin_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(40) NOT NULL,
    target_type VARCHAR(20) NOT NULL,                     -- user | venue | system
    target_id UUID,                                       -- no FK: the target may be deleted
    summary VARCHAR(400) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_admin_audit_created ON admin_audit(created_at DESC);
CREATE INDEX idx_admin_audit_target ON admin_audit(target_type, target_id);
