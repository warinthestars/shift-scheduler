-- ShiftBoard database upgrade: 0.36.0 -> 0.36.1 (Phase 36.1, calendar sync). Keeps all your data.
-- Safe to run more than once. Only needed if you did NOT wipe the database (docker compose down -v).
-- Run it from the repository root, in each stack's folder:
--
--   PowerShell:  Get-Content database\upgrades\0.36.1.sql | docker compose exec -T database sh -c 'psql -v ON_ERROR_STOP=1 -U $POSTGRES_USER -d $POSTGRES_DB'
--   bash:        docker compose exec -T database sh -c 'psql -v ON_ERROR_STOP=1 -U $POSTGRES_USER -d $POSTGRES_DB' < database/upgrades/0.36.1.sql
--
-- It should end with COMMIT.
BEGIN;

CREATE TABLE IF NOT EXISTS calendar_feeds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind VARCHAR(20) NOT NULL,
    scope_key VARCHAR(60) NOT NULL,
    venue_id UUID REFERENCES venues(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    token VARCHAR(64) NOT NULL UNIQUE,
    include_requested BOOLEAN NOT NULL DEFAULT TRUE,
    include_waitlist BOOLEAN NOT NULL DEFAULT TRUE,
    include_offers BOOLEAN NOT NULL DEFAULT TRUE,
    include_time_off BOOLEAN NOT NULL DEFAULT TRUE,
    include_drafts BOOLEAN NOT NULL DEFAULT FALSE,
    last_fetched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_calendar_feed_scope UNIQUE (user_id, scope_key)
);

-- The backend makes this table by itself when 0.36.1 first starts, but without the database defaults.
-- These lines add them (and change nothing otherwise).
ALTER TABLE calendar_feeds ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE calendar_feeds ALTER COLUMN include_requested SET DEFAULT TRUE;
ALTER TABLE calendar_feeds ALTER COLUMN include_waitlist SET DEFAULT TRUE;
ALTER TABLE calendar_feeds ALTER COLUMN include_offers SET DEFAULT TRUE;
ALTER TABLE calendar_feeds ALTER COLUMN include_time_off SET DEFAULT TRUE;
ALTER TABLE calendar_feeds ALTER COLUMN include_drafts SET DEFAULT FALSE;
ALTER TABLE calendar_feeds ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE calendar_feeds ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_calendar_feeds_user ON calendar_feeds(user_id);

COMMIT;
