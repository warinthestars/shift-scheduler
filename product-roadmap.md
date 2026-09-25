# ShiftBoard: Product Review & Roadmap

*Last updated Sep 25, 2026, after Phase 26.3 and a hands-on review of the dev site (see `claude/venue-readiness-review.md`).*

Written from the point of view of the three people who use this:
- a **bartender or AV tech on their phone** between shifts
- a **venue manager** trying to staff Friday night
- **you, as platform admin**

The question driving this version: **"If we handed this to a venue tomorrow, where would they feel limited?"**

⚠️ = schema change. Rebuild with `docker compose down -v && docker compose up -d --build`, or use the keep-data SQL included in each phase prompt.

---

## 1. Done so far

| Phase | What shipped |
|---|---|
| 24 | Hardening: fixed silent auto-approval; removed the default manager password; mobile menu; demo logins behind `SHOW_DEMO_LOGINS`; `/users/me` fix; role filter fix; swap targets limited to the venue team |
| 25 – 25.4 | Editable venue profiles: timezone, phone, arrival instructions, dress code, notes, approval policy, location. Per-venue positions with default pay, ranges and hidden pay. Public venue pages. Wide two-column modals. Notes at three levels. Approval per shift and per position. Editable posted shifts. Admin password reset and a Local/Firebase badge |
| 26 | Shift lifecycle: cancel an event or position with a reason, remove a person, duplicate or repeat weekly, time sheets with an audit log, no-show, per-person pay rate, payroll CSV uses the actual rate |
| 26.1 | One card per event, a details popout, one request per event (with locking), switch or withdraw a request, filters, estimated earnings, overlap warnings |
| 26.2 | Worker calendar, big date and time, "next shift" card, staff-only notes (confirmed staff only), change tracking, "Got it" read receipts shown on the manager roster |
| 26.3 | Hidden pay stays hidden on every worker screen (no admin/manager bypass); worker-preview notice |

### Items from the original review now covered
- Workers:
  - "Where am I going and when?": next-shift card, venue timezone, arrival info, dress code, map link
  - events grouped into one card, with filters
  - part of the plain-language pass
- Managers: edit, cancel and duplicate shifts; time-sheet fixes; editable venue; per-venue positions.
- Bugs F1–F7.

### Still open from the original review
- **F8:** clock-in allowed at any time, and coordinates ignored. Now **Phase 27**.
- Team, invites and ratings. Now **Phase 29**, expanded.
- Notifications. Now **Phase 28**, moved up.
- Worker profile, certifications and earnings. Now **Phases 32 and 33**.
- Waitlist. Now **Phase 34**.

---

## 2. Findings from the hands-on review (Sep 25)

**Blockers: a venue would hit these in week one**
1. **No notifications.** Posts, approvals, edits, cancellations and late arrivals reach no one unless they open the site. Service workers live on SMS; Instawork, Qwick, 7shifts and Homebase all text or push.
2. **No way to bring staff in.** There's no invite link or QR code and no bulk import, and only admins can create accounts. "Book my team instantly" exists, but managers have no Team page to see or edit the team.
3. **Clock-in has no guardrails.** A Sep 25 clock-in/out on a Sep 30 shift was accepted and marked *Completed, 0.00 h*. The location and radius are configured but not enforced, there's no clock-in window, and there's no automatic clock-out.
4. **Open-market only.** There's no direct assign, no "offer to these people", and no worker availability or time off. Venues with regular staff schedule by assignment.

**Would bother them within a month**
5. **No "tonight" view.** The dashboard leads with empty Transfers and Approval boxes and puts the schedule at the bottom. There's no who's-on, who's-clocked-in or who's-late view.
6. **Payroll is a CSV only.** No tip entry or pool split, no overtime flags, no breaks, no pay-period totals, no employee (W-2) vs. contractor (1099) type.
7. **Thin worker profiles.** No required phone, photo, certifications (alcohol-server, food handler, 21+) or emergency contact. Every unrated worker shows **★ 5.0**; it should say "New". Managers can't rate after a shift.
8. **Full or dropped shifts:** no waitlist, and no "post to my team for cover".
9. **Admin-only setup.** Venues can't sign themselves up or add their own co-manager. There are no multi-venue owners.
10. **Phones.** The navigation bar is crowded, and it isn't an installable app yet (`vite-plugin-pwa` is installed but not set up). Needs a real phone test.

**Small:** seed titles don't match their weekday ("Friday Evening Barback" falls on a Saturday).

---

## 3. Next phases

Each phase is sized for one AGY prompt. Where a phase is large it can be split into .1/.2 follow-ups, as Phases 25 and 26 were.

### Phase 27: Clock-in guardrails, opt-in geofence & event locations ⚠️ (was F8 + old Phase 31)
*Payroll and reliability are only as good as the clock.*

**Clock-in window (always on)**
- New venue settings:
  - `clock_in_early_minutes`, default 30
  - `clock_in_late_minutes`, default 60 after start
- Outside the window: "You can clock in from 5:30 PM."

**Geofence: opt-in per venue, overridable per event**
- **Venue default** (Venue Settings → Location for clock-in):
  - `geofence_enabled`, default **off**
  - `geofence_radius_meters`, already exists
  - new `geofence_buffer_meters`, default 150
- **Per event:** `shift_events.geofence_mode` = `venue_default` | `on` | `off`. Set in Post / Edit a Shift. For example, a one-time off-site event is set to **off**. Duplicated or repeating events copy the setting.
- **Effective rule:** the event setting wins unless it's `venue_default`, in which case the venue setting applies.
- **When geofence is off,** clock-in doesn't ask for location at all.

**Event locations: caterers, off-site events, multiple service sites**
- Some clients are **caterers** who staff shifts at clients' sites, not at their own address. An event can have **its own location**.
- **Saved locations** per venue, in a new `venue_locations` table:
  - name, address, lat/lng, optional radius, arrival notes
  - e.g. "Smith Wedding – Oheka Castle", "Javits Center Hall B"
  - Managed in Venue Settings → Locations. Pin set with "Use my current location" or typed lat/lng, like the venue itself.
- **Per event:** `shift_events.location_id` (nullable). Duplicated and repeating events copy it.
- **"Where" on Post / Edit a Shift is a search-as-you-type box**, so there's no separate setup step:
  - It defaults to **Venue address**.
  - Typing filters the venue's saved locations by name or address; pick one and you're done.
  - If what you typed **isn't in the list**, the form expands **inline fields**, right there on the event screen:
    - name (pre-filled with what you typed)
    - address
    - map pin ("Use my current location" or lat/lng)
    - optional geofence radius
    - arrival notes
  - Saving the event **automatically adds the new location to the saved list**, so every place you've worked builds up the list and is one tap away next time.
  - A saved location's details can be edited from the event screen too ("Edit this location"). Changes apply to future and current events at that location.
- **Venue Settings → Locations** is the place to review, rename, edit or **archive** locations. Archived locations drop out of the picker but past events keep them. No hard delete once an event has used a location.
- **The effective location** (event location if set, otherwise the venue) is used everywhere a worker sees "where":
  - Find Shifts cards
  - the event popout
  - Calendar and Shift Details
  - Directions link
  - Add-to-calendar `.ics`
  - My Schedule
  - the geofence check
  
  The venue name stays the employer ("The Copper & Oak Lounge · at Oheka Castle").
- **Location arrival notes** are shown alongside the venue's own arrival instructions, for example "Load in via the service road, check in with the planner".
- **Geofence on a saved location** uses the location's radius if set, otherwise the venue's radius and buffer.

**When geofence is on, the three zones:**

| Where the worker is | Result |
|---|---|
| Inside the radius | Clock-in accepted, marked **On site** |
| Inside radius + buffer | Clock-in accepted, but the entry is flagged **Outside geofence** (with the distance). Shown on the time sheet, roster and payroll CSV for the manager to review. |
| Beyond the buffer | **Blocked**: "You're 0.8 mi from The Copper & Oak Lounge. Clock in when you arrive." |
| Location blocked or unavailable | **Blocked**, with instructions to turn on location |

- The same zones apply to clock-out: the entry is flagged but never blocked, so nobody gets stuck clocked in.
- `time_entries` gets:
  - `clock_in_lat`, `clock_in_lng`, `clock_in_distance_m`
  - `clock_in_geo_status`: `on_site` | `outside_geofence` | `not_checked` | `manager_override`
  - the same four fields for clock-out

**Manager tools**
- **Manager override:** clock someone in or out with a reason (dead phone, bad GPS, off-site). Shown on the time sheet and payroll CSV.
- **Auto clock-out:** new venue setting `auto_clock_out_hours_after_end` (default 2). A background job closes open entries at the *scheduled end* and flags them **"Auto-closed, check hours"**.

**Data fixes**
- Clock out only from an open entry. Never mark "Completed" with 0 minutes or no clock-in.
- **Late flag:** clocked in more than the grace minutes after start. This feeds reliability.
- **Seed data fix:** titles match their weekday.

### Phase 28: Notifications ⚠️ (was Phase 29, moved up; the #1 blocker)
- **`notifications` table**, plus an in-app **bell** with unread count on every page.
- **Email** first (SMTP/Resend; settings in `.secrets`). **SMS** via Twilio behind a setting, so venues can turn it on when ready. Web Push comes in Phase 33 with the installable app.
- **Worker triggers:**
  - request approved or denied
  - shift edited (reuse the 26.2 `info_change` text), cancelled, or removed
  - staff-only notes added
  - swap offered or accepted
  - reminders 24h and 2h before a shift, including "tap to read" when `needs_ack`
- **Manager triggers:**
  - new request waiting
  - swap waiting
  - worker hasn't read an update 24h before the shift
  - not clocked in 10 minutes after start
- **Per-user preferences** per channel, and quiet hours.
- **New-shift alerts** for team members (to venues where they're on the team) with a daily-digest option, so workers aren't spammed.

### Phase 29: Team, invites, direct assign & ratings ⚠️ (old Phase 27, expanded)
- **Team page** on the venue dashboard:
  - everyone on the team or who has worked there
  - add, remove, block
  - private manager notes
  - their positions
  - reliability and rating
- **Invite link + QR code** per venue, with an expiring token. The worker scans it, signs up or signs in, and joins the team. Also **CSV import** (name, phone, email, positions) that sends invites.
- **Managers can create worker accounts and add co-managers** for their own venue (no admin needed).
- **Direct assign:** "Assign to…" on a position books a specific person, respecting overlaps. **"Offer to…"** sends it to 1–5 people, and the first to accept gets it.
- **Ratings:**
  - after the shift ends, rate 1–5 plus "would book again" from the roster
  - feeds `aggregate_rating`
  - **"New"** replaces the fake ★ 5.0 until there are real ratings

### Phase 30: Manager "Tonight" board & live alerts
- The dashboard opens on **Today / This week**. Each shift shows who's booked, **clocked in / not yet / late / no-show**, and who hasn't read updates.
- The Transfers and Approval queues collapse into a small **"Needs you (3)"** strip when empty.
- One tap to message the shift board, call the worker, mark a no-show, or offer the spot (Phase 29).
- Posted Shifts moves below the board, and the week at a glance comes first.

### Phase 31: Availability & time off ⚠️
- **Worker weekly availability:** days and time ranges, e.g. "weekday nights only".
- **Time-off requests:** date range plus reason. The manager approves or denies.
- **Assign / Offer** (Phase 29) shows availability and time off, and warns before assigning someone who's unavailable.
- **Find Shifts** can filter to "fits my availability".

### Phase 32: Worker profile & certifications ⚠️ (from old Phase 28)
- **Profile page:**
  - phone (required for SMS)
  - photo
  - positions I work
  - short bio
  - emergency contact
  - the notification preferences from Phase 28
- **Certifications:** alcohol-server / TIPS, food handler / ServSafe, and "21+ confirmed", with expiry dates and an optional upload.
- **Position requirements:** a venue position can require certifications. Requests are blocked with a clear message ("Bartender at Copper & Oak needs an alcohol-server card"). Expiring certs trigger reminders.
- Managers see verified certs on the roster and the Team page.

### Phase 33: Installable app & mobile polish (old Phase 28)
- **PWA:** add to home screen, app icon, offline shell, **Web Push** (a Phase 28 channel).
- **Bottom tab bar on phones:** Shifts · Calendar · Schedule · Profile, and a slim top bar.
- **Big Clock In button** on the next-shift card, using Phase 27 rules.
- **Hours & earnings:** this week, last week and pay period, from time entries × actual pay rate, with a tips note.
- Finish the plain-language pass (e.g. "Transfer" → "Give away / Swap").
- Real phone test across iOS Safari and Android Chrome.

### Phase 34: Waitlist & cover requests ⚠️ (old Phase 30)
- **Join waitlist** on full positions.
- When a spot frees up (drop, removal, cancelled swap), offer it to the next person:
  - booked automatically under instant policies
  - otherwise a hold of N minutes
- **"I need cover"**: a booked worker posts their shift to the venue team. The first qualified, available teammate to accept takes it, and the manager approves if required. It builds on the existing transfer flow.

### Phase 35: Payroll & tips ⚠️ (from "Later")
- **Tips per event:**
  - the manager enters individual tips, or the total pool
  - pools split by hours (or points) among tip-pool positions
- **Breaks** on time entries: paid or unpaid.
- **Overtime flags:** more than 40 hours a week (and daily, per the venue's state setting).
- **Pay periods:** weekly or biweekly, with totals per worker and a lock and approve step.
- **Worker type:** employee (W-2) or contractor (1099), on the export.
- **Export presets:** generic, Gusto, ADP column layouts.

### Phase 36: Self-serve venues & multi-location owners ⚠️
- **Venue sign-up:** a manager creates a venue, and an admin approves or verifies it.
- **Organizations:** one owner has several venues, a combined dashboard and shared team, and moves workers between venues.
- **Roles:** owner, manager, shift lead (can clock people in and out and mark no-shows, no pay access).

### Later / nice to have
- **Admin "needs attention" dashboard:**
  - unfilled shifts within 48h
  - stale requests
  - low-reliability workers
  - unread updates close to the shift
- **POS / labor integrations** (Toast, Square) to pull tips and sales.
- **Scheduling-notice rules** for cities that require advance notice or premium pay for late changes. Research this before building.
- **Spanish language option** for worker screens.
- **Instant pay / earned-wage access**, only if the platform ever processes pay.

---

## 4. Suggested order and why

1. **27 Clock-in guardrails, geofence & event locations.** Protects payroll and reliability data before real hours are logged, and unlocks caterers and off-site events.
2. **28 Notifications.** The single biggest blocker. It also makes 26.2's read receipts and change tracking actually reach people.
3. **29 Team, invites & direct assign.** How a venue brings its staff in and schedules the way it already works.
4. **30 Tonight board.** Makes the manager's daily view useful, and uses 27's clock data and 28's alerts.
5. **31 Availability & time off**, then **32 Profile & certifications**. Both make assigning and self-booking safe.
6. **33 Installable app.** Web Push and the phone polish are the finish on everything above.
7. **34 Waitlist & cover**, **35 Payroll & tips**, **36 Self-serve & multi-location**.

**Schema batching:**
- If you'd rather wipe the database fewer times, **27 + 28** can share one wipe (time-entry columns plus the notifications table).
- **29 + 31 + 32** are all worker, team and profile tables, and can share another.
- Every phase prompt includes keep-data `ALTER` SQL, so wiping stays optional.
