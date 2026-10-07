# Phase 37.2.1: Call Times Read on the Event's Start Day (v0.37.3)

**Why:** in the event form, a call time typed earlier than the event's start could land on the wrong day. For an event starting 9:00 AM that runs several days, typing 8:00 AM gave "Starts 23 hr after the event starts (the next day)". It should be 1 hour before.

**The cause:** 0.37.2 read a typed time as "after the start" whenever that time fell inside the event. For an event longer than a day, every clock time falls inside it, so nothing could ever be read as "before".

## What changes

### The rule for a typed call time
* The event's start is the usual start for its shifts. A call time is a time **on the day the event starts**:
  - earlier than the event's start → **before** it (event 9:00 AM, typed 8:00 AM → 1 hr before)
  - later than the event's start → **after** it, the same day (event 9:00 AM, typed 2:00 PM → 5 hr after)
* The event's length no longer matters.
* **One exception, for overnight events:** a time more than 12 hours before the start is taken as the next day (event 10:00 PM, typed 1:00 AM → 3 hr after, the next day). 12 hours early is the most a shift may be, so such a time could not be meant as "before".
* The limits are unchanged: at most 12 hours before the event starts, and before the event ends. A time that breaks them is refused when saving, as in 0.37.2.

### Not changed
* **Frontend only, one function.** No backend, database, API or settings change. 217 API operations.
* Nothing already saved is changed. See Part R for a shift that was saved on the wrong day.

**Version 0.37.3** (Phase 37.2.1 takes the next patch number). `frontend/package.json` and `backend/src/version.py` are both bumped, and the CHANGELOG entry is included below. The README doesn't change (no architecture change). **This covers the standing directive for this phase, so don't bump again.**

## 0. Rules for this phase
* Touch **only** the four files below. In particular, don't touch any backend file except `backend/src/version.py`.
* Do **NOT** run any `docker` or `docker compose` command, any SQL, or the demo data loader. Andrew does that himself (Part R).
* No database change. No new packages. No `VITE_` variables. Leave `agy_system_instructions.md` alone.
* **Code fences are not file content.** Every *Find* / *Replace with* block is wrapped in fence lines of three backticks. Those lines are Markdown; never write them into a file.
* **EDITS (6 in 4 files):** each edit is an exact *Find* → *Replace with*; every *Find* appears **exactly once** in the current file; apply them in order, top to bottom of each file.
  - If a *Find* doesn't match, stop and report it. Don't improvise a different edit.
  - Keep each file's existing line endings (all 4 have LF on this computer). Match on the text.
* **Verification.** The edits were generated from the files in your repo (0.37.2 is applied: the four files were read again today and match the tested 0.37.2) and replayed by a script: each *Find* matched exactly once, and the result is the code that was tested.
  - **In real Chromium, with the demo data**, typing into the Call time box:
    - **The reported case:** event 9:00 AM, nine days long. 8:00 AM → "Starts 1 hr before the event starts"; 6:00 AM → 3 hr before; 10:00 AM → 1 hr after; 11:30 PM → 14 hr 30 min after; 9:00 AM → no line (same as the event). Published with 8:00 AM: the shift is saved at 8:00 AM on the event's first day.
    - **A long day:** event 8 AM to 10 PM. 8:30 PM → 12 hr 30 min after; 7:15 AM → 45 min before.
    - **An evening:** event 6 PM to 11 PM. 5:00 PM → 1 hr before; 7:30 PM → 1 hr 30 min after; 6:00 AM → 12 hr before; 5:00 AM → the next day, and refused on saving ("its call time must be before the event ends").
    - **Overnight:** event 10 PM to 3 AM. 1:00 AM → 3 hr after (the next day); 9:00 PM → 1 hr before; 11:00 PM → 1 hr after.
    - Everything checked for 0.37.2 was run again and behaves the same: prefilled boxes, moving the event moves the call times, **Same as the event**, edit, posting from a template, the roster and worker tags, and a phone.
    - No page errors and no console errors.
  - **Backend:** only the version number changes. It imports cleanly and reports **0.37.3**. The backend suites were not run again, because no backend code changed.
  - **Not tested:** nothing was run in Docker or behind the Cloudflare tunnel.

  Don't "improve" them.

---

# PART A: Frontend

## A1. `frontend/src/components/ShiftEventFormModal.jsx` (3 EDITS)
* `offsetFor(typed, eventClock)` is rewritten and loses its third argument.
* The derived value `eventLength` is removed (nothing else used it).
* No state, payload or styling changes. The row's `offset` field and the `start_time` sent for each shift work as before.

**Edit 1.** Find:
```jsx
}
/**
 * A typed clock time as minutes from the event's start. `length` = how long the event runs, in minutes.
 *   during the event            -> after the start      (event 8 AM to 10 PM, typed 8:30 PM  ->  +750)
 *   otherwise, up to 12 h early -> before the start     (event 6 PM to 11 PM, typed 5:00 PM  ->  -60)
 *   anything else               -> after the end; saving says it must be before the event ends
 */
function offsetFor(typed, eventClock, length) {
  const t = clockMinutes(typed);
  const b = clockMinutes(eventClock);
  if (t === null || b === null) return 0;
  const after = (((t - b) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  if (after < (length > 0 ? length : 720)) return after;
  return after - DAY_MIN >= -720 ? after - DAY_MIN : after;
}
function gapText(minutes) {
```
Replace with:
```jsx
}
/**
 * A typed clock time as minutes from the event's start (0.37.3).
 * It is read as a time on the day the event starts, however long the event runs:
 *   earlier than the event's start -> before it    (event 9:00 AM, typed 8:00 AM  ->  -60)
 *   later than the event's start   -> after it     (event 9:00 AM, typed 2:00 PM  ->  +300)
 * One exception keeps overnight events working: a time more than 12 hours before the start is
 * the next day (event 10:00 PM, typed 1:00 AM -> +180). 12 hours early is the most a shift may be.
 */
function offsetFor(typed, eventClock) {
  const t = clockMinutes(typed);
  const b = clockMinutes(eventClock);
  if (t === null || b === null) return 0;
  const d = t - b;
  return d < -720 ? d + DAY_MIN : d;
}
function gapText(minutes) {
```

**Edit 2.** Find:
```jsx
  // Phase 37.2: the event's start as a clock time ('18:00'); every shift's call time is shown relative to it
  const eventClock = isTemplate ? tplStart : (start && start.length >= 16 ? start.slice(11, 16) : '');
  // ...and how long the event runs, in minutes (0 until both times are set)
  const eventLength = isTemplate
    ? (clockMinutes(tplStart) !== null && clockMinutes(tplEnd) !== null ? (((clockMinutes(tplEnd) - clockMinutes(tplStart)) % DAY_MIN) + DAY_MIN) % DAY_MIN : 0)
    : (start && end && start.length >= 16 && end.length >= 16 ? Math.max(0, Math.round((localMs(end) - localMs(start)) / 60000)) : 0);

  // Phase 27: effective clock-in location check for this event
```
Replace with:
```jsx
  // Phase 37.2: the event's start as a clock time ('18:00'); every shift's call time is shown relative to it
  const eventClock = isTemplate ? tplStart : (start && start.length >= 16 ? start.slice(11, 16) : '');

  // Phase 27: effective clock-in location check for this event
```

**Edit 3.** Find:
```jsx
                        disabled={!eventClock}
                        title={eventClock ? 'When this shift starts. Filled in from the event; change it if this position starts earlier or later.' : "Set the event's start first"}
                        onChange={(e) => updateRow(r.key, { offset: e.target.value ? offsetFor(e.target.value, eventClock, eventLength) : 0 })}
                        className={`${inputCls} ${offset ? 'border-brand-500/60' : ''} disabled:opacity-50`}
                      />
```
Replace with:
```jsx
                        disabled={!eventClock}
                        title={eventClock ? 'When this shift starts. Filled in from the event; change it if this position starts earlier or later.' : "Set the event's start first"}
                        onChange={(e) => updateRow(r.key, { offset: e.target.value ? offsetFor(e.target.value, eventClock) : 0 })}
                        className={`${inputCls} ${offset ? 'border-brand-500/60' : ''} disabled:opacity-50`}
                      />
```

---

# PART V: Version & changelog (the standing directive, done for you)

## V1. `frontend/package.json` (1 EDIT)

**Edit 1.** Find:
```json
  "name": "shiftboard-frontend",
  "private": true,
  "version": "0.37.2",
  "type": "module",
  "scripts": {
```
Replace with:
```json
  "name": "shiftboard-frontend",
  "private": true,
  "version": "0.37.3",
  "type": "module",
  "scripts": {
```

---

## V2. `backend/src/version.py` (1 EDIT)

**Edit 1.** Find:
```python
container is still running an old build.
"""
APP_VERSION = "0.37.2"
```
Replace with:
```python
container is still running an old build.
"""
APP_VERSION = "0.37.3"
```

---

## V3. `CHANGELOG.md` (1 EDIT)
The new section goes above `[0.37.2]`.

**Edit 1.** Find:
```markdown
All notable changes to ShiftUp (called ShiftBoard until 0.37.0). The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/): while pre-1.0, **0.&lt;phase&gt;.&lt;sub-phase&gt;** (see README → Versioning & releases).

The newest version goes at the top. Each entry uses a `## [x.y.z] - YYYY-MM-DD - Phase N: title` heading, followed by bullets under **Added / Changed / Fixed / Removed**.

## [0.37.2] - 2026-10-07 - Phase 37.2: A call time for each shift
```
Replace with:
```markdown
All notable changes to ShiftUp (called ShiftBoard until 0.37.0). The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/): while pre-1.0, **0.&lt;phase&gt;.&lt;sub-phase&gt;** (see README → Versioning & releases).

The newest version goes at the top. Each entry uses a `## [x.y.z] - YYYY-MM-DD - Phase N: title` heading, followed by bullets under **Added / Changed / Fixed / Removed**.

## [0.37.3] - 2026-10-07 - Phase 37.2.1: Call times read on the event's start day

### Fixed
- **A call time typed earlier than the event's start is now before it, whatever the event's length.** For an event starting at 9:00 AM, typing 8:00 AM gives "1 hr before the event starts". Before this fix, an event longer than a day turned it into 8:00 AM the next morning ("23 hr after").
  - A typed time is read as a time on the day the event starts: earlier = before the start, later = after it.
  - Overnight events still work: a time more than 12 hours before the start is taken as the next day (1:00 AM for a 10:00 PM event).
- Only the event form changed (`frontend/src/components/ShiftEventFormModal.jsx`). Nothing saved is changed by this version: a shift that was saved on the wrong day stays there until its call time is set again.

## [0.37.2] - 2026-10-07 - Phase 37.2: A call time for each shift
```

---

# PART R: For Andrew: restart and try it (AGY: don't run any of this)

## 1. Restart (no database change)
```
docker compose restart frontend
```
In each stack's folder. The backend reloads by itself. A hard refresh (Ctrl+F5) makes sure the browser has the new form.

## 2. Check
1. Admin → System: *Web app 0.37.3 · Server 0.37.3*.
2. Post or edit an event that starts at 9:00 AM. Type 8:00 AM into a shift's Call time: the row says "Starts 1 hr before the event starts".
3. Type 10:00 AM: "Starts 1 hr after the event starts".

## 3. Fixing a shift that was saved on the wrong day
The Bartender shift in your "Test" event was saved as 8:00 AM **the next day**. This version doesn't change saved shifts, so it will still open that way.
1. Edit the event.
2. On that row, click **Same as the event**.
3. Type 8:00 AM again. It now reads "Starts 1 hr before the event starts". Save.

Typing 8:00 AM over the existing 8:00 AM without step 2 does nothing, because the box's value hasn't changed.

## 4. Things to know
* A call time on a **later day** of a multi-day event can't be typed into this box (it holds a clock time only, read on the first day). Say if you need that; it would need a date next to the time.
* Your test event ends nine days after it starts, so every shift in it "ends" on the last day and pay estimates cover the whole stretch. That is how the event's end is used today (start only, as chosen for 0.37.2).

---

**"CRITICAL SYSTEM DIRECTIVE: Starting immediately, upon the successful completion of any future phase or feature implementation, you must autonomously bump the version number in `frontend/package.json`, append a bulleted summary of changes to `CHANGELOG.md`, and update `README.md` if the architecture changed. Do not ask for permission to do this."**

(For this phase, Part V already does the version and the changelog for 0.37.3. Apply it as written and don't bump again.)