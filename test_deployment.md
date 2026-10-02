# Deploying ShiftBoard: with or without demo data

There are two separate kinds of demo content. You choose each one on its own.

| | What it is | How it gets there | How to leave it out |
| :--- | :--- | :--- | :--- |
| **Starter demo accounts** | One venue (The Hippodrome), a second empty venue, a demo manager, three demo workers and three upcoming shifts. All have well-known passwords. | Created automatically when the backend starts, unless you turn it off. | `SEED_DEMO_ACCOUNTS=false` in `.env` |
| **Full demo data** | Five venues set up five different ways, about 115 people, weeks of finished events with clock-ins, tips, ratings and pay periods, events happening today, and upcoming events with requests, offers, cover requests and waitlists. | Only when you run the loader: `python -m src.demo_data load`. | Don't run the loader. `clear` removes it. |

Pick the setup you want:

| Setup | Use it for | Section |
| :--- | :--- | :--- |
| **A. Clean** | Real use. No demo content at all. | [A](#a-clean-install-no-demo-content) |
| **B. Starter accounts only** | Quick local development. This is what you get by default. | [B](#b-starter-demo-accounts-only-the-default) |
| **C. Full demo data in your current stack** | Showing or testing a busy system, next to whatever is already there. | [C](#c-full-demo-data-in-your-current-stack) |
| **D. Full demo data in a separate copy** | The same, but in its own database so your current data and testers aren't affected. | [D](#d-full-demo-data-in-a-separate-copy) |

---

## Steps every setup starts with

From the repository root:

```bash
# 1. Settings: three files (see README > Configuration)
cp .env.template .env
cp .secrets/stack.env.template .secrets/stack.env
cp .secrets/integrations.env.template .secrets/integrations.env
cp .secrets/firebase-web-config.js.template .secrets/firebase-web-config.js   # for real Firebase sign-in

# 2. Fill them in. At least, in .secrets/stack.env:
#      POSTGRES_PASSWORD, REDIS_PASSWORD, SECRET_KEY, SUPER_ADMIN_PASSWORD, TUNNEL_TOKEN
#    and in .env: SUPER_ADMIN_USERNAME (the first admin's email) and APP_BASE_URL.

# 3. Build and start
docker compose up -d --build
docker compose ps            # all five services up; database and redis "healthy"
```

Rules that apply everywhere:
* After changing any settings file: `docker compose up -d --force-recreate`. This keeps your data.
* `docker compose down -v` **deletes the database**. Only use it when you mean to start over.
* The database is created from `database/init.sql` the first time its volume is created.

---

## A. Clean install (no demo content)

1. In `.env`:
   ```
   SEED_DEMO_ACCOUNTS=false
   SHOW_DEMO_LOGINS=false
   ```
2. Still in `.env`, set the first admin: `SUPER_ADMIN_USERNAME=you@yourdomain.com`. Put the password in `.secrets/stack.env` as `SUPER_ADMIN_PASSWORD`. Optionally list people who should always be admins when they sign in with Firebase: `ALWAYS_ADMIN_EMAILS=you@yourdomain.com,partner@yourdomain.com`.
3. Start it: `docker compose up -d --build` (new install) or `docker compose up -d --force-recreate` (existing one).
4. Check: sign in as the admin. Admin → Venues is empty and Admin → People lists only you.

**If the starter accounts already exist** (the backend started before with `SEED_DEMO_ACCOUNTS=true`): turning the setting off stops them being re-created, but doesn't remove them. Remove them once in the app:
* Admin → People: delete `demo_manager@shiftboard.com`, `demo_worker@shiftboard.com`, `worker1@shiftboard.com`, `worker2@shiftboard.com`.
* Admin → Venues: delete *The Hippodrome* and *The Copper & Oak Lounge*.
* If your first admin is still the default `demo_admin@shiftboard.com`, create your own admin first, then delete that one.

Or, on a brand-new system with nothing worth keeping: set the two lines above, then `docker compose down -v` and `docker compose up -d --build`.

---

## B. Starter demo accounts only (the default)

Leave `SEED_DEMO_ACCOUNTS=true` (or leave it out). On first start you get:

| Role | Email | Password |
| :--- | :--- | :--- |
| Platform Admin | `SUPER_ADMIN_USERNAME` (default `demo_admin@shiftboard.com`) | `SUPER_ADMIN_PASSWORD` |
| Venue Manager | `demo_manager@shiftboard.com` | `DemoManager123!` |
| Worker | `demo_worker@shiftboard.com` | `DemoWorker123!` |
| Worker | `worker1@shiftboard.com`, `worker2@shiftboard.com` | `Worker123!` |

`SHOW_DEMO_LOGINS=true` adds one-tap buttons for these on the login page. **Never use this setup anywhere public**: the passwords are in this file.

---

## C. Full demo data in your current stack

The loader adds the demo venues and people **next to** whatever is already in the database. It doesn't change or remove anything else.

```bash
docker compose exec backend python -m src.demo_data status     # what's there now
docker compose exec backend python -m src.demo_data load       # add the demo data (about 5 seconds)
```

**Shortcut:** `deploy_test_data.sh` in the repository root runs these commands for you. It checks that Docker and the backend are running, waits for the database, and then loads:

```bash
bash deploy_test_data.sh                  # the same as "load"
bash deploy_test_data.sh status
bash deploy_test_data.sh reset            # asks first; add -y to skip the question
bash deploy_test_data.sh clear
bash deploy_test_data.sh load --weeks-back 12 --manager-email you@yourdomain.com
```

* It works from any folder, because it switches to the folder it is in before running Docker.
* Loader options (the table under **Options** below) go after the command and are passed through unchanged.
* Its own options are `--start` (start the stack first if it isn't running), `--demo-copy` (use the separate copy from setup D) and `-y`.
* It never runs `down`, never deletes a volume, and never reads a settings file.
* On Windows, run it from Git Bash or WSL. In PowerShell, use the `docker compose` commands directly.

It prints the logins when it finishes:

| Who | Email | Sees |
| :--- | :--- | :--- |
| Manager | `manager.marlowe@demo.example.com` | The Marlowe Theatre |
| Manager | `manager.harbor@demo.example.com` | Harbor House Events |
| Manager | `manager.copperline@demo.example.com` | Copperline Taproom |
| Manager | `manager.juniper@demo.example.com` | Juniper Rooftop |
| Manager | `manager.riverside@demo.example.com` | Riverside Convention Center |
| Manager | `regional.manager@demo.example.com` | Harbor House + Copperline |
| Workers | any address ending `@demo.example.com` (Admin → People, or a venue's Team list) | their own shifts |
| Your admins | their normal login | every demo venue, in the venue picker |

**Every demo account uses one password: `Demo12345!`** (change it with `--password`). Demo accounts sign in with email and password, not Google.

### What the five venues show

| Venue | Time zone | Set up to show |
| :--- | :--- | :--- |
| The Marlowe Theatre | New York | Team on **venue payroll**; overhire through three **staffing companies** clocks in with ShiftBoard; pay every two weeks; daily + weekly overtime; bar tip pool |
| Harbor House Events | Chicago | ShiftBoard clock-in with the **location check** on; off-site locations; tip pools by hours; weekly pay periods (one was reopened); a week with **weekly overtime** |
| Copperline Taproom | Denver | **Book anyone instantly**; tips shared equally plus servers' own tips; pay twice a month; work week starts Wednesday |
| Juniper Rooftop | Los Angeles | **Manager approves everyone** (requests waiting); pay hidden; tips off; approving pay periods off; no public cover board |
| Riverside Convention Center | New York | Venue payroll + staffing companies; long days (**daily overtime**); payroll people left out of tip pools; location check on |

In every venue you'll find:
* **Past:** finished events with on-time and late clock-ins, no-shows, drops, edited and auto-closed times, ratings and reviews, tips, one cancelled event, and older pay periods approved and locked. The latest finished period is left *ready to approve*.
* **Today:** an event that ended a couple of hours ago, one **live right now** (people clocked in, one late), and one starting in about three hours with an update not everyone has read.
* **Upcoming:** partly staffed events, requests waiting for the manager, offers out, a full shift with a waitlist, cover requests (team, public board, and one waiting for approval), hand-offs, a draft, a cancelled event, templates, pending invites and time off.

### Options

```bash
docker compose exec backend python -m src.demo_data load --weeks-back 12 --weeks-ahead 4
docker compose exec backend python -m src.demo_data load --password "PickSomething9!"
docker compose exec backend python -m src.demo_data load --manager-email you@yourdomain.com --manager-email partner@yourdomain.com
```

| Option | Default | Meaning |
| :--- | :--- | :--- |
| `--weeks-back` | 8 | How much history (1–26 weeks) |
| `--weeks-ahead` | 3 | How far ahead events are posted (1–8 weeks) |
| `--seed` | 35 | The same number always gives the same people. A different number gives a different cast. |
| `--password` | `Demo12345!` | The one password for every demo account |
| `--manager-email` | none | Make an **existing** manager or admin account a manager of every demo venue, so people can explore with their own login. Repeat it for several people. |

### Refreshing and removing

```bash
docker compose exec backend python -m src.demo_data reset      # remove the demo data and load it again, dated from now
docker compose exec backend python -m src.demo_data clear      # remove the demo data only
```

* Everything is dated from the moment you load it. After a few days the "live" event is in the past; run `reset` to bring it back to today. `reset` takes the same options as `load`.
* `clear` and `reset` delete exactly the five demo venues and every account ending `@demo.example.com`, with everything attached to them. **That includes anything testers did inside the demo venues** (events they posted there, bookings, messages). Your own venues, accounts and their data are never touched.
* `load` refuses to run twice. Use `reset`.

### Things to know

* **No emails, texts or push are sent by loading.** Rows are written directly, demo accounts have email and texts turned off, and `demo.example.com` can't receive mail.
* **The app treats the demo data as real from then on.** The background worker adds bell notifications (reminders, "not clocked in", unread updates), clocks out the live event's people automatically after it ends, and moves waitlists along.
* **A real account added with `--manager-email` gets the demo venues' manager alerts** on whatever channels that person has turned on, including email. Leave it out if they don't want those.
* The loader needs the tables to exist, so the backend must have started at least once.
* It is one transaction: if it fails, nothing is written.

---

## D. Full demo data in a separate copy

Use this when people are already working in your normal stack and you don't want demo venues mixed in. `docker-compose.demo.yaml` starts a second copy with its own database, on different ports, from the same code and settings files.

```bash
# start the copy (first time: builds and creates its own empty database)
docker compose -p shiftboard-demo -f docker-compose.yaml -f docker-compose.demo.yaml up -d --build

# load the demo data into the copy
docker compose -p shiftboard-demo -f docker-compose.yaml -f docker-compose.demo.yaml exec backend python -m src.demo_data load
```

Or both steps in one: `bash deploy_test_data.sh load --demo-copy --start`. Add `--demo-copy` to `status`, `reset` and `clear` as well.

| | Normal stack | Demo copy |
| :--- | :--- | :--- |
| Web app | your public address / http://localhost:5173 | **http://localhost:5183** |
| API docs | http://localhost:8000/docs | http://localhost:8010/docs |
| Postgres / Redis ports | 5432 / 6379 | 5442 / 6389 |
| Database volume | its own | its own (`shiftboard-demo_postgres_data`) |
| Email / texts | as configured | never sent (console / off) |
| Cloudflare tunnel | yes | **not started** |

* **Always include `-p shiftboard-demo`** and both `-f` files in every command for the copy. That's what keeps it apart. Leaving them out acts on your normal stack.
* To save typing in one terminal window:
  * PowerShell: `$env:COMPOSE_PROJECT_NAME="shiftboard-demo"; $env:COMPOSE_FILE="docker-compose.yaml;docker-compose.demo.yaml"`
  * bash: `export COMPOSE_PROJECT_NAME=shiftboard-demo COMPOSE_FILE=docker-compose.yaml:docker-compose.demo.yaml`

  Then plain `docker compose ...` commands in that window act on the copy. Close the window to go back to normal.
* The copy is reachable from this computer (and your network) on port 5183. It has no public address. To let people outside reach it, add a second public hostname in Cloudflare that points at `http://<this computer>:5183`, or just use setup C.
* The copy has its own starter demo accounts and its own first admin (from the same settings files).
* Stop it: `docker compose -p shiftboard-demo -f docker-compose.yaml -f docker-compose.demo.yaml down`
* Delete it completely, database included: the same command with `down -v`. With `-p shiftboard-demo` this deletes only the copy's database.
* Different ports: set `DEMO_PORT_FRONTEND`, `DEMO_PORT_BACKEND`, `DEMO_POSTGRES_PORT` or `DEMO_REDIS_PORT` in `.env`.
* Needs Docker Compose 2.24 or newer (`docker compose version`).

---

## Saving and restoring a snapshot

A snapshot is the whole database at one moment. It's the fastest way to put a test system back exactly as it was.

```bash
# save
docker compose exec database sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/snapshot.dump'
docker compose cp database:/tmp/snapshot.dump ./snapshot.dump

# restore (replaces EVERYTHING in the database with the snapshot)
docker compose stop backend
docker compose cp ./snapshot.dump database:/tmp/snapshot.dump
docker compose exec database sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists /tmp/snapshot.dump'
docker compose start backend
```

* Snapshots are ignored by git only if you name them `*.dump`. Keep them out of the repository: they contain everyone's data.
* A snapshot keeps its dates. A week-old snapshot has no live event today. For fresh dates use `demo_data reset` instead.
* For the separate copy, add `-p shiftboard-demo -f docker-compose.yaml -f docker-compose.demo.yaml` to each command.

---

## Going from demo to real

1. `docker compose exec backend python -m src.demo_data clear`
2. Set `SEED_DEMO_ACCOUNTS=false` and `SHOW_DEMO_LOGINS=false` in `.env`, then `docker compose up -d --force-recreate`.
3. Remove the starter accounts and venues once (see section A).
4. Check `.secrets/stack.env`: `SECRET_KEY` is a long random value of your own, and `SUPER_ADMIN_PASSWORD` isn't a demo one.

## Troubleshooting

| You see | Do this |
| :--- | :--- |
| `relation "venues" does not exist` | The backend hasn't finished starting. Wait for `docker compose ps` to show it up, then run the loader again. |
| `Nothing changed. Use reset ...` | Demo data is already loaded. Use `reset` to refresh it or `clear` to remove it. |
| `--manager-email ...: no such account, skipped` | That person hasn't signed in or been created yet. Create them (Admin → People), then run `reset` with the option again. |
| A demo login is refused | The password is whatever `--password` was at the last load (`Demo12345!` by default). Demo accounts use the email + password form, not Google. |
| `service "backend" is not running` | Start the stack first: `docker compose up -d`. |