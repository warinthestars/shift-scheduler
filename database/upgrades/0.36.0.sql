-- ShiftBoard database upgrade: 0.35.6 -> 0.36.0 (Phase 36). Keeps all your data.
-- Safe to run more than once. Run it from the repository root, in each stack's folder:
--
--   PowerShell:  Get-Content database\upgrades\0.36.0.sql | docker compose exec -T database sh -c 'psql -v ON_ERROR_STOP=1 -U $POSTGRES_USER -d $POSTGRES_DB'
--   bash:        docker compose exec -T database sh -c 'psql -v ON_ERROR_STOP=1 -U $POSTGRES_USER -d $POSTGRES_DB' < database/upgrades/0.36.0.sql
--
-- then:          docker compose restart backend
--
-- It should end with COMMIT. Until it has run, nobody can sign in to a 0.36.0 backend.
BEGIN;

CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS organization_members (
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'owner',
    venue_alerts BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (organization_id, user_id)
);

-- If the backend restarted before you ran this, it already made the two tables above, but
-- without the database defaults. These lines add them (and change nothing otherwise).
ALTER TABLE organizations ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE organizations ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE organizations ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE organization_members ALTER COLUMN role SET DEFAULT 'owner';
ALTER TABLE organization_members ALTER COLUMN venue_alerts SET DEFAULT FALSE;
ALTER TABLE organization_members ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS ix_organization_members_user_id ON organization_members(user_id);

ALTER TABLE venues ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS public_board BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS city VARCHAR(120);
CREATE INDEX IF NOT EXISTS ix_venues_organization_id ON venues(organization_id);

ALTER TABLE venue_managers ADD COLUMN IF NOT EXISTS via_org BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE venue_whitelists ADD COLUMN IF NOT EXISTS is_lead BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
