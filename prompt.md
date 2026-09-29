# Phase 35.1.1: Secrets Out of .env (Stack Secrets + Integration Keys)

**Why:** 35.1 put every secret in the root `.env`, because `docker-compose.yml` passed passwords with `${...}` and Compose only fills `${...}` from `.env`. That breaks the project rule that secrets live in `.secrets/`. Now settings are split three ways, and **no secret goes through `${...}` any more**:

| File | Holds | Read by |
| :--- | :--- | :--- |
| `.env` | ordinary settings, **no secrets** | `backend` (plus non-secret `${...}` like ports and names) |
| `.secrets/stack.env` | `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `SECRET_KEY`, `SUPER_ADMIN_PASSWORD`, `TUNNEL_TOKEN` | `database`, `redis`, `cloudflared`, `backend` |
| `.secrets/integrations.env` | `SMTP_USERNAME`, `SMTP_PASSWORD`, `RESEND_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `VAPID_PRIVATE_KEY`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | `backend` **only** |

So Postgres, Redis and the tunnel never see email / text / storage keys. The frontend still gets nothing.

## What changes
* **`docker-compose.yml`:**
  * `database`: `env_file: .secrets/stack.env`. Postgres reads `POSTGRES_PASSWORD` from it directly. **`POSTGRES_PASSWORD` is removed from `environment:`**: an `environment:` entry would win over the file and be blank.
  * `redis`: `env_file: .secrets/stack.env`. It starts through `sh -c` with `--requirepass "$${REDIS_PASSWORD:?...}"` (`$$` = the container's shell reads it, not Compose), and refuses to start without a password. The healthcheck uses `$$REDIS_PASSWORD` too.
  * `backend`: `env_file` = `.env` + `.secrets/stack.env` + `.secrets/integrations.env` (all required). `environment:` keeps only `POSTGRES_HOST=database`, `POSTGRES_PORT=5432`, `REDIS_HOST=redis`. `DATABASE_URL`, `REDIS_URL`, `POSTGRES_PASSWORD` and `SUPER_ADMIN_*` are gone from it.
  * `cloudflared`: `env_file: .secrets/stack.env`; command `tunnel --no-autoupdate run`. cloudflared reads **`TUNNEL_TOKEN`** from its environment by itself; the setting is renamed from `CLOUDFLARE_TUNNEL_TOKEN`.
* **`backend/src/config.py`:** `REDIS_URL` is built from `REDIS_PASSWORD` (URL-encoded) + `REDIS_HOST` + port 6379, unless `REDIS_URL` is set (local runs). The database address was already built from `POSTGRES_*`, which is unchanged. The fallback with no Redis settings is exactly the old default.
* **Templates:** `.env.template` has no secrets (replaced whole). New `.secrets/stack.env.template` and `.secrets/integrations.env.template`. **Delete** `.secrets/.secrets.env.template`. `backend/.env.template` gets a comment fix.
* **`scripts/consolidate_env.py`** (replaced whole) sorts settings into the three files, from either the 0.35.0 or the 0.35.1 layout. It prints names only.
  * **Template placeholders** (`your_..._here`) are never carried over, and it **refuses** while the database password or `SECRET_KEY` is only a placeholder.
  * **`--source <file>`** reads the root settings from another file.
  * Unknown settings that look secret go to `integrations.env`.
  * Backups are `*.pre-0.35.2.bak`; `--undo` restores them.
* **`.gitignore`:** also ignores `*.bak`; the stale `!.secrets/.secrets.env.template` line is removed. `.secrets/*` stays.
* **`agy_system_instructions.md`:**
  * the tree and the **Configuration rules** are updated for three files
  * **the "Standing rules (added in Phase 34.5)" section is restored**: it went missing when 35.1 was applied
* Admin → System hint text mentions the secret files.
* **Version 0.35.2** (a third-level phase takes the next patch number). `frontend/package.json` and `backend/src/version.py` are both bumped, and the CHANGELOG and README updates are included below. **This covers the standing directive for this phase, so don't bump again.**

## 0. Rules for this phase
* Do **NOT** touch:
  - `backend/src/auth.py`, `backend/src/routers/auth.py`, `backend/src/main.py`
  - `frontend/src/context/AuthContext.jsx`, `frontend/src/api/client.js`, `frontend/vite.config.js`, both Dockerfiles
  - In `backend/src/config.py`, **only** the two edits in A2.
* **NEVER open, print, `cat`, `type`, `Get-Content`, diff or commit** any real settings file: `.env`, `.env.old.env`, anything in `.secrets/` except `*.template`, or any `*.bak`. The only thing that reads their contents is the script in Part S; the only comparison allowed is the silent `git diff --no-index --quiet` in Part S.
* **Do NOT run** `docker compose down`, `up`, `restart`, `build` or `down -v`. Andrew rebuilds himself. The only Docker command allowed is `docker compose config --quiet`.
* No schema change. No new packages.
* **NEW FILES / REPLACE THE WHOLE FILE:** write exactly the content shown.
* **EDITS:** each edit is an exact *Find* → *Replace with*; every *Find* appears **exactly once** in the current file; apply them in order.
  - Some files use Windows line endings (CRLF). Match on the text and keep the file's line endings.
* **Verification.** All files were checked against your repo. 35.1 is fully applied, except that `agy_system_instructions.md` lost its Standing rules section; A5 restores it. They were verified:
  - **`docker compose config --quiet` passes** with the three templates copied in.
    - In the resolved config, `database` / `redis` / `cloudflared` get only the stack keys (no Twilio, SMTP or R2); `frontend` gets nothing.
    - The backend gets all three files, with `POSTGRES_PORT=5432` and `REDIS_HOST=redis`, and no `DATABASE_URL` / `REDIS_URL`.
    - The Redis command and healthcheck keep `$$REDIS_PASSWORD` for the container's shell.
  - **The Redis start command**, run in a real shell, passes a password with `@`, a space, `$` and a quote through intact. With no password it stops with *"REDIS_PASSWORD is not set in .secrets/stack.env"*.
  - **The backend's own config**, loaded with exactly the environment Compose produces, reads `SECRET_KEY`, builds the correct database address and `redis://:…@redis:6379/0` (special characters URL-encoded, and the Redis client decodes them back), and reads the integration keys.
  - **`.gitignore`**, tested in a scratch repo: tracked are `.env.template`, `backend/.env.template`, `.secrets/stack.env.template`, `.secrets/integrations.env.template` and `.secrets/firebase-web-config.js.template`. Ignored are `.env`, `.secrets/stack.env`, `.secrets/integrations.env` and every `*.bak`.
  - **The script** was run on test copies of three layouts:
    - (a) the 0.35.0 four-file layout
    - (b) the 0.35.1 single `.env`
    - (c) **your current layout**: `.env` is a copy of `.env.template`, and the real 35.1 output is in `.env.old.env`

    It gave the right values in the right files each time. In (c) it **refused** without `--source` (placeholders), worked with `--source .env.old.env`, and `--undo` restored everything. No value was ever printed.
  - **Backend suites pass**, including the admin System check (reports **0.35.2**). The frontend bundles.

  Don't "improve" them.

---

# PART A: Compose, backend config & git

## A1. `docker-compose.yml` (EDITS)

**Edit 1.** Find:
```yaml
# ------------------------------------------------------------------------------
# Phase 35.1: ALL settings come from ONE file, the root .env (template: .env.template).
#  * ${...} values below are substituted from .env when Compose starts.
#  * The backend also gets every line of .env as environment variables (env_file).
#  * database / redis / cloudflared only get the few values they need.
# backend/.env, frontend/.env and .secrets/.secrets.env are NOT read any more.
# .secrets/ still holds the Firebase files and is mounted read-only into the backend.
# ------------------------------------------------------------------------------

```
Replace with:
```yaml
# ------------------------------------------------------------------------------
# Phase 35.1.1: settings live in THREE files (each has a .template next to it):
#   .env                          ordinary settings, NO secrets (ports, names, providers, URLs, switches)
#   .secrets/stack.env            stack secrets: database / Redis passwords, login signing key,
#                                 super-admin password, tunnel token
#   .secrets/integrations.env     outside-service keys: email, texts, push, file storage
# Who gets what:
#   database, redis, cloudflared  -> .secrets/stack.env only (never the integration keys)
#   backend                       -> all three
#   frontend                      -> nothing
# ${...} below is only used for NON-secret values from .env. Secrets are never put in
# ${...}: Compose would read them from .env only, which is how secrets ended up there before.
# .secrets/ also holds the Firebase files and is mounted read-only into the backend.
# ------------------------------------------------------------------------------

```

**Edit 2.** Find:
```yaml
    container_name: shiftboard-database
    restart: unless-stopped
    environment:
      - POSTGRES_USER=${POSTGRES_USER:-shiftboard_user}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=${POSTGRES_DB:-shiftboard}
    volumes:
```
Replace with:
```yaml
    container_name: shiftboard-database
    restart: unless-stopped
    # POSTGRES_PASSWORD comes from .secrets/stack.env. Don't add it under environment: (that would win and be blank).
    env_file:
      - path: ./.secrets/stack.env
        required: true
    environment:
      - POSTGRES_USER=${POSTGRES_USER:-shiftboard_user}
      - POSTGRES_DB=${POSTGRES_DB:-shiftboard}
    volumes:
```

**Edit 3.** Find:
```yaml
    container_name: shiftboard-redis
    restart: unless-stopped
    command: ["redis-server", "/usr/local/etc/redis/redis.conf", "--requirepass", "${REDIS_PASSWORD:-shiftboard_redis_pass}"]
    volumes:
      - redis_data:/data
      - ./redis/redis.conf:/usr/local/etc/redis/redis.conf:ro
    ports:
      - "${REDIS_PORT:-6379}:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD:-shiftboard_redis_pass}", "ping"]
      interval: 10s
      timeout: 5s
```
Replace with:
```yaml
    container_name: shiftboard-redis
    restart: unless-stopped
    # REDIS_PASSWORD comes from .secrets/stack.env; the container's shell reads it ($$ = not a Compose ${...}).
    env_file:
      - path: ./.secrets/stack.env
        required: true
    command: ["sh", "-c", "exec redis-server /usr/local/etc/redis/redis.conf --requirepass \"$${REDIS_PASSWORD:?REDIS_PASSWORD is not set in .secrets/stack.env}\""]
    volumes:
      - redis_data:/data
      - ./redis/redis.conf:/usr/local/etc/redis/redis.conf:ro
    ports:
      - "${REDIS_PORT:-6379}:6379"
    healthcheck:
      test: ["CMD-SHELL", "redis-cli --no-auth-warning -a \"$$REDIS_PASSWORD\" ping | grep -q PONG"]
      interval: 10s
      timeout: 5s
```

**Edit 4.** Find:
```yaml
      - path: ./.env
        required: true
    # These win over .env: how the backend reaches the other containers (always port 5432 / 6379
    # inside the Docker network; POSTGRES_PORT / REDIS_PORT in .env are only the ports on your computer).
    environment:
      - POSTGRES_USER=${POSTGRES_USER:-shiftboard_user}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_HOST=database
      - POSTGRES_PORT=5432
      - POSTGRES_DB=${POSTGRES_DB:-shiftboard}
      - DATABASE_URL=postgresql+asyncpg://${POSTGRES_USER:-shiftboard_user}:${POSTGRES_PASSWORD}@database:5432/${POSTGRES_DB:-shiftboard}
      - REDIS_URL=redis://:${REDIS_PASSWORD:-shiftboard_redis_pass}@redis:6379/0
      - SUPER_ADMIN_USERNAME=${SUPER_ADMIN_USERNAME:-demo_admin@shiftboard.com}
      - SUPER_ADMIN_PASSWORD=${SUPER_ADMIN_PASSWORD:-SuperSecretDemo123!}
    volumes:
      - ./backend:/app
```
Replace with:
```yaml
      - path: ./.env
        required: true
      - path: ./.secrets/stack.env
        required: true
      - path: ./.secrets/integrations.env
        required: true
    # These win over the files: how the backend reaches the other containers (always 5432 / 6379
    # inside the Docker network; POSTGRES_PORT / REDIS_PORT in .env are only the ports on your computer).
    # backend/src/config.py builds the database and Redis addresses from these + the passwords.
    environment:
      - POSTGRES_HOST=database
      - POSTGRES_PORT=5432
      - REDIS_HOST=redis
    volumes:
      - ./backend:/app
```

**Edit 5.** Find:
```yaml
    container_name: shiftboard-cloudflared
    restart: unless-stopped
    command: tunnel --no-autoupdate run --token ${CLOUDFLARE_TUNNEL_TOKEN:-}
    volumes:
      - ./cloudflared/config.yml:/etc/cloudflared/config.yml:ro
```
Replace with:
```yaml
    container_name: shiftboard-cloudflared
    restart: unless-stopped
    # cloudflared reads TUNNEL_TOKEN from .secrets/stack.env by itself.
    env_file:
      - path: ./.secrets/stack.env
        required: true
    command: tunnel --no-autoupdate run
    volumes:
      - ./cloudflared/config.yml:/etc/cloudflared/config.yml:ro
```

---

## A2. `backend/src/config.py` (EDITS)
A `_redis_url()` helper just above `class Settings`, and the `REDIS_URL` line.

**Edit 1.** Find:
```python
    )

class Settings(BaseSettings):
    ENV: str = os.getenv("ENV", "development")
```
Replace with:
```python
    )

def _redis_url() -> str:
    """Phase 35.1.1: REDIS_URL if set (e.g. local runs), else redis://:<REDIS_PASSWORD>@<REDIS_HOST>:6379/0.
    Always port 6379: REDIS_PORT in .env is the port on the host computer, not inside Docker."""
    explicit = os.getenv("REDIS_URL", "").strip()
    if explicit:
        return explicit
    from urllib.parse import quote
    password = os.getenv("REDIS_PASSWORD", "shiftboard_redis_pass")
    host = os.getenv("REDIS_HOST", "redis")
    return f"redis://:{quote(password, safe='')}@{host}:6379/0"


class Settings(BaseSettings):
    ENV: str = os.getenv("ENV", "development")
```

**Edit 2.** Find:
```python
    DB_MAX_OVERFLOW: int = int(os.getenv("DB_MAX_OVERFLOW", "10"))

    # Redis
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://:shiftboard_redis_pass@redis:6379/0")

    # JWT Authentication
```
Replace with:
```python
    DB_MAX_OVERFLOW: int = int(os.getenv("DB_MAX_OVERFLOW", "10"))

    # Redis. Phase 35.1.1: built from REDIS_PASSWORD (.secrets/stack.env) and REDIS_HOST unless REDIS_URL is set.
    REDIS_URL: str = _redis_url()

    # JWT Authentication
```

---

## A3. `.gitignore` (EDIT)

**Edit 1.** Find:
```text
# Ignoring the folder itself makes git skip it entirely, and the !-rules below
# can no longer re-include the *.template files (they silently become untracked).
# Phase 35.1: the real settings live in the root .env. ".env.*" also covers .env.local and the
# *.pre-0.35.1.bak backups made by scripts/consolidate_env.py, in any folder.
.env
.env.local
.env.*
*.env
!.env.template
.secrets/*
!.secrets/*.template
!.secrets/.secrets.env.template
*.pem
*.key
```
Replace with:
```text
# Ignoring the folder itself makes git skip it entirely, and the !-rules below
# can no longer re-include the *.template files (they silently become untracked).
# Phase 35.1.1: real settings live in .env, .secrets/stack.env and .secrets/integrations.env.
# ".env.*" also covers .env.local and the *.pre-0.35.x.bak backups made by
# scripts/consolidate_env.py, in any folder. Templates (*.template) stay tracked.
.env
.env.local
.env.*
*.env
*.bak
!.env.template
.secrets/*
!.secrets/*.template
*.pem
*.key
```

---

## A4. `frontend/src/components/admin/AdminSystem.jsx` (EDIT)

**Edit 1.** Find:
```jsx
            </Row>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">Change these in the .env file, then recreate the containers: docker compose up -d --force-recreate (keeps your data).</p>
        </section>

```
Replace with:
```jsx
            </Row>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">Change these in .env (secrets in .secrets/stack.env or .secrets/integrations.env), then recreate the containers: docker compose up -d --force-recreate (keeps your data).</p>
        </section>

```

---

## A5. `agy_system_instructions.md` (EDITS)
Edit 2 replaces the Configuration rules and puts back the **Standing rules (Phase 34.5)** section above them.

**Edit 1.** Find:
```markdown
/shift-scheduler
├── .gitignore               # MUST ignore .env, .env.*, .secrets/* (NOT ".secrets/"), node_modules, etc.
├── docker-compose.yml       # reads ONLY the root .env (Phase 35.1)
├── .env                     # THE settings file. Ignored by git.
├── .env.template            # documents every setting
├── .secrets/
│   ├── firebase-web-config.js          # ignored; mounted read-only into the backend
│   └── firebase_service_account.json   # ignored; mounted read-only into the backend
├── scripts/
│   └── consolidate_env.py   # one-time merge of the pre-0.35.1 settings files
├── cloudflared/
│   └── config.yml
```
Replace with:
```markdown
/shift-scheduler
├── .gitignore               # MUST ignore .env, .env.*, .secrets/* (NOT ".secrets/"), node_modules, etc.
├── docker-compose.yml       # reads .env + .secrets/stack.env + .secrets/integrations.env (Phase 35.1.1)
├── .env                     # ordinary settings, NO secrets. Ignored by git.
├── .env.template            # documents every ordinary setting
├── .secrets/
│   ├── stack.env                       # ignored; stack secrets (database, redis, cloudflared, backend)
│   ├── integrations.env                # ignored; outside-service keys (backend only)
│   ├── *.template                      # tracked; document the two files above
│   ├── firebase-web-config.js          # ignored; mounted read-only into the backend
│   └── firebase_service_account.json   # ignored; mounted read-only into the backend
├── scripts/
│   └── consolidate_env.py   # one-time sort of older settings files into the three files
├── cloudflared/
│   └── config.yml
```

**Edit 2.** Find:
```markdown

The project rules that always apply are in README.md → "Working on the code" (no native PostgreSQL ENUMs, locked sign-in files, timezone-aware UTC, schema changes in models.py AND database/init.sql, Event → Shift → Position wording).

## Configuration rules (added in Phase 35.1, apply to every phase)
1. **One settings file:** every setting lives in the root `.env`. `docker-compose.yml` reads only that file (`env_file: .env` on the backend; `${...}` for `database`, `redis`, `cloudflared`). Never add `env_file` entries for `backend/.env`, `frontend/.env` or `.secrets/.secrets.env`.
2. **A new setting** goes in `.env.template` (with a comment) AND in `backend/src/config.py`. If it's a secret, also list it in `.secrets/.secrets.env.template`. Update the README Configuration table.
3. **Never read, print or commit real `.env` / `.secrets` contents.** Only templates hold example values.
4. **The frontend has no settings.** Don't add `VITE_` variables or Docker build args unless a phase explicitly asks; the Firebase web config comes from the backend (`GET /api/auth/firebase-config`).
5. **Don't touch `.secrets/*` in `.gitignore`** (ignoring `.secrets/` itself untracks the templates).
6. Changing `.env` needs `docker compose up -d --force-recreate`, NOT `down -v` (that deletes the database).
```
Replace with:
```markdown

The project rules that always apply are in README.md → "Working on the code" (no native PostgreSQL ENUMs, locked sign-in files, timezone-aware UTC, schema changes in models.py AND database/init.sql, Event → Shift → Position wording).
---

## Standing rules (added in Phase 34.5, apply to every phase)

**CRITICAL SYSTEM DIRECTIVE: Starting immediately, upon the successful completion of any future phase or feature implementation, you must autonomously bump the version number in `frontend/package.json`, append a bulleted summary of changes to `CHANGELOG.md`, and update `README.md` if the architecture changed. Do not ask for permission to do this.**

How to follow it:
1. **Which number:** while pre-1.0 the version follows the phase: Phase N → `0.N.0`, Phase N.x → `0.N.x`; a third level (N.x.y) takes the next patch number. If the phase prompt names the version, use exactly that one.
2. **Both places, same number:** `frontend/package.json` → `"version"` AND `backend/src/version.py` → `APP_VERSION`. Admin → System warns when they differ.
3. **CHANGELOG.md:** add the new section at the TOP (under the intro), as `## [x.y.z] - YYYY-MM-DD - Phase N: title`, with bullets under Added / Changed / Fixed / Removed. Never edit older sections.
4. **README.md:** update it when the architecture, roles, rules, configuration or setup changed. Otherwise leave it.
5. Do this only after the phase's own changes are complete and verified, and include these files in your summary of changed files. The frontend container must be restarted to show a new version (Vite reads package.json at start).

The project rules that always apply are in README.md → "Working on the code" (no native PostgreSQL ENUMs, locked sign-in files, timezone-aware UTC, schema changes in models.py AND database/init.sql, Event → Shift → Position wording).

## Configuration rules (added in Phase 35.1, updated in 35.1.1; apply to every phase)
1. **Three settings files:** `.env` (ordinary settings, NO secrets), `.secrets/stack.env` (`POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `SECRET_KEY`, `SUPER_ADMIN_PASSWORD`, `TUNNEL_TOKEN`), `.secrets/integrations.env` (keys for outside services). `database`, `redis` and `cloudflared` read ONLY `stack.env`; the backend reads all three; the frontend reads none. Never add other `env_file` entries.
2. **Never put a secret in `${...}` in `docker-compose.yml`** (Compose reads `${...}` only from `.env`). Containers get secrets through `env_file`; if a command needs one, use the container's shell with `$$VAR`.
3. **A new setting** goes in `backend/src/config.py` AND in the right template: `.env.template` if it isn't secret, `.secrets/stack.env.template` if the stack needs it, `.secrets/integrations.env.template` for an outside service's key. Update the README Configuration table.
4. **Never read, print or commit real `.env` / `.secrets` contents.** Only templates hold example values.
5. **The frontend has no settings.** Don't add `VITE_` variables or Docker build args unless a phase explicitly asks; the Firebase web config comes from the backend (`GET /api/auth/firebase-config`).
6. **Don't touch `.secrets/*` in `.gitignore`** (ignoring `.secrets/` itself untracks the templates).
7. Changing settings needs `docker compose up -d --force-recreate`, NOT `down -v` (that deletes the database).
```

---

# PART B: Templates

## B1. REPLACE THE WHOLE FILE `.env.template`
No secrets in it any more.

```bash
# ==============================================================================
# ShiftBoard - ordinary settings (NO secrets in this file)          Phase 35.1.1
#
#   cp .env.template .env        then fill in real values. .env is ignored by git.
#
# Settings live in three files; each has a .template:
#   .env                          THIS file: ports, names, providers, addresses, on/off switches
#   .secrets/stack.env            stack secrets: database / Redis passwords, login signing key,
#                                 super-admin password, Cloudflare tunnel token
#   .secrets/integrations.env     outside-service keys: email, texts, push, file storage
# Docker Compose reads only these three. The backend gets all of them; the database, Redis and
# the tunnel get only .secrets/stack.env; the frontend gets nothing.
# Two more files stay in .secrets/ because they aren't KEY=VALUE text:
#   .secrets/firebase-web-config.js          (Firebase web config, see its .template)
#   .secrets/firebase_service_account.json   (Firebase service-account key, for FCM push)
#
# After changing any of them: docker compose up -d --force-recreate   (keeps your data)
# Placeholders look like your_value_here. Blank = off / use the default.
# Upgrading? Run scripts/consolidate_env.py once (see README).
# ==============================================================================

# ------------------------------------------------------------------------------
# Database (PostgreSQL)
# ------------------------------------------------------------------------------
POSTGRES_USER=shiftboard_user
# POSTGRES_PASSWORD is in .secrets/stack.env
POSTGRES_DB=shiftboard
# Port on YOUR computer (host). Containers always talk to each other on 5432.
POSTGRES_PORT=5432
# Connection pool (optional)
DB_POOL_SIZE=20
DB_MAX_OVERFLOW=10

# ------------------------------------------------------------------------------
# Redis
# ------------------------------------------------------------------------------
# REDIS_PASSWORD is in .secrets/stack.env
# Port on your computer (host).
REDIS_PORT=6379
# REDIS_URL is built by the backend from REDIS_PASSWORD. Don't set it here.

# ------------------------------------------------------------------------------
# Ports on your computer and the Cloudflare tunnel
# ------------------------------------------------------------------------------
PORT_BACKEND=8000
PORT_FRONTEND=80
# The Cloudflare tunnel token (TUNNEL_TOKEN) is in .secrets/stack.env

# ------------------------------------------------------------------------------
# Backend and sign-in
# ------------------------------------------------------------------------------
ENV=development
DEBUG=true
# SECRET_KEY (signs every login) is in .secrets/stack.env
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=1440
# The first Platform Admin, created on first start (the password is in .secrets/stack.env)
SUPER_ADMIN_USERNAME=demo_admin@shiftboard.com
# Comma-separated emails that are ALWAYS Platform Admins (can't be demoted or deleted)
ALWAYS_ADMIN_EMAILS=
# true = public "Create account" button (new people become Workers)
ALLOW_SELF_REGISTRATION=true
# true = the login page shows one-tap demo account buttons. Keep false anywhere public.
SHOW_DEMO_LOGINS=false

# ------------------------------------------------------------------------------
# Firebase (sign-in with Google etc., and phone / browser push)
# ------------------------------------------------------------------------------
# true = demo mode ("Sign in with Google (Demo)"), no real Firebase
USE_MOCK_FIREBASE=false
# Blank = discover the sign-in methods enabled in the Firebase Console. Or a comma-separated
# list of: password, google.com, microsoft.com, apple.com, github.com, facebook.com, twitter.com, yahoo.com
FIREBASE_AUTH_PROVIDERS=
# Paths INSIDE the backend container (.secrets/ is mounted at /app/secrets). Leave as they are.
FIREBASE_WEB_CONFIG_PATH=/app/secrets/firebase-web-config.js
FIREBASE_CREDENTIALS_PATH=/app/secrets/firebase_service_account.json
# Firebase Console > Project settings > Cloud Messaging > Web Push certificates > Key pair.
# This is the PUBLIC key (browsers get it), so it lives here. With it, the service-account file and
# messagingSenderId/appId in the web config, push goes through Firebase Cloud Messaging.
# Otherwise ShiftBoard's own Web Push is used.
FIREBASE_VAPID_KEY=

# ------------------------------------------------------------------------------
# ShiftBoard's own Web Push (used when FCM isn't set up)
# ------------------------------------------------------------------------------
# VAPID_PRIVATE_KEY (optional) is in .secrets/integrations.env
# Optional contact, e.g. mailto:you@yourdomain.com (blank = APP_BASE_URL when it's https)
VAPID_SUBJECT=

# ------------------------------------------------------------------------------
# Notifications
# ------------------------------------------------------------------------------
# The public address of the site, used in links in emails, texts and invites
APP_BASE_URL=https://your-public-address.example.com
# The background worker (reminders, alerts, cover, waitlists, sending). Leave true.
NOTIFICATIONS_WORKER_ENABLED=true
# Hour (in each person's own time zone) of the daily "new shifts" email
NOTIFICATIONS_DIGEST_HOUR=9

# Email: console (only printed in the backend log) | smtp | resend
EMAIL_PROVIDER=console
EMAIL_FROM=ShiftBoard <no-reply@example.com>
SMTP_HOST=
SMTP_PORT=587
SMTP_STARTTLS=true
SMTP_SSL=false
# SMTP_USERNAME, SMTP_PASSWORD and RESEND_API_KEY are in .secrets/integrations.env

# Texts: off | console | twilio  (only urgent messages are ever texted)
SMS_PROVIDER=off
TWILIO_FROM_NUMBER=
# TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are in .secrets/integrations.env

# ------------------------------------------------------------------------------
# Cloudflare R2 file storage (reserved: the app reads these but doesn't upload to R2 yet)
# ------------------------------------------------------------------------------
R2_ACCOUNT_ID=
# R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are in .secrets/integrations.env
R2_BUCKET_NAME=shiftboard-media
R2_S3_ENDPOINT_URL=
R2_PUBLIC_URL_PREFIX=

# ------------------------------------------------------------------------------
# Frontend
# ------------------------------------------------------------------------------
# None. The web app reads no VITE_ variables: it calls /api on its own address (Vite
# forwards it to the backend), and the Firebase web config comes from the backend at
# runtime (GET /api/auth/firebase-config), read from .secrets/firebase-web-config.js.
```

---

## B2. NEW FILE `.secrets/stack.env.template`

```bash
# ==============================================================================
# ShiftBoard - stack secrets                                         Phase 35.1.1
#
#   cp .secrets/stack.env.template .secrets/stack.env     (ignored by git)
#
# Read by: database, redis, cloudflared and backend. Nothing else goes in here: outside-service
# keys (email, texts, push, R2) belong in .secrets/integrations.env, so these containers never
# see them. Ordinary settings belong in the root .env.
# After changing it: docker compose up -d --force-recreate   (keeps your data)
# ==============================================================================

# PostgreSQL password. Only used the FIRST time the database volume is created; changing it
# later doesn't change the database's password (the backend would then fail to connect).
POSTGRES_PASSWORD=your_postgres_password_here

# Redis password (required: Redis won't start without it)
REDIS_PASSWORD=your_redis_password_here

# Signs every login token (JWT). A long random string, for example the output of:
#   python -c "import secrets; print(secrets.token_urlsafe(48))"
# Changing it signs everyone out once. If it's missing, a built-in public key is used: never do that.
SECRET_KEY=your_long_random_secret_here

# Password of the first Platform Admin (SUPER_ADMIN_USERNAME in .env)
SUPER_ADMIN_PASSWORD=your_admin_password_here

# Cloudflare Zero Trust > Networks > Tunnels > your tunnel > the token after --token.
# cloudflared reads this name (TUNNEL_TOKEN) by itself.
TUNNEL_TOKEN=your_tunnel_token_here
```

---

## B3. NEW FILE `.secrets/integrations.env.template`

```bash
# ==============================================================================
# ShiftBoard - keys for outside services                             Phase 35.1.1
#
#   cp .secrets/integrations.env.template .secrets/integrations.env     (ignored by git)
#
# Read by the backend ONLY (the database, Redis and the tunnel never get these).
# Blank = that service is off. Which service is used is set in the root .env
# (EMAIL_PROVIDER, SMS_PROVIDER, ...); the matching keys go here.
# After changing it: docker compose up -d --force-recreate   (keeps your data)
# ==============================================================================

# Email over SMTP (EMAIL_PROVIDER=smtp; SMTP_HOST / SMTP_PORT are in .env)
SMTP_USERNAME=
SMTP_PASSWORD=
# Email through Resend (EMAIL_PROVIDER=resend)
RESEND_API_KEY=

# Texts through Twilio (SMS_PROVIDER=twilio; TWILIO_FROM_NUMBER is in .env)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=

# ShiftBoard's own Web Push: optional fixed private key (PEM or base64url).
# Blank = generated once and kept in the database.
VAPID_PRIVATE_KEY=

# Cloudflare R2 file storage (reserved: not used by the app yet; R2_ACCOUNT_ID etc. are in .env)
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
```

---

## B4. DELETE `.secrets/.secrets.env.template`
`git rm .secrets/.secrets.env.template`. It's replaced by B2 and B3.

---

## B5. `backend/.env.template` (EDIT)

**Edit 1.** Find:
```bash
# ShiftBoard - backend settings for running the API OUTSIDE Docker (local uvicorn)
#
# With Docker you don't need this file: docker compose gives the backend everything
# from the root .env (see /.env.template, which documents every setting).
#
# Local run, from the backend/ folder:
```
Replace with:
```bash
# ShiftBoard - backend settings for running the API OUTSIDE Docker (local uvicorn)
#
# With Docker you don't need this file: docker compose gives the backend .env,
# .secrets/stack.env and .secrets/integrations.env (their templates document every setting).
#
# Local run, from the backend/ folder:
```

---

# PART C: Script

## C1. REPLACE THE WHOLE FILE `scripts/consolidate_env.py`

```python
#!/usr/bin/env python3
"""
Phase 35.1.1: sort ShiftBoard's settings into its three settings files.

    .env                        ordinary settings, no secrets
    .secrets/stack.env          stack secrets (database, Redis, tunnel, backend read it)
    .secrets/integrations.env   outside-service keys (only the backend reads it)

Works from any earlier layout:
    0.35.0 and older   .env + backend/.env + frontend/.env + .secrets/.secrets.env
    0.35.1             everything in the root .env
It keeps exactly the values the running app uses, puts each one in the right file, and renames
the old files to <name>.pre-0.35.2.bak so nothing is lost (git ignores them).

It NEVER prints a value, only setting names and which file each came from / goes to.

    python scripts/consolidate_env.py            # dry run: shows what it would do, changes nothing
    python scripts/consolidate_env.py --apply    # writes the three files and renames the old ones
    python scripts/consolidate_env.py --undo     # puts the old files back
    python scripts/consolidate_env.py --source .env.old.env   # read the root settings from another file

Template placeholders (your_..._here) are never carried over: the script refuses to --apply
while a secret the stack needs is still a placeholder.

Run it from the repository root (the folder with docker-compose.yml). Needs Python 3.8+ only.
No Python on this computer? Use Docker:
    docker run --rm -v "${PWD}:/work" -w /work python:3.11-slim python scripts/consolidate_env.py --apply

Which value wins (what 0.35.0 / 0.35.1 actually used):
  * Values that docker-compose.yml substituted with ${...} (database / Redis passwords, ports,
    super-admin login, tunnel token) came ONLY from the root .env. So the root .env value wins.
    If the root .env didn't have it, Compose's built-in default was used: the same default is
    kept (written out where the new layout needs it), unless Compose had no default, in which
    case the value from the other files is used and flagged CHECK IT.
  * Everything else reached the backend through env_file, where the later file won:
    .secrets/.secrets.env  >  backend/.env  >  root .env.
  * DATABASE_URL, REDIS_URL and POSTGRES_HOST are built for you now: dropped.
  * CLOUDFLARE_TUNNEL_TOKEN is renamed TUNNEL_TOKEN (the name cloudflared reads by itself).
  * frontend/.env: the web app reads no settings, so nothing is taken from it.
"""
import argparse
import os
import re
import sys
from pathlib import Path

SUFFIX = ".pre-0.35.2.bak"
ROOT_ENV = Path(".env")
STACK = Path(".secrets/stack.env")
INTEGRATIONS = Path(".secrets/integrations.env")
SOURCES = [  # lowest priority first (env_file order before 0.35.1; later wins)
    ("root .env", Path(".env")),
    ("backend/.env", Path("backend/.env")),
    (".secrets/.secrets.env", Path(".secrets/.secrets.env")),
]
FRONTEND = Path("frontend/.env")
RETIRE = [Path("backend/.env"), FRONTEND, Path(".secrets/.secrets.env")]

# ${...} in the old docker-compose.yml -> their compose default (None = no default)
INTERPOLATED = {
    "POSTGRES_USER": "shiftboard_user",
    "POSTGRES_PASSWORD": None,
    "POSTGRES_DB": "shiftboard",
    "POSTGRES_PORT": "5432",
    "REDIS_PASSWORD": "shiftboard_redis_pass",
    "REDIS_PORT": "6379",
    "PORT_BACKEND": "8000",
    "PORT_FRONTEND": "80",
    "SUPER_ADMIN_USERNAME": "demo_admin@shiftboard.com",
    "SUPER_ADMIN_PASSWORD": "SuperSecretDemo123!",
    "CLOUDFLARE_TUNNEL_TOKEN": None,
}
# Defaults that must be written out because the new layout has no fallback for them
WRITE_DEFAULT = {"REDIS_PASSWORD"}
COMPUTED = {"DATABASE_URL", "REDIS_URL", "POSTGRES_HOST"}
RENAMED = {"CLOUDFLARE_TUNNEL_TOKEN": "TUNNEL_TOKEN"}

STACK_KEYS = ["POSTGRES_PASSWORD", "REDIS_PASSWORD", "SECRET_KEY", "SUPER_ADMIN_PASSWORD", "TUNNEL_TOKEN"]
INTEGRATION_KEYS = ["SMTP_USERNAME", "SMTP_PASSWORD", "RESEND_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN",
                    "VAPID_PRIVATE_KEY", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]

# The layout of the new .env (same order as .env.template); no secrets
SECTIONS = [
    ("Database (PostgreSQL)", ["POSTGRES_USER", "POSTGRES_DB", "POSTGRES_PORT", "DB_POOL_SIZE", "DB_MAX_OVERFLOW"]),
    ("Redis", ["REDIS_PORT"]),
    ("Ports on your computer", ["PORT_BACKEND", "PORT_FRONTEND"]),
    ("Backend and sign-in", ["ENV", "DEBUG", "JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "SUPER_ADMIN_USERNAME",
                             "ALWAYS_ADMIN_EMAILS", "ALLOW_SELF_REGISTRATION", "SHOW_DEMO_LOGINS"]),
    ("Firebase", ["USE_MOCK_FIREBASE", "FIREBASE_AUTH_PROVIDERS", "FIREBASE_WEB_CONFIG_PATH",
                  "FIREBASE_CREDENTIALS_PATH", "FIREBASE_VAPID_KEY"]),
    ("ShiftBoard's own Web Push", ["VAPID_SUBJECT"]),
    ("Notifications", ["APP_BASE_URL", "NOTIFICATIONS_WORKER_ENABLED", "NOTIFICATIONS_DIGEST_HOUR",
                       "EMAIL_PROVIDER", "EMAIL_FROM", "SMTP_HOST", "SMTP_PORT", "SMTP_STARTTLS", "SMTP_SSL",
                       "SMS_PROVIDER", "TWILIO_FROM_NUMBER"]),
    ("Cloudflare R2 (reserved: not used by the app yet)", ["R2_ACCOUNT_ID", "R2_BUCKET_NAME", "R2_S3_ENDPOINT_URL",
                                                          "R2_PUBLIC_URL_PREFIX"]),
]
KNOWN_PLAIN = {k for _, keys in SECTIONS for k in keys}
# Read by nothing in ShiftBoard 0.35.x. Kept (so nothing is lost) in their own section.
UNUSED = {
    "JWT_SECRET_KEY": "not used: logins are signed with SECRET_KEY",
    "JWT_ALGORITHM": "not used: always HS256",
    "ALGORITHM": "not used: always HS256",
    "CORS_ORIGINS": "not used: the allowed origins are set in backend/src/main.py",
    "FIREBASE_PROJECT_ID": "not used: the project comes from .secrets/firebase-web-config.js",
    "DEFAULT_GEOFENCE_RADIUS_METERS": "not used: each venue sets its own clock-in area",
    "PORT": "not used in Docker",
    "PROJECT_NAME": "not used", "ENVIRONMENT": "not used (ENV is)", "LOG_LEVEL": "not used",
    "APP_DOMAIN": "not used", "CLOUDFLARE_TUNNEL_ID": "not used (the tunnel runs with TUNNEL_TOKEN)",
}
PLACEHOLDER = re.compile(r"^[\"']?your_[A-Za-z0-9_]*_here[\"']?$")
SECRET_WORDS = re.compile(r"(PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE|_KEY$|_SID$|CREDENTIAL)")

KEY_RE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$")


def parse(path: Path):
    """KEY -> raw value text exactly as written (quotes kept). Later duplicates win, like Compose.
    Multi-line values in double or single quotes are kept whole. Returns (values, problems)."""
    values, problems = {}, []
    if not path.exists():
        return values, problems
    lines = path.read_text(encoding="utf-8-sig").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        i += 1
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        m = KEY_RE.match(line)
        if not m:
            problems.append(f"{path}: line {i} isn't KEY=VALUE, skipped")
            continue
        key, raw = m.group(1), m.group(2).strip()
        if raw[:1] in ('"', "'"):
            q = raw[0]
            body = raw[1:]
            closed = re.search(r"(?<!\\)" + re.escape(q), body) if q == '"' else (q in body)
            if not closed:  # multi-line quoted value
                start = i
                buf = [raw]
                while i < len(lines):
                    buf.append(lines[i])
                    i += 1
                    if (re.search(r"(?<!\\)" + re.escape(q), lines[i - 1]) if q == '"' else q in lines[i - 1]):
                        break
                else:
                    problems.append(f"{path}: {key} starts a quoted value on line {start} that never closes; skipped")
                    continue
                raw = "\n".join(buf)
        values[key] = raw
    return values, problems


def is_blank(raw):
    return raw is None or raw.strip().strip('"').strip("'").strip() == ""


def plan():
    files = {label: parse(p) for label, p in SOURCES}
    placeholders = set()
    for label, (values, _) in files.items():
        for k, v in list(values.items()):
            if PLACEHOLDER.match(v.strip()):
                placeholders.add(k)
                del values[k]
    fe_values, fe_problems = parse(FRONTEND)
    problems = [p for _, (_, probs) in files.items() for p in probs] + fe_problems
    root_label = SOURCES[0][0]
    root = files[root_label][0]
    merged, origin, notes = {}, {}, []

    all_keys = []
    for label, _ in SOURCES:
        for k in files[label][0]:
            if k not in all_keys:
                all_keys.append(k)

    for key in all_keys:
        where = [(label, files[label][0][key]) for label, _ in SOURCES if key in files[label][0]]
        if key in COMPUTED:
            notes.append(f"{key}: dropped (built for you now)")
            continue
        if key in INTERPOLATED:
            others = [l for l, v in where if l != root_label and not is_blank(v)]
            root_blank = key in root and is_blank(root[key])
            if key in root and root_blank and INTERPOLATED[key] is None and others:
                label = others[-1]
                merged[key], origin[key] = files[label][0][key], label
                notes.append(f"{key}: empty in the root .env; taken from {label}. CHECK IT: Docker was not using it before.")
            elif key in root and not (root_blank and INTERPOLATED[key] is not None):
                merged[key], origin[key] = root[key], root_label
                differs = [l for l, v in where if l != root_label and v != root[key]]
                if differs:
                    notes.append(f"{key}: kept the root .env value (the one Docker used); a different value in "
                                 f"{', '.join(differs)} was never used and is dropped")
            elif INTERPOLATED[key] is not None:
                if others:
                    notes.append(f"{key}: not set in the root .env, so Docker used its built-in default; the value in "
                                 f"{', '.join(others)} was never used. Kept the default.")
            elif others:
                label = others[-1]
                merged[key], origin[key] = files[label][0][key], label
                notes.append(f"{key}: not in the root .env; taken from {label}. CHECK IT: Docker was not using it before.")
            continue
        label, value = where[-1]  # later file wins
        merged[key], origin[key] = value, label
        losers = [l for l, v in where[:-1] if v != value]
        if losers:
            notes.append(f"{key}: {label} wins over {', '.join(losers)} (same as before)")

    # Defaults the new layout needs written out
    for key in WRITE_DEFAULT:
        if key not in merged:
            merged[key], origin[key] = INTERPOLATED[key], "built-in default"
            notes.append(f"{key}: Docker was using the built-in default; written out so Redis keeps the same "
                         f"password. Consider changing it in .secrets/stack.env (then recreate the containers).")
    # Renames
    for old, new in RENAMED.items():
        if old in merged:
            if new in merged:
                notes.append(f"{old}: {new} is also set; kept {new}")
                merged.pop(old)
                origin.pop(old)
            else:
                merged[new] = merged.pop(old)
                origin[new] = origin.pop(old)
                notes.append(f"{old}: renamed {new} (cloudflared reads that name by itself)")

    if is_blank(merged.get("SECRET_KEY")):
        extra = " (only JWT_SECRET_KEY, which ShiftBoard doesn't read)" if not is_blank(merged.get("JWT_SECRET_KEY")) else ""
        notes.append(f"WARNING SECRET_KEY is not set{extra}: logins are signed with the built-in public fallback "
                     "key. Set SECRET_KEY in .secrets/stack.env to a long random value; everyone is signed out once.")
    if is_blank(merged.get("POSTGRES_PASSWORD")):
        notes.append("WARNING POSTGRES_PASSWORD is not set anywhere: the backend can't reach the database.")
    if is_blank(merged.get("TUNNEL_TOKEN")):
        notes.append("WARNING TUNNEL_TOKEN is not set: the Cloudflare tunnel won't connect.")
    if placeholders:
        notes.append("WARNING still template placeholders (your_..._here), not carried over: " + ", ".join(sorted(placeholders)))
    fe_keys = sorted(fe_values)
    if fe_keys:
        notes.append(f"frontend/.env: {', '.join(fe_keys)} not carried over (the web app reads no settings)")
    return merged, origin, notes, problems, placeholders


def destination(key):
    if key in STACK_KEYS:
        return "stack"
    if key in INTEGRATION_KEYS:
        return "integrations"
    if key in KNOWN_PLAIN:
        return "env"
    # Unknown or unused: anything that looks secret goes to the backend-only file
    return "integrations" if SECRET_WORDS.search(key) else "env"


HEADERS = {
    "env": ["ShiftBoard: ordinary settings (NO secrets). Explained in .env.template."],
    "stack": ["ShiftBoard: stack secrets. Read by database, redis, cloudflared and backend.",
              "Explained in .secrets/stack.env.template."],
    "integrations": ["ShiftBoard: keys for outside services. Read by the backend only.",
                     "Explained in .secrets/integrations.env.template."],
}


def render(merged, which):
    out = ["# ==============================================================================",
           *[f"# {h}" for h in HEADERS[which]],
           "# Made by scripts/consolidate_env.py (your old files are kept as *.pre-0.35.2.bak).",
           "# After changing it: docker compose up -d --force-recreate   (keeps your data)",
           "# =============================================================================="]
    keys = [k for k in merged if destination(k) == which]
    done = set()
    if which == "env":
        for title, section in SECTIONS:
            present = [k for k in section if k in merged]
            if present:
                out += ["", f"# --- {title}"] + [f"{k}={merged[k]}" for k in present]
                done.update(present)
    else:
        order = STACK_KEYS if which == "stack" else INTEGRATION_KEYS
        present = [k for k in order if k in merged]
        if present:
            out += [""] + [f"{k}={merged[k]}" for k in present]
            done.update(present)
    other = [k for k in keys if k not in done and k not in UNUSED]
    unused = [k for k in keys if k not in done and k in UNUSED]
    if other:
        out += ["", "# --- Other settings kept from your old files (not in the templates)"]
        out += [f"{k}={merged[k]}" for k in other]
    if unused:
        out += ["", "# --- Not read by ShiftBoard (kept so nothing is lost; safe to delete)"]
        for k in unused:
            out += [f"# {UNUSED[k]}", f"{k}={merged[k]}"]
    return "\n".join(out) + "\n"


def write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    print(f"wrote {path}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--apply", action="store_true", help="write the three files and rename the old ones")
    ap.add_argument("--undo", action="store_true", help="restore the files renamed by --apply")
    ap.add_argument("--source", help="read the root settings from this file instead of .env "
                                     "(it is renamed to <file>.pre-0.35.2.bak on --apply)")
    args = ap.parse_args()
    global SOURCES
    source = Path(args.source) if args.source else ROOT_ENV
    if args.source:
        if not source.exists():
            sys.exit(f"{source} doesn't exist. Nothing changed.")
        SOURCES = [(f"{source}", source)] + SOURCES[1:]
    if not Path("docker-compose.yml").exists():
        sys.exit("Run this from the repository root (the folder with docker-compose.yml).")

    if args.undo:
        restored = 0
        extra = [p.with_name(p.name[:-len(SUFFIX)]) for p in Path(".").glob("*" + SUFFIX)
                 if p.name != ROOT_ENV.name + SUFFIX and ".undone" not in p.name]
        for p in [ROOT_ENV] + RETIRE + extra:
            bak = p.with_name(p.name + SUFFIX)
            if bak.exists():
                os.replace(bak, p)
                print(f"restored {p}")
                restored += 1
        if restored:
            for p in (STACK, INTEGRATIONS):
                if p.exists():
                    os.replace(p, p.with_name(p.name + ".undone" + SUFFIX))
                    print(f"moved {p} aside -> {p}.undone{SUFFIX}")
        print("Nothing to undo." if not restored else "Done. Recreate the containers after restoring the matching code.")
        return

    existing = [str(p) for p in [ROOT_ENV] + RETIRE if p.with_name(p.name + SUFFIX).exists()]
    existing += [str(p) for p in (STACK, INTEGRATIONS) if p.exists()]
    if existing:
        sys.exit("Already split: " + ", ".join(existing) + " exist(s). Nothing changed. "
                 "Use --undo first to start over.")
    if not any(p.exists() for _, p in SOURCES):
        sys.exit("No settings files found (.env, backend/.env, .secrets/.secrets.env). Copy the three "
                 ".template files instead (.env.template, .secrets/stack.env.template, .secrets/integrations.env.template).")

    merged, origin, notes, problems, placeholders = plan()
    names = {"env": ".env", "stack": str(STACK), "integrations": str(INTEGRATIONS)}
    for which, name in names.items():
        keys = [k for k in merged if destination(k) == which]
        print(f"{name}: {len(keys)} settings" + (f": {', '.join(sorted(keys))}" if keys else ""))
    for label in [l for l, _ in SOURCES] + ["built-in default"]:
        keys = sorted(k for k, o in origin.items() if o == label)
        if keys:
            print(f"  values from {label}: {', '.join(keys)}")
    for n in notes + problems:
        print(("! " if n.startswith("WARNING") or "CHECK" in n else "- ") + n)
    moved = sorted(k for k in merged if destination(k) == "integrations" and k not in INTEGRATION_KEYS and k not in UNUSED)
    if moved:
        print("! " + ", ".join(moved) + ": not a known setting but looks secret, so it goes in "
              ".secrets/integrations.env (backend only). CHECK IT.")

    blocking = sorted(k for k in placeholders if k in ("POSTGRES_PASSWORD", "SECRET_KEY", "REDIS_PASSWORD")
                      and is_blank(merged.get(k)))
    if blocking:
        print(f"\n! {', '.join(blocking)} only exist as template placeholders in {source}. It looks like a copy of "
              ".env.template, not your real settings. Nothing changed. If your real settings are in another file, "
              "run again with --source <that file>.")
        sys.exit(1)
    if not args.apply:
        print("\nDry run: nothing changed. Run again with --apply to write the files and rename the old ones.")
        return

    contents = {w: render(merged, w) for w in names}
    for p in dict.fromkeys([source, ROOT_ENV]):
        if p.exists():
            os.replace(p, p.with_name(p.name + SUFFIX))
            print(f"renamed {p} -> {p}{SUFFIX}")
    for p in RETIRE:
        if p.exists():
            os.replace(p, p.with_name(p.name + SUFFIX))
            print(f"renamed {p} -> {p}{SUFFIX}")
    write(ROOT_ENV, contents["env"])
    write(STACK, contents["stack"])
    write(INTEGRATIONS, contents["integrations"])
    print("\nDone. Check with:  docker compose config --quiet   (prints nothing when it's fine)\n"
          "Then recreate the containers (keeps your data):  docker compose up -d --build --force-recreate")


if __name__ == "__main__":
    main()
```

---

# PART V: Version, changelog & README (the standing directive, done for you)

## V1. `frontend/package.json` (EDIT)

**Edit 1.** Find:
```json
  "name": "shiftboard-frontend",
  "private": true,
  "version": "0.35.1",
  "type": "module",
  "scripts": {
```
Replace with:
```json
  "name": "shiftboard-frontend",
  "private": true,
  "version": "0.35.2",
  "type": "module",
  "scripts": {
```

---

## V2. `backend/src/version.py` (EDIT)

**Edit 1.** Find:
```python
container is still running an old build.
"""
APP_VERSION = "0.35.1"
```
Replace with:
```python
container is still running an old build.
"""
APP_VERSION = "0.35.2"
```

---

## V3. `CHANGELOG.md` (EDIT)
The new section goes above `[0.35.1]`.

**Edit 1.** Find:
```markdown

The newest version goes at the top. Each entry uses a `## [x.y.z] - YYYY-MM-DD - Phase N: title` heading, followed by bullets under **Added / Changed / Fixed / Removed**.

## [0.35.1] - 2026-09-28 - Phase 35.1: One settings file
```
Replace with:
```markdown

The newest version goes at the top. Each entry uses a `## [x.y.z] - YYYY-MM-DD - Phase N: title` heading, followed by bullets under **Added / Changed / Fixed / Removed**.

## [0.35.2] - 2026-09-28 - Phase 35.1.1: Secrets out of .env

### Changed
- **Settings are split into three files:**
  - `.env`: ordinary settings, no secrets
  - `.secrets/stack.env`: `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `SECRET_KEY`, `SUPER_ADMIN_PASSWORD`, `TUNNEL_TOKEN`
  - `.secrets/integrations.env`: SMTP / Resend, Twilio, `VAPID_PRIVATE_KEY`, R2 keys
- **Who reads what:** `database`, `redis` and `cloudflared` read only `stack.env`, so they never see integration keys. The backend reads all three; the frontend reads nothing.
- **No secret goes through `${...}` in `docker-compose.yml` any more**, which is what forced secrets into `.env` in 0.35.1:
  - Postgres reads `POSTGRES_PASSWORD` from its env file.
  - Redis gets its password in its own start command, and refuses to start without one.
  - cloudflared reads `TUNNEL_TOKEN` by itself (renamed from `CLOUDFLARE_TUNNEL_TOKEN`).
- The backend builds `REDIS_URL` from `REDIS_PASSWORD` (URL-encoded) unless `REDIS_URL` is set (`backend/src/config.py`). It already built the database address from `POSTGRES_*`. Compose no longer passes `DATABASE_URL` / `REDIS_URL` / `SUPER_ADMIN_*`.
- `scripts/consolidate_env.py` now sorts settings into the three files, from either the 0.35.0 or the 0.35.1 layout. Unknown settings that look secret go to `integrations.env`. Backups are named `*.pre-0.35.2.bak`, and `--undo` restores them.
- Templates: `.env.template` has no secrets; new `.secrets/stack.env.template` and `.secrets/integrations.env.template`.
- `.gitignore`: also ignores `*.bak`.

### Removed
- `.secrets/.secrets.env.template` (replaced by the two new templates).

## [0.35.1] - 2026-09-28 - Phase 35.1: One settings file
```

---

## V4. `README.md` (EDITS)
Infrastructure row, Running → step 1, and the Configuration section.

**Edit 1.** Find:
```markdown
| **Backend** | Python 3.11, FastAPI, SQLAlchemy 2 (async, `asyncpg`), Pydantic v2, passlib[bcrypt], python-jose, firebase-admin, pywebpush / py-vapid, redis |
| **Data** | PostgreSQL 16 (schema in `database/init.sql`), Redis 7 |
| **Infrastructure** | Docker Compose (`database`, `redis`, `backend`, `frontend`, `cloudflared`). All settings come from the root `.env` (git-ignored). `.secrets/` (git-ignored) holds the Firebase files and is mounted read-only into the backend. |

The frontend container runs the Vite dev server with hot reload. Vite proxies `/api` to `backend:8000`, and the Cloudflare tunnel points at the frontend.
```
Replace with:
```markdown
| **Backend** | Python 3.11, FastAPI, SQLAlchemy 2 (async, `asyncpg`), Pydantic v2, passlib[bcrypt], python-jose, firebase-admin, pywebpush / py-vapid, redis |
| **Data** | PostgreSQL 16 (schema in `database/init.sql`), Redis 7 |
| **Infrastructure** | Docker Compose (`database`, `redis`, `backend`, `frontend`, `cloudflared`). Settings: `.env` (no secrets), `.secrets/stack.env` and `.secrets/integrations.env` (all git-ignored). `.secrets/` also holds the Firebase files and is mounted read-only into the backend. |

The frontend container runs the Vite dev server with hot reload. Vite proxies `/api` to `backend:8000`, and the Cloudflare tunnel points at the frontend.
```

**Edit 2.** Find:
```markdown

```bash
# 1. Settings: ONE file (copy the template, then fill in real values)
cp .env.template .env
cp .secrets/firebase-web-config.js.template .secrets/firebase-web-config.js   # for real Firebase sign-in

```
Replace with:
```markdown

```bash
# 1. Settings: three files (copy the templates, then fill in real values)
cp .env.template .env
cp .secrets/stack.env.template .secrets/stack.env
cp .secrets/integrations.env.template .secrets/integrations.env
cp .secrets/firebase-web-config.js.template .secrets/firebase-web-config.js   # for real Firebase sign-in

```

**Edit 3.** Find:
```markdown

## 7. Configuration
**One file:** since 0.35.1 every setting lives in the root **`.env`** (git-ignored). `.env.template` lists and explains every setting.
* Docker Compose reads only that file. The backend gets all of it; `database`, `redis` and `cloudflared` get just the values they need through `${...}` in `docker-compose.yml`.
* `DATABASE_URL`, `REDIS_URL` and `POSTGRES_HOST` are built by `docker-compose.yml`. `POSTGRES_PORT` / `REDIS_PORT` are only the ports on your computer; containers always use 5432 / 6379.
* After changing `.env`: `docker compose up -d --force-recreate` (keeps your data).
* **Two files stay in `.secrets/`** because they aren't `KEY=VALUE` text: `firebase-web-config.js` (Firebase web config, sent to the browser by the backend) and `firebase_service_account.json` (FCM push).
* **The frontend needs no settings.** It reads no `VITE_` variables: it calls `/api` on its own address (Vite forwards it to the backend) and gets the Firebase web config from the backend at runtime.
* **Other templates:** `backend/.env.template` is for running the API outside Docker (local `uvicorn`); `.secrets/.secrets.env.template` is a secrets-only example for bare-metal servers. Docker never reads `backend/.env`, `frontend/.env` or `.secrets/.secrets.env`.
* **Upgrading from 0.35.0 or older** (settings spread over `.env`, `backend/.env`, `frontend/.env`, `.secrets/.secrets.env`): run `python scripts/consolidate_env.py` (dry run, prints setting names only), then `--apply`. It writes the new `.env` with the values the app was really using and renames the old files to `*.pre-0.35.1.bak`. `--undo` puts them back.

The main settings:

| Area | Settings |
| :--- | :--- |
| Database / Redis | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `REDIS_PASSWORD` |
| Sign-in | `SECRET_KEY` (signs every login; must be set), `JWT_ACCESS_TOKEN_EXPIRE_MINUTES`, `SUPER_ADMIN_USERNAME`, `SUPER_ADMIN_PASSWORD`, `ALWAYS_ADMIN_EMAILS`, `ALLOW_SELF_REGISTRATION`, `SHOW_DEMO_LOGINS` |
| Firebase | `USE_MOCK_FIREBASE`, `FIREBASE_CREDENTIALS_PATH` (`.secrets/firebase_service_account.json`), `FIREBASE_WEB_CONFIG_PATH` (`.secrets/firebase-web-config.js`), `FIREBASE_AUTH_PROVIDERS`, `FIREBASE_VAPID_KEY` (push through FCM) |
| Links | `APP_BASE_URL`: the public address used in emails, texts and invites |
```
Replace with:
```markdown

## 7. Configuration
**Three files** (since 0.35.2), all git-ignored, each with a `.template` that explains every setting:

| File | Holds | Read by |
| :--- | :--- | :--- |
| `.env` | ordinary settings, **no secrets**: ports, names, providers, addresses, switches | `backend` (and `${...}` in `docker-compose.yml`) |
| `.secrets/stack.env` | stack secrets: `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `SECRET_KEY`, `SUPER_ADMIN_PASSWORD`, `TUNNEL_TOKEN` | `database`, `redis`, `cloudflared`, `backend` |
| `.secrets/integrations.env` | outside-service keys: SMTP / Resend, Twilio, `VAPID_PRIVATE_KEY`, R2 keys | `backend` only |

* So the database, Redis and the tunnel never see email, text or storage keys; the frontend gets nothing.
* **Secrets are never written as `${...}` in `docker-compose.yml`** (Compose would only look for them in `.env`). Each container reads them from its `env_file`; Redis reads its password in its own start command.
* The backend builds the database and Redis addresses itself (`backend/src/config.py`). `POSTGRES_PORT` / `REDIS_PORT` are only the ports on your computer; containers always use 5432 / 6379.
* After changing any of them: `docker compose up -d --force-recreate` (keeps your data).
* **Two files stay in `.secrets/`** because they aren't `KEY=VALUE` text: `firebase-web-config.js` (Firebase web config, sent to the browser by the backend) and `firebase_service_account.json` (FCM push).
* **The frontend needs no settings.** It reads no `VITE_` variables: it calls `/api` on its own address (Vite forwards it to the backend) and gets the Firebase web config from the backend at runtime.
* **Other templates:** `backend/.env.template` is for running the API outside Docker (local `uvicorn`). Docker never reads `backend/.env`, `frontend/.env` or `.secrets/.secrets.env`.
* **Upgrading from 0.35.1 or older:** run `python scripts/consolidate_env.py` (dry run, prints setting names only), then `--apply`. It sorts your settings into the three files, keeps the values the app was really using, and renames the old files to `*.pre-0.35.2.bak`. `--undo` puts them back.

The main settings:

| Area | Settings |
| :--- | :--- |
| Database / Redis | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `REDIS_PASSWORD` |
| Sign-in | `SECRET_KEY` (signs every login; must be set; in `stack.env`), `JWT_ACCESS_TOKEN_EXPIRE_MINUTES`, `SUPER_ADMIN_USERNAME`, `SUPER_ADMIN_PASSWORD`, `ALWAYS_ADMIN_EMAILS`, `ALLOW_SELF_REGISTRATION`, `SHOW_DEMO_LOGINS` |
| Firebase | `USE_MOCK_FIREBASE`, `FIREBASE_CREDENTIALS_PATH` (`.secrets/firebase_service_account.json`), `FIREBASE_WEB_CONFIG_PATH` (`.secrets/firebase-web-config.js`), `FIREBASE_AUTH_PROVIDERS`, `FIREBASE_VAPID_KEY` (push through FCM) |
| Links | `APP_BASE_URL`: the public address used in emails, texts and invites |
```

**Edit 4.** Find:
```markdown
| Background worker | `NOTIFICATIONS_WORKER_ENABLED` (default `true`), `NOTIFICATIONS_DIGEST_HOUR` |
| Files | `R2_*` (Cloudflare R2; reserved, not used by the app yet) |
| Tunnel | `CLOUDFLARE_TUNNEL_TOKEN` |

Admin → System shows what's configured, what's missing and whether the background worker is running.
```
Replace with:
```markdown
| Background worker | `NOTIFICATIONS_WORKER_ENABLED` (default `true`), `NOTIFICATIONS_DIGEST_HOUR` |
| Files | `R2_*` (Cloudflare R2; reserved, not used by the app yet) |
| Tunnel | `TUNNEL_TOKEN` (in `stack.env`; was `CLOUDFLARE_TUNNEL_TOKEN`) |

Admin → System shows what's configured, what's missing and whether the background worker is running.
```

---

# PART S: Split Andrew's settings into the three files (run AFTER Parts A–V)

From the repository root. **Never open any real settings file.** If `python` isn't available, run each `python ...` command as `docker run --rm -v "${PWD}:/work" -w /work python:3.11-slim python ...` instead.

1. **Is `.env` just a copy of the template?** Run:
   ```bash
   git diff --no-index --quiet .env .env.template
   ```
   It prints nothing. Exit code **0** = identical (a template copy); **1** = different. Also note whether `.env.old.env` exists (a directory listing only; don't open it).
2. **Dry run:**
   * If step 1 gave **0** and `.env.old.env` exists: `python scripts/consolidate_env.py --source .env.old.env`
   * Otherwise: `python scripts/consolidate_env.py`

   **Copy the output into your report to Andrew, word for word** (names only). If it ends with *"only exist as template placeholders … Nothing changed"*, or anything else is unclear, **STOP here** and report. Don't guess at a source file.
3. **Apply:** the same command plus `--apply`. It writes `.env`, `.secrets/stack.env` and `.secrets/integrations.env`, and renames what it replaced to `*.pre-0.35.2.bak`.
4. **Check:** `docker compose config --quiet` must print **nothing** and exit 0. If not: `python scripts/consolidate_env.py --undo` and report the error text (never file contents).
5. **Check git:** `git status --short` must list no `.env`, `.bak`, `stack.env`, `integrations.env` or other `.secrets/` file except templates.
6. **Stop.** Don't start, stop, restart or rebuild anything.

---

# PART R: For Andrew: rebuild & checklist

**Read the script's `!` lines first.** In particular:
* ***SECRET_KEY is not set*** means logins were signed with the built-in public key. Put a long random `SECRET_KEY` in `.secrets/stack.env`; everyone is signed out once.
* ***REDIS_PASSWORD … built-in default*** means Redis was using the default password from the code. Change it in `.secrets/stack.env` whenever you like: nothing stores it, so a recreate is all it takes.
* ***CHECK IT*** lines mean a value Docker didn't use before will be used now.

**Rebuild (keeps your data, no `-v`):**
```bash
docker compose up -d --build --force-recreate
```

### Checklist
1. `docker compose ps`: all five services are up and healthy (Redis's healthcheck now reads the password from its own environment).
2. `docker compose exec database env | findstr TWILIO` (PowerShell) or `| grep TWILIO` prints **nothing**. Same for `redis`.
3. Admin → System: *Web app 0.35.2 · Server 0.35.2*. The database, Redis, email, texts and push look the same as before.
4. Sign in with a password and with Google. The public address loads, so the tunnel is working with `TUNNEL_TOKEN`.
5. To go back: `python scripts/consolidate_env.py --undo`, check out the 0.35.1 code, and rebuild.
6. After a few days, delete the `*.bak` files and `.env.old.env` (keep them until you're sure).

---

**"CRITICAL SYSTEM DIRECTIVE: Starting immediately, upon the successful completion of any future phase or feature implementation, you must autonomously bump the version number in `frontend/package.json`, append a bulleted summary of changes to `CHANGELOG.md`, and update `README.md` if the architecture changed. Do not ask for permission to do this."**

(For this phase, Part V already does all three for 0.35.2. Apply it as written and don't bump again.)