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
    'SUPER_ADMIN',
    'VENUE_MANAGER',
    'WORKER'
);

CREATE TYPE request_status AS ENUM (
    'PENDING',
    'APPROVED',
    'REJECTED',
    'CHECKED_IN',
    'COMPLETED'
);

-- ------------------------------------------------------------------------------
-- 1. Users Table
-- ------------------------------------------------------------------------------
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    hashed_password VARCHAR(255),
    role user_role NOT NULL DEFAULT 'WORKER',
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
    auto_approve_rating_threshold DOUBLE PRECISION DEFAULT 4.5,
    logo_url TEXT,
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
    role_type VARCHAR(100) NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    hourly_rate NUMERIC(10, 2) NOT NULL DEFAULT 25.00,
    capacity INT NOT NULL DEFAULT 1,
    spots_filled INT NOT NULL DEFAULT 0,
    is_shift_auto_confirm BOOLEAN NOT NULL DEFAULT FALSE,
    description TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'OPEN',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_shift_time CHECK (end_time > start_time),
    CONSTRAINT chk_spots CHECK (spots_filled <= capacity)
);

CREATE INDEX idx_shifts_venue ON shifts(venue_id);
CREATE INDEX idx_shifts_start_time ON shifts(start_time);
CREATE INDEX idx_shifts_role_type ON shifts(role_type);

-- ------------------------------------------------------------------------------
-- 6. Shift Requests Table
-- ------------------------------------------------------------------------------
CREATE TABLE shift_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status request_status NOT NULL DEFAULT 'PENDING',
    approval_source VARCHAR(50),
    approved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    check_in_time TIMESTAMPTZ,
    check_in_verified BOOLEAN NOT NULL DEFAULT FALSE,
    check_out_time TIMESTAMPTZ,
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
CREATE TRIGGER trg_shifts_updated_at BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
CREATE TRIGGER trg_shift_requests_updated_at BEFORE UPDATE ON shift_requests FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
