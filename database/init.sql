-- ==============================================================================
-- ShiftBoard Database Initialization Schema
-- PostgreSQL 16
-- ==============================================================================

-- Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- Custom ENUM Types
-- ------------------------------------------------------------------------------
CREATE TYPE user_role AS ENUM (
    'platform_admin',
    'venue_manager',
    'worker'
);

CREATE TYPE shift_status AS ENUM (
    'open',
    'filled',
    'in_progress',
    'completed',
    'cancelled'
);

CREATE TYPE request_status AS ENUM (
    'pending',
    'approved',
    'rejected',
    'cancelled',
    'completed'
);

CREATE TYPE approval_source AS ENUM (
    'shift_auto_confirm',
    'venue_whitelist',
    'rating_threshold',
    'manager_manual'
);

CREATE TYPE swap_status AS ENUM (
    'pending',
    'approved',
    'rejected',
    'cancelled'
);

-- ------------------------------------------------------------------------------
-- 1. Users Table
-- ------------------------------------------------------------------------------
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firebase_uid VARCHAR(128) UNIQUE,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255),
    role user_role NOT NULL DEFAULT 'worker',
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(30),
    avatar_url TEXT,
    bio TEXT,
    skills TEXT[] DEFAULT '{}',
    rating_average NUMERIC(3, 2) NOT NULL DEFAULT 5.00,
    rating_count INT NOT NULL DEFAULT 0,
    total_shifts_completed INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_firebase_uid ON users(firebase_uid);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_email ON users(email);

-- ------------------------------------------------------------------------------
-- 2. Venues Table
-- ------------------------------------------------------------------------------
CREATE TABLE venues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    address TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    geofence_radius_meters INT NOT NULL DEFAULT 100,
    logo_url TEXT,
    global_auto_approve_min_rating NUMERIC(3, 2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_venues_coordinates ON venues(latitude, longitude);

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
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_venue_whitelist UNIQUE (venue_id, worker_id)
);

CREATE INDEX idx_whitelist_venue ON venue_whitelists(venue_id);
CREATE INDEX idx_whitelist_worker ON venue_whitelists(worker_id);

-- ------------------------------------------------------------------------------
-- 5. Shifts Table
-- ------------------------------------------------------------------------------
CREATE TABLE shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    role_required VARCHAR(100) NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    hourly_rate NUMERIC(10, 2) NOT NULL,
    spots_needed INT NOT NULL DEFAULT 1,
    spots_filled INT NOT NULL DEFAULT 0,
    auto_confirm_anyone BOOLEAN NOT NULL DEFAULT FALSE,
    min_rating_override NUMERIC(3, 2),
    description TEXT,
    dress_code TEXT,
    status shift_status NOT NULL DEFAULT 'open',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_shift_time CHECK (end_time > start_time),
    CONSTRAINT chk_spots CHECK (spots_filled <= spots_needed)
);

CREATE INDEX idx_shifts_venue ON shifts(venue_id);
CREATE INDEX idx_shifts_start_time ON shifts(start_time);
CREATE INDEX idx_shifts_status ON shifts(status);
CREATE INDEX idx_shifts_role ON shifts(role_required);

-- ------------------------------------------------------------------------------
-- 6. Shift Requests Table (Applications & Approvals)
-- ------------------------------------------------------------------------------
CREATE TABLE shift_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status request_status NOT NULL DEFAULT 'pending',
    approval_source approval_source,
    approved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    -- Geofenced check-in/out tracking
    check_in_time TIMESTAMPTZ,
    check_in_lat DOUBLE PRECISION,
    check_in_lng DOUBLE PRECISION,
    check_in_verified BOOLEAN NOT NULL DEFAULT FALSE,
    check_out_time TIMESTAMPTZ,
    check_out_lat DOUBLE PRECISION,
    check_out_lng DOUBLE PRECISION,
    check_out_verified BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
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
    review TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ratings_worker ON ratings(worker_id);
CREATE INDEX idx_ratings_venue ON ratings(venue_id);

-- ------------------------------------------------------------------------------
-- 8. Shift Swaps Table
-- ------------------------------------------------------------------------------
CREATE TABLE shift_swaps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_request_id UUID NOT NULL REFERENCES shift_requests(id) ON DELETE CASCADE,
    proposing_worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiving_worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status swap_status NOT NULL DEFAULT 'pending',
    manager_approval_required BOOLEAN NOT NULL DEFAULT TRUE,
    approved_by_manager_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_shift_swaps_request ON shift_swaps(shift_request_id);
CREATE INDEX idx_shift_swaps_status ON shift_swaps(status);

-- ------------------------------------------------------------------------------
-- Utility Function: Haversine Geofence Distance Calculation (in Meters)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION calculate_distance_meters(
    lat1 DOUBLE PRECISION,
    lon1 DOUBLE PRECISION,
    lat2 DOUBLE PRECISION,
    lon2 DOUBLE PRECISION
) RETURNS DOUBLE PRECISION AS $$
DECLARE
    r CONSTANT DOUBLE PRECISION := 6371000; -- Earth radius in meters
    dlat DOUBLE PRECISION;
    dlon DOUBLE PRECISION;
    a DOUBLE PRECISION;
    c DOUBLE PRECISION;
BEGIN
    dlat := radians(lat2 - lat1);
    dlon := radians(lon2 - lon1);
    a := sin(dlat / 2)^2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2)^2;
    c := 2 * atan2(sqrt(a), sqrt(1 - a));
    RETURN r * c;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ------------------------------------------------------------------------------
-- Trigger: Automatically Recalculate Worker Aggregate Rating and Shifts Completed
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_worker_stats_on_rating()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE users
    SET
        rating_average = (
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
-- Trigger: Update updated_at Timestamp Helper
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
CREATE TRIGGER trg_venue_whitelists_updated_at BEFORE UPDATE ON venue_whitelists FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER trg_shifts_updated_at BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER trg_shift_requests_updated_at BEFORE UPDATE ON shift_requests FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER trg_shift_swaps_updated_at BEFORE UPDATE ON shift_swaps FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
