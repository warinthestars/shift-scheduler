# Phase 35.4: Dev and Prod Stacks on One Computer (v0.35.6)

**Why:** a second ShiftBoard stack (prod) has to run on the same computer as the existing one (dev). Today that fails, because `docker-compose.yaml` gives every container a fixed name (`shiftboard-backend`, ...) and one fixed port (`5173`), and Docker allows each name and each port only once per computer. This phase removes the fixed names and the fixed port, so each stack is kept apart by its own stack name and its own ports, both set in that stack's `.env`.

## What changes
* **`docker-compose.yaml`:** all five `container_name:` lines are removed, and the fixed `"5173:5173"` port becomes a setting (`PORT_FRONTEND_VITE`, default 5173).
  * Compose then names each container `<stack name>-<service>-1` and puts the stack name in front of the network and the volumes too.
  * The stack name is `COMPOSE_PROJECT_NAME` in `.env`. Not set = the folder's name, which is what the existing stack already uses, **so the existing stack keeps its database volume and its ports with no change to its `.env`.**
  * The frontend keeps its old name `shiftboard-frontend` as a name on its own stack's network, so a Cloudflare tunnel that points at `http://shiftboard-frontend:5173` keeps working.
* **NEW `docker-compose.demo.yaml`:** Phase 35.3 described this file, and the scripts and docs use it, but it is not in the repository. It is created here, without container names.
* **`.env.template`:** documents `COMPOSE_PROJECT_NAME` (commented out) and adds `PORT_FRONTEND_VITE=5173`.
* `docs/DEPLOYMENT.md` gets section E (two stacks on one computer); README, CHANGELOG and `agy_system_instructions.md` are updated.
* **Version 0.35.6.** `frontend/package.json` and `backend/src/version.py` are both bumped, and the CHANGELOG and README updates are included below. **This covers the standing directive for this phase, so don't bump again.**
* **No database, API, backend code or frontend code change besides the version.** No schema change, so nothing is wiped: there is no `docker compose down -v` in this phase.

## 0. Rules for this phase
* Touch only the 9 files named below. Nothing in `backend/` except `backend/src/version.py`; nothing in `frontend/` except `frontend/package.json`.
* **Never open, read, print or edit a real settings file:** `.env`, anything in `.secrets/` that isn't a `.template`, or any `*.bak`. Andrew sets up each stack's `.env` himself (Part R).
* **Do NOT run any `docker` or `docker compose` command** (no `up`, `down`, `config`, `ps`). A live stack with testers' data may be running on this computer, and a command in the wrong folder acts on the wrong stack. Andrew runs everything himself (Part R).
* `COMPOSE_PROJECT_NAME` and `PORT_FRONTEND_VITE` are read by Docker Compose only. **Don't add them to `backend/src/config.py`** or to `backend/.env.template`.
* Don't add a top-level `name:` to either compose file, don't rename the services, the network (`shiftboard-network`) or the volumes (`postgres_data`, `redis_data`), and don't add `name:` under the network or the volumes. Renaming a volume would detach the existing database.
* Don't change `deploy_test_data.sh` or `deploy_test_data.ps1`. They already work with a named stack.
* **Code fences are not file content.** Every file and every Find / Replace block in this prompt is wrapped in fence lines of three or four backticks. The outer fence lines are Markdown; never write them into a file. Where a block is wrapped in **four** backticks, the three-backtick lines inside it ARE content and must be written.
* **Line endings:** keep each file's existing line endings. On this computer `docker-compose.yaml` has Windows (CRLF) line endings and the other edited files have LF. Create `docker-compose.demo.yaml` with LF.
* **EDITS:** each edit is an exact *Find* → *Replace with*; every *Find* appears **exactly once** in the current file; apply them in order. If a *Find* doesn't match, stop and report it. Don't improvise a different edit.
* **Verification.** All 21 edits below were replayed by a script against the files in your repo (0.35.5), and each *Find* matched exactly once. The two resulting compose files were then rendered with `docker compose config` (Compose v5.5.1):
  - **the existing stack, `.env` unchanged:** stack name = the folder name, the same network, the same volumes (`<folder>_postgres_data`, `<folder>_redis_data`) and the same ports (80, 5173, 8000, 5432, 6379) as before this phase. Compared with the render of the current file, the only differences are the missing container names and the frontend's extra network name.
  - **a second stack** with `COMPOSE_PROJECT_NAME=shiftboard-prod` and the ports from Part R: its own name, network and volumes.
  - **the demo copy** (`-p shiftboard-demo` with both files), from either folder: its own name, network and volumes, no tunnel, and `-p` wins over `COMPOSE_PROJECT_NAME` in `.env`.
  - Across the three, no port on this computer is used twice, and no service has a container name.
  - A second clone in a folder with the **same name** and no `COMPOSE_PROJECT_NAME` renders with the first stack's name. That is why Part R checks the name before the first start.
  - **Nothing was started.** `config` only renders the files. No container was run, and Docker's handling of the renamed containers on a live stack was not exercised. The first real `up` is Andrew's.

  Don't "improve" them.

---

# PART A: The compose files and the settings template

## A1. `docker-compose.yaml` (EDITS)
Seven edits. After them, the text `container_name:` does not appear anywhere in the file.

**Edit 1.** Find:
```yaml
# .secrets/ also holds the Firebase files and is mounted read-only into the backend.
# ------------------------------------------------------------------------------
```
Replace with:
```yaml
# .secrets/ also holds the Firebase files and is mounted read-only into the backend.
#
# Phase 35.4: several stacks can run on one computer (for example dev and prod).
#   * No service has a fixed container name. Compose names each container
#     <stack name>-<service>-1 and puts the stack name in front of the network and the
#     volumes, so two stacks never share a container, a network or a database volume.
#   * The stack name is COMPOSE_PROJECT_NAME in .env. Not set = the name of this folder.
#   * Every port on your computer comes from .env. Each stack needs its own.
#   Never give a service a fixed container name again, and never write a fixed number on the
#   left side of a "ports:" line. See docs/DEPLOYMENT.md, section E.
# ------------------------------------------------------------------------------
```

**Edit 2.** Find:
```yaml
    image: postgres:16-alpine
    container_name: shiftboard-database
    restart: unless-stopped
```
Replace with:
```yaml
    image: postgres:16-alpine
    restart: unless-stopped
```

**Edit 3.** Find:
```yaml
    image: redis:7-alpine
    container_name: shiftboard-redis
    restart: unless-stopped
```
Replace with:
```yaml
    image: redis:7-alpine
    restart: unless-stopped
```

**Edit 4.** Find:
```yaml
      dockerfile: Dockerfile
    container_name: shiftboard-backend
    restart: unless-stopped
```
Replace with:
```yaml
      dockerfile: Dockerfile
    restart: unless-stopped
```

**Edit 5.** Find:
```yaml
      dockerfile: Dockerfile
    container_name: shiftboard-frontend
    restart: unless-stopped
```
Replace with:
```yaml
      dockerfile: Dockerfile
    restart: unless-stopped
```

**Edit 6.** Find:
```yaml
    ports:
      - "5173:5173"
      - "${PORT_FRONTEND:-80}:5173"
    depends_on:
      - backend
    networks:
      - shiftboard-network
```
Replace with:
```yaml
    # Two ports on your computer reach the same Vite server (5173 inside the container).
    ports:
      - "${PORT_FRONTEND_VITE:-5173}:5173"
      - "${PORT_FRONTEND:-80}:5173"
    depends_on:
      - backend
    # "shiftboard-frontend" was this container's fixed name before Phase 35.4. It stays as a name
    # on this stack's own network, so a Cloudflare tunnel that points at
    # http://shiftboard-frontend:5173 keeps working. Each stack has its own network, so the
    # same name in two stacks doesn't clash.
    networks:
      shiftboard-network:
        aliases:
          - shiftboard-frontend
```

**Edit 7.** Find:
```yaml
    image: cloudflare/cloudflared:latest
    container_name: shiftboard-cloudflared
    restart: unless-stopped
```
Replace with:
```yaml
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
```

---

## A2. NEW FILE `docker-compose.demo.yaml`
In the repository root, next to `docker-compose.yaml`. It does not exist yet; create it. (If it does exist, replace its whole content with this.) The first line is `# ----...` and the **last line is `    profiles: ["tunnel-not-used-by-demo"]`**. `!override` is written exactly as shown, with no quotes.

```yaml
# ------------------------------------------------------------------------------
# A SECOND, separate copy of ShiftBoard for demo data (Phase 35.3; file added in 35.4).
#
# It runs next to your normal stack with its own database, so nothing you or your
# testers have entered is touched. Same code, same settings files, different ports:
#
#   web app   http://localhost:5183        API docs  http://localhost:8010/docs
#   Postgres  localhost:5442               Redis     localhost:6389
#
# Start it (from the repository root):
#   docker compose -p shiftboard-demo -f docker-compose.yaml -f docker-compose.demo.yaml up -d --build
# Load the demo data into it:
#   docker compose -p shiftboard-demo -f docker-compose.yaml -f docker-compose.demo.yaml exec backend python -m src.demo_data load
# Stop it / throw it away completely (-v deletes ONLY the demo copy's database):
#   docker compose -p shiftboard-demo -f docker-compose.yaml -f docker-compose.demo.yaml down
#   docker compose -p shiftboard-demo -f docker-compose.yaml -f docker-compose.demo.yaml down -v
#
# "-p shiftboard-demo" is the stack name. It is what keeps the copy separate (its own
# containers, network and volumes), and it wins over COMPOSE_PROJECT_NAME in .env.
# Never run these commands without it. See docs/DEPLOYMENT.md, section D.
# The copy is always called shiftboard-demo, so run it from one folder only.
# Needs Docker Compose 2.24 or newer (for "!override").
# ------------------------------------------------------------------------------
services:
  database:
    ports: !override
      - "${DEMO_POSTGRES_PORT:-5442}:5432"

  redis:
    ports: !override
      - "${DEMO_REDIS_PORT:-6389}:6379"

  backend:
    ports: !override
      - "${DEMO_PORT_BACKEND:-8010}:8000"
    # The demo copy never sends real email or texts, and its links point at itself.
    environment:
      - EMAIL_PROVIDER=console
      - SMS_PROVIDER=off
      - APP_BASE_URL=http://localhost:${DEMO_PORT_FRONTEND:-5183}

  frontend:
    ports: !override
      - "${DEMO_PORT_FRONTEND:-5183}:5173"

  # The Cloudflare tunnel belongs to the normal stack. It is NOT started for the demo copy
  # (two tunnels with the same token would split your visitors between the two).
  cloudflared:
    profiles: ["tunnel-not-used-by-demo"]
```

---

## A3. `.env.template` (EDITS)

**Edit 1.** Find:
```bash
# Upgrading? Run scripts/consolidate_env.py once (see README).
# ==============================================================================
```
Replace with:
```bash
# Upgrading? Run scripts/consolidate_env.py once (see README).
# ==============================================================================

# ------------------------------------------------------------------------------
# Stack name (only matters when more than one stack runs on this computer)
# ------------------------------------------------------------------------------
# Docker Compose puts this name in front of every container, the network and the volumes,
# for example shiftboard-prod-backend-1 and shiftboard-prod_postgres_data.
# Not set = the name of this folder.
#   * One stack on this computer: leave it commented out.
#   * A second stack (for example prod next to dev): remove the "# " and give it its own name
#     here AND its own ports below, BEFORE its first "docker compose up".
#     See docs/DEPLOYMENT.md, section E.
#   * Never change it on a stack that already has data. The database volume is found by this
#     name, so a new name starts with an empty database (the old one is kept, not deleted).
# COMPOSE_PROJECT_NAME=shiftboard-prod
```

**Edit 2.** Find:
```bash
PORT_BACKEND=8000
PORT_FRONTEND=80
# The Cloudflare tunnel token (TUNNEL_TOKEN) is in .secrets/stack.env
```
Replace with:
```bash
# Each stack on this computer needs its own five ports: POSTGRES_PORT and REDIS_PORT above and
# the three below. A second stack could use 5433, 6380, 8001, 8080 and 5174.
PORT_BACKEND=8000
# The web app is published on two ports. Both reach the same Vite server.
PORT_FRONTEND=80
PORT_FRONTEND_VITE=5173
# The Cloudflare tunnel token (TUNNEL_TOKEN) is in .secrets/stack.env.
# Each stack needs its OWN tunnel and token: one token in two stacks splits visitors between them.
```

---

# PART B: Guides

## B1. `docs/DEPLOYMENT.md` (EDITS)
A new row in the first table, one bullet in section D, the new section E, and two rows in Troubleshooting.

**Edit 1.** Find:
```markdown
| **D. Full demo data in a separate copy** | The same, but in its own database so your current data and testers aren't affected. | [D](#d-full-demo-data-in-a-separate-copy) |
```
Replace with:
```markdown
| **D. Full demo data in a separate copy** | The same, but in its own database so your current data and testers aren't affected. | [D](#d-full-demo-data-in-a-separate-copy) |
| **E. Two stacks on one computer** | A second, fully separate ShiftBoard (for example prod next to dev) with its own code, settings, database and public address. | [E](#e-two-stacks-on-one-computer-for-example-dev-and-prod) |
```

**Edit 2.** The *Replace with* block is wrapped in four backticks; the three-backtick lines inside it are content. Find:
```markdown
* Needs Docker Compose 2.24 or newer (`docker compose version`).

---

## Saving and restoring a snapshot
```
Replace with:
````markdown
* Needs Docker Compose 2.24 or newer (`docker compose version`).
* The copy is always called `shiftboard-demo`, whichever folder you start it from. With two stacks on one computer (setup E), run the copy from one folder only.

---

## E. Two stacks on one computer (for example dev and prod)

Use this to run a second, fully separate ShiftBoard next to the one you already have. Each stack has its own folder, code, settings files, database, ports and public address.

What keeps them apart:

| | Where it comes from | Example: first stack (dev) | Example: second stack (prod) |
| :--- | :--- | :--- | :--- |
| Stack name | `COMPOSE_PROJECT_NAME` in that folder's `.env`. Not set = the folder's name. | `shift-scheduler` | `shiftboard-prod` |
| Containers | `<stack name>-<service>-1` | `shift-scheduler-backend-1` | `shiftboard-prod-backend-1` |
| Database volume | `<stack name>_postgres_data` | `shift-scheduler_postgres_data` | `shiftboard-prod_postgres_data` |
| Ports on this computer | `.env` in that folder | 80, 5173, 8000, 5432, 6379 | 8080, 5174, 8001, 5433, 6380 |
| Public address | that folder's own Cloudflare tunnel (`TUNNEL_TOKEN`) | its own | its own |

Every `docker compose` command acts on the stack whose folder you are in.

### The stack you already have

* Its `.env` doesn't need to change, as long as its folder keeps its name.
* After updating to 0.35.6, run `docker compose up -d` in its folder once. The containers are re-created under their new names (`<stack name>-backend-1` and so on). The data is kept. Don't run `down`.
* `docker compose ls` shows its stack name. To make sure the name never changes (for example if the folder is renamed), put that exact name in its `.env`: `COMPOSE_PROJECT_NAME=<the name docker compose ls shows>`.
* **Never give a stack that has data a different name.** The database volume is found by the stack name, so a new name starts with an empty database. Nothing is deleted: put the old name back and the data is there again.
* Commands of your own that use the old container names (`docker exec shiftboard-backend ...`) become `docker compose exec backend ...`.

### Setting up the second stack

1. Clone the repository into a second folder, for example `shift-scheduler-prod`.
2. In that folder, copy the templates and fill them in (see *Steps every setup starts with*). Give it its own `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `SECRET_KEY` and `SUPER_ADMIN_PASSWORD`.
3. In its `.env`, set the name and five free ports **before the first start**:
   ```
   COMPOSE_PROJECT_NAME=shiftboard-prod
   POSTGRES_PORT=5433
   REDIS_PORT=6380
   PORT_BACKEND=8001
   PORT_FRONTEND=8080
   PORT_FRONTEND_VITE=5174
   ```
   For a real (non-demo) stack also set `APP_BASE_URL` to its public address, `SUPER_ADMIN_USERNAME`, `SEED_DEMO_ACCOUNTS=false` and `SHOW_DEMO_LOGINS=false` (setup A).
4. Give it its own Cloudflare tunnel: create a second tunnel, put its token in this folder's `.secrets/stack.env` as `TUNNEL_TOKEN`, and point the tunnel's public hostname at `http://frontend:5173`. **Never use one token in two stacks**: Cloudflare would split visitors between them.
5. Check the name before starting. This prints `name: shiftboard-prod`:
   ```bash
   docker compose config | grep "^name:"            # PowerShell: docker compose config | Select-String "^name:"
   ```
   If it prints the first stack's name, stop: starting now would replace the first stack's containers and use its database.
6. Start it and check:
   ```bash
   docker compose up -d --build
   docker compose ls            # two stacks, both "running"
   ```

### Things to know

* `http://frontend:5173` in a tunnel means "the frontend of the tunnel's own stack", so both tunnels can use the same address.
* The public hostname must be listed under `allowedHosts` in `frontend/vite.config.js`, or the web app answers "Blocked request".
* For Firebase sign-in, add the second public hostname in the Firebase Console under Authentication → Settings → Authorized domains.
* `docker compose down -v` deletes the database of the stack whose folder you are in, and only that one.
* Both stacks run the same kind of containers (Vite dev server, auto-reloading API). The second stack runs whatever code is checked out in its folder; update it there with `git pull` and `docker compose up -d --build`.

---

## Saving and restoring a snapshot
````

**Edit 3.** Find:
```markdown
| `service "backend" is not running` | Start the stack first: `docker compose up -d`. |
```
Replace with:
```markdown
| `service "backend" is not running` | Start the stack first: `docker compose up -d`. |
| `Bind for 0.0.0.0:5432 failed: port is already allocated` (any port) | Another stack on this computer already uses that port. Give this stack its own ports in `.env` (section E). |
| A second stack shows the first stack's data, or starting it replaced the first stack's containers | Both folders have the same stack name. Set `COMPOSE_PROJECT_NAME` in the second folder's `.env` (section E), then run `docker compose up -d --force-recreate` in the first folder and then in the second. |
```

---

## B2. `agy_system_instructions.md` (EDITS)
One tree line, and rule 9 added after rule 8. Leave the Standing rules section exactly as it is.

**Edit 1.** Find:
```markdown
├── docker-compose.yaml      # reads .env + .secrets/stack.env + .secrets/integrations.env (Phase 35.1.1)
```
Replace with:
```markdown
├── docker-compose.yaml      # reads .env + .secrets/stack.env + .secrets/integrations.env. No container names, no fixed ports (Phase 35.4)
```

**Edit 2.** Find:
```markdown
`deploy_test_data.sh` (bash) and `deploy_test_data.ps1` (PowerShell) run the loader and must behave the same: a change to one goes into the other in the same phase.
```
Replace with:
```markdown
`deploy_test_data.sh` (bash) and `deploy_test_data.ps1` (PowerShell) run the loader and must behave the same: a change to one goes into the other in the same phase.
9. **Several stacks on one computer (Phase 35.4):** dev and prod run side by side from two folders, kept apart by the stack name (`COMPOSE_PROJECT_NAME` in each folder's `.env`; not set = the folder's name) and by their own ports.
   * Never add `container_name:` to a service, and never add a top-level `name:` or a `name:` under a network or volume in a compose file.
   * Never write a fixed number on the left side of a `ports:` line. A new published port is a `${NAME:-default}` setting, documented in `.env.template`.
   * Never rename a service, the network or a volume: the database volume is found by `<stack name>_postgres_data`.
   * Refer to a container as `docker compose exec <service>`, never by a container name.
   * Never run `docker compose` yourself on this computer: a command in the wrong folder acts on the wrong stack.
```

---

# PART V: Version, changelog & README (the standing directive, done for you)

## V1. `frontend/package.json` (EDIT)

**Edit 1.** Find:
```json
  "name": "shiftboard-frontend",
  "private": true,
  "version": "0.35.5",
  "type": "module",
  "scripts": {
```
Replace with:
```json
  "name": "shiftboard-frontend",
  "private": true,
  "version": "0.35.6",
  "type": "module",
  "scripts": {
```

---

## V2. `backend/src/version.py` (EDIT)

**Edit 1.** Find:
```python
container is still running an old build.
"""
APP_VERSION = "0.35.5"
```
Replace with:
```python
container is still running an old build.
"""
APP_VERSION = "0.35.6"
```

---

## V3. `CHANGELOG.md` (EDIT)
The new section goes above `[0.35.5]`.

**Edit 1.** Find:
```markdown

The newest version goes at the top. Each entry uses a `## [x.y.z] - YYYY-MM-DD - Phase N: title` heading, followed by bullets under **Added / Changed / Fixed / Removed**.

## [0.35.5] - 2026-10-02 - Phase 35.3.1: Demo data script for PowerShell
```
Replace with:
```markdown

The newest version goes at the top. Each entry uses a `## [x.y.z] - YYYY-MM-DD - Phase N: title` heading, followed by bullets under **Added / Changed / Fixed / Removed**.

## [0.35.6] - 2026-10-04 - Phase 35.4: Dev and prod stacks on one computer

### Changed
- **`docker-compose.yaml` no longer gives containers fixed names.** Compose names them `<stack name>-<service>-1` and puts the stack name in front of the network and the volumes, so several stacks can run on one computer.
  - The stack name is `COMPOSE_PROJECT_NAME` in `.env`. Not set = the folder's name, as before, so an existing stack keeps its database volume.
  - After updating, `docker compose up -d` re-creates the containers under their new names. The data is kept.
  - Commands that used a container name (`docker exec shiftboard-backend ...`) become `docker compose exec backend ...`.
- The web app's second port on your computer (5173) is now a setting, `PORT_FRONTEND_VITE`, so no port is fixed any more.
- The frontend keeps `shiftboard-frontend` as a name on its own stack's network, so a Cloudflare tunnel that points at that name keeps working.

### Added
- `COMPOSE_PROJECT_NAME` (commented out) and `PORT_FRONTEND_VITE` in `.env.template`.
- `docs/DEPLOYMENT.md`, section E: running two stacks (for example dev and prod) on one computer.

### Fixed
- `docker-compose.demo.yaml` was described in 0.35.4 but missing from the repository, so `--demo-copy` stopped with "docker-compose.demo.yaml is missing". The file is added.

## [0.35.5] - 2026-10-02 - Phase 35.3.1: Demo data script for PowerShell
```

---

## V4. `README.md` (EDITS)

**Edit 1.** Find:
```markdown
| Web app | http://localhost:5173 (also on `PORT_FRONTEND`, default 80) |
```
Replace with:
```markdown
| Web app | http://localhost:5173 (`PORT_FRONTEND_VITE`) and http://localhost (`PORT_FRONTEND`, default 80) |
```

**Edit 2.** Find:
```markdown
| Full demo data in a separate copy | `docker compose -p shiftboard-demo -f docker-compose.yaml -f docker-compose.demo.yaml up -d --build`, then the same loader inside it (or both in one: `bash deploy_test_data.sh load --demo-copy --start`, or `.\deploy_test_data.ps1 load --demo-copy --start`). Its own database, on http://localhost:5183. |

**Everyday commands**
```
Replace with:
```markdown
| Full demo data in a separate copy | `docker compose -p shiftboard-demo -f docker-compose.yaml -f docker-compose.demo.yaml up -d --build`, then the same loader inside it (or both in one: `bash deploy_test_data.sh load --demo-copy --start`, or `.\deploy_test_data.ps1 load --demo-copy --start`). Its own database, on http://localhost:5183. |
| Two stacks on one computer (dev + prod) | A second clone in its own folder, with its own `COMPOSE_PROJECT_NAME` and ports in its `.env`, its own secrets and its own Cloudflare tunnel. See `docs/DEPLOYMENT.md`, section E. |

**Everyday commands**
```

**Edit 3.** Find:
```markdown
* After changing any of them: `docker compose up -d --force-recreate` (keeps your data).
```
Replace with:
```markdown
* After changing any of them: `docker compose up -d --force-recreate` (keeps your data).
* **Stack name and ports (since 0.35.6).** No container has a fixed name: Compose names them `<stack name>-<service>-1`, and the network and volumes start with the stack name too. The stack name is `COMPOSE_PROJECT_NAME` in `.env` (not set = the folder's name), and every port on your computer is a setting. That is what lets two stacks (dev and prod) run on one computer. Never change the name of a stack that has data: the database volume is found by it.
```

**Edit 4.** Find:
```markdown
| :--- | :--- |
| Database / Redis | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `REDIS_PASSWORD` |
```
Replace with:
```markdown
| :--- | :--- |
| Stack name and ports | `COMPOSE_PROJECT_NAME` (only for a second stack on one computer), `POSTGRES_PORT`, `REDIS_PORT`, `PORT_BACKEND`, `PORT_FRONTEND`, `PORT_FRONTEND_VITE` (read by Docker Compose, not by the app) |
| Database / Redis | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `REDIS_PASSWORD` |
```

---

# PART R: For Andrew: deploying prod next to dev (AGY: don't run any of this)

No database change, so no SQL and no wipe. **Never run `docker compose down -v` for this.**

### 1. The dev stack (the one that's running now)
1. Before pulling, note its stack name: `docker compose ls`. It is the dev folder's name (probably `shift-scheduler`).
2. Open the dev tunnel in Cloudflare Zero Trust → Networks → Tunnels → Public hostname and look at the service address:
   - `http://frontend:5173` or `http://shiftboard-frontend:5173`: both keep working.
   - an address with this computer's IP or `localhost` and a port: it keeps working, because dev keeps its ports.
3. Pull this phase into the dev folder, then run `docker compose up -d` there. The containers are re-created as `<stack name>-backend-1` and so on. The database is the same volume as before.
4. Optional, and recommended: pin the name so a renamed folder can't detach the database. Add this line to dev's `.env`, using exactly the name from step 1: `COMPOSE_PROJECT_NAME=shift-scheduler`.
5. Dev's ports stay as they are. You don't need to add `PORT_FRONTEND_VITE` to dev's `.env`; it defaults to 5173.

Dev can be updated before or after prod is started. Prod doesn't depend on it.

### 2. The prod stack
1. Clone the repository into a second folder (for example `shift-scheduler-prod`) at this phase's commit or later.
2. Copy the four templates and fill them in. Use new values for `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `SECRET_KEY` and `SUPER_ADMIN_PASSWORD` in prod's `.secrets/stack.env`; don't copy dev's file.
3. In prod's `.env`:
   ```
   COMPOSE_PROJECT_NAME=shiftboard-prod
   POSTGRES_PORT=5433
   REDIS_PORT=6380
   PORT_BACKEND=8001
   PORT_FRONTEND=8080
   PORT_FRONTEND_VITE=5174
   APP_BASE_URL=https://<prod's public address>
   SUPER_ADMIN_USERNAME=<your admin email>
   SEED_DEMO_ACCOUNTS=false
   SHOW_DEMO_LOGINS=false
   ENV=production
   DEBUG=false
   ```
4. Create a **second Cloudflare tunnel** for prod. Put its token in prod's `.secrets/stack.env` as `TUNNEL_TOKEN` and point its public hostname at `http://frontend:5173`. Never reuse dev's token.
5. Check prod's public hostname is in `allowedHosts` in `frontend/vite.config.js`. Today the list is: `dev-scheduler.jaccollective.com`, `shiftboard.local`, `dev-scheduler-local.jaccollective.com`, `dev.shift-up.team`, `shift-up.team`, `dev-local.shift-up.team`. A hostname that isn't there needs a one-line phase.
6. Add prod's hostname to Firebase Console → Authentication → Settings → Authorized domains.
7. In the prod folder, check the name **before** the first start:
   ```bash
   docker compose config | grep "^name:"            # PowerShell: docker compose config | Select-String "^name:"
   ```
   It must print `name: shiftboard-prod`. If it prints dev's name, stop and fix `.env` first.
8. Start it: `docker compose up -d --build`

### Checklist
1. `docker compose ls` lists two stacks, dev's name and `shiftboard-prod`, both running.
2. `docker ps --format "table {{.Names}}\t{{.Ports}}"` shows ten containers: five starting with dev's stack name and five starting with `shiftboard-prod-`. No port appears twice.
3. `docker volume ls` shows `<dev's name>_postgres_data` and `shiftboard-prod_postgres_data`.
4. Dev: sign in at the dev address. The testers' venues and people are still there, and Admin → System shows *Web app 0.35.6 · Server 0.35.6*.
5. Prod: sign in at the prod address as the new admin. Admin → Venues is empty and Admin → People lists only you.
6. In the repo: `docker-compose.demo.yaml` exists, and searching `docker-compose.yaml` for `container_name:` finds nothing.

---

**"CRITICAL SYSTEM DIRECTIVE: Starting immediately, upon the successful completion of any future phase or feature implementation, you must autonomously bump the version number in `frontend/package.json`, append a bulleted summary of changes to `CHANGELOG.md`, and update `README.md` if the architecture changed. Do not ask for permission to do this."**

(For this phase, Part V already does all three for 0.35.6. Apply it as written and don't bump again.)