# Phase 37.1: Green Buttons Again (v0.37.1)

**Why:** 0.37.0 made the main buttons gold with dark text. On the live site that turned out to be hard to read. This phase puts every button and selected tab back to the green it had before 0.37.0, and keeps gold as the accent colour that ties the app to the logo.

## What changes

### 1. Green again (exactly as before 0.37.0)
* **Every main button:** Sign In, Save, Request, Approve, Post an event, Turn on notifications and the rest.
* **The selected tab** in each tab row (My shifts / ShiftBoard / Calendar / Hand-offs, Upcoming / Drafts / Past, List / Calendar, the profile tabs and so on).
* **Other solid fills:** selected filter pills that are filled in, today's date in the worker calendar, a ticked department box, your own messages in the shift chat, and the "saved" toast.
* **Outside the app's screens:** the button in notification emails, the button on the offline page, and the selected view (Month / Week / Day) in the manager calendar.
* These are the same classes the files had in 0.36.1. Nothing new is designed here.

### 2. Still gold (the accent)
* The logo, on the black header.
* Links, the current link in the top bar, small icons next to headings, pay amounts and focus rings.
* The outline or tint of a selected option (for example the chosen shift in an event, or a filter that is switched on).
* A few small markers with no text in them: the loading dots, the phone tab bar's top line, the unread dot on a notification and the dot of the chosen shift.

### 3. The rule from now on
* **Gold is never a button's fill, and nothing has text on solid gold.**
* Green is for buttons and selected tabs, and still means confirmed, booked, on, verified or done. Amber is waiting. Rose is a problem.

### 4. Not changed
* The name (ShiftUp), the logo and icons, the black header, the ShiftBoard tab and everything else from 0.37.0.
* The `brand` colours in `frontend/tailwind.config.js` (only its comment changes).
* **Database: no change. API: no change** (217 operations). **Settings: none. Packages: none.**

**Version 0.37.1.** `frontend/package.json` and `backend/src/version.py` are both bumped, and the CHANGELOG and README updates are included below. **This covers the standing directive for this phase, so don't bump again.**

## How this phase is applied

| Step | What | Who |
| :--- | :--- | :--- |
| **A** | 1 script is already in the repo | Claude put it there. Check it exists; don't change it. |
| **B** | Run the script once. It changes 89 lines in 54 files. | AGY |
| **C, F, V** | 8 edits in 7 files | AGY |
| **R** | Restart and look | Andrew |

The script and the edits touch different files, so the order between B and the rest doesn't matter. Do B first anyway.

## 0. Rules for this phase
* **Don't do the script's work by hand.** Don't change an `emerald` or `brand` class in any file yourself, before or after. The script changes exactly the lines that were tested.
* **Don't edit the script**, its lines or its fingerprints. If it stops, report the message it prints (Part B).
* **Don't run `scripts/phase37_rebrand.py` again.** It was for 0.37.0. Run now, it would stop with a long list of "unexpected" files and change nothing; that is expected and is not a problem to fix.
* Do **NOT** touch:
  - `backend/src/auth.py`, `backend/src/routers/auth.py`, `backend/src/services/firebase.py`, `backend/src/services/always_admin.py`, `backend/src/main.py`
  - `frontend/src/context/AuthContext.jsx`, `frontend/src/api/client.js`, `frontend/vite.config.js`
  - `docker-compose.yaml`, `docker-compose.demo.yaml`, `database/`, `deploy_test_data.sh`, `deploy_test_data.ps1`
  - Any real settings file (`.env`, anything in `.secrets/` that isn't a `.template`, any `*.bak`). Never open, read or print one.
  - In `agy_system_instructions.md`, only the edit in F1. Leave the Standing rules section exactly as it is.
  - `assets/`, `frontend/public/brand/` and `frontend/public/icons/`.
* The script changes none of the sign-in files. The one backend file it changes is `backend/src/services/messaging.py` (one line: the colour of the button in notification emails).
* **Do NOT run any `docker` or `docker compose` command, any SQL, or the demo data loader.** Andrew does that himself (Part R).
* **No database change.** No native PostgreSQL ENUMs, as always. **No new packages. No `VITE_` variables.**
* **Code fences are not file content.** Every *Find* / *Replace with* block in this prompt is wrapped in fence lines of three backticks. Those lines are Markdown; never write them into a file.
* **EDITS (8 in 7 files):** each edit is an exact *Find* → *Replace with*; every *Find* appears **exactly once** in the current file; apply them in order, top to bottom of each file.
  - If a *Find* doesn't match, stop and report it. Don't improvise a different edit.
  - Keep each file's existing line endings (all 7 have LF on this computer). Match on the text.
* **Verification.** Everything below was generated from the files in your repo (0.37.0 is applied: all 131 frontend, guide and version files were read again today and match the tested 0.37.0) and replayed: the script was run on a copy of those files, then every edit was applied. Each *Find* matched exactly once, and the end result is the code that was tested.
  - **The script** was run on a copy of the repo's files:
    - `--check` passes and changes nothing. The real run changes 54 files. A second run says "Already applied" and changes nothing.
    - With one file altered beforehand it stops before writing anything. Any option other than `--check` stops it.
    - Each file is written beside the original and swapped in, so none is left half written.
  - **Exactly as before:** every class list the script restores was compared, by program, with the same class list in the 0.36.1 file. They are identical.
  - **No dark text on gold is left:** the finished code was searched for any text or icon colour on a solid gold fill, including hover states. None. The only solid gold left is the small markers listed above.
  - **Backend:** imports cleanly. 217 API operations, unchanged. The API reports **0.37.1**. **All 22 suites pass against a real PostgreSQL** (1,140 checks).
  - **Frontend:** bundles with no missing imports. In real Chromium, with the demo data:
    - Looked at: the public home page, sign-in, My shifts, the ShiftBoard, an event's details, the worker calendar, Profile → Calendar sync, the manager dashboard and its calendar, venue settings, the admin panel, and a phone.
    - Sign In is the green button it was before. The selected worker tab, "Ask to take it", "Turn on notifications", "Approve" and the manager calendar's selected view are green. Links, heading icons, pay and the current top-bar link are gold.
    - The landing tab, the top bar, the phone tab bar and the 1024px header behave as in 0.37.0 (the same checks were run again).
    - No page errors and no console errors.
  - **Not tested:** nothing was run in Docker or behind the Cloudflare tunnel. Real email was not sent.

  Don't "improve" them.

---

# PART A: Already in the repo (don't create, edit or move it)

Claude placed this file directly. **Check that it exists.** If it is missing, stop and tell Andrew. Don't try to write it.

| File | What it is |
| :--- | :--- |
| `scripts/phase371_buttons.py` | the script for Part B |

---

# PART B: Run the script (once)

**Where:** the repository's root folder (the one that has `docker-compose.yaml`).

## B1. Look first
```
python scripts/phase371_buttons.py --check
```
It must print exactly:
```
Check passed: 54 file(s) would change, 0 already done. Nothing was changed (--check).
```

## B2. Do it
```
python scripts/phase371_buttons.py
```
It must print exactly:
```
Done: 54 file(s) changed, 0 were already done.
```

## B3. Rules for this part
* If `python` isn't found, use `py -3` (Windows) or `python3` (Linux, macOS) with the same arguments, as in Phase 37. **Don't use Docker for this.**
* **If it prints a line starting with `STOP`:** it changed nothing. Copy the whole message into your report and stop the phase. Don't edit the script or the files it names.
* If B1 prints anything other than the line above, stop and report it.
* Run B2 once. A second run prints `Already applied` and changes nothing.
* Don't delete the script afterwards. It stays in the repo as the record of what changed.

## B4. What the script does (for the record; nothing to do here)
* It holds a list of 89 lines as they are in 0.37.0 and what each becomes. It replaces those lines and nothing else.
* 50 files under `frontend/src` get their button and tab classes back (for example `bg-brand-500 hover:bg-brand-400 text-slate-950` becomes `bg-emerald-500 hover:bg-emerald-400 text-slate-950` again, and Sign In gets its green gradient back).
* `frontend/src/index.css`: the manager calendar's selected view button (3 lines).
* `backend/src/services/messaging.py`: the email button's colour (1 line).
* `frontend/public/offline.html`: the offline page's button (1 line).
* `frontend/public/sw.js`: the cache name becomes `shiftup-shell-v3`, so phones fetch the new offline page (1 line).
* It checks a SHA-256 fingerprint of every file before and after.

---

# PART C: Frontend

## C1. `frontend/tailwind.config.js` (1 EDIT)
Only the comment changes. The `brand` colours themselves stay as they are.

**Edit 1.** Find:
```js
      colors: {
        // Phase 37: ShiftUp gold. 500 is the gold in the logo (assets/main_logo_shift-up.png).
        // Use brand-* for buttons, active tabs, links and accents. Green (emerald-*) is only for
        // "confirmed / booked / on / success"; amber is "waiting"; rose is "problem".
        brand: {
          50: '#FFFDEB',
```
Replace with:
```js
      colors: {
        // Phase 37: ShiftUp gold. 500 is the gold in the logo (assets/main_logo_shift-up.png).
        // 0.37.1: gold is the ACCENT colour: links, the current top-bar link, small icons, pay, focus rings
        // and the outline or tint of a selected option. It is never a button's fill, and never has text on it.
        // Buttons and selected tabs are green (emerald-*), as they were before Phase 37.
        // Green also means "confirmed / booked / on / success"; amber is "waiting"; rose is "problem".
        brand: {
          50: '#FFFDEB',
```

---

# PART F: Guides

## F1. `agy_system_instructions.md` (1 EDIT)
The colour bullet of rule 13. **Leave the Standing rules section exactly as it is.**

**Edit 1.** Find:
```markdown
13. **Brand (Phase 37):** the service is **ShiftUp**. **ShiftBoard** is only the board of open shifts (the worker's tab, id `find`, and the heading of the public home page).
   * New screens import `APP_NAME` and `BOARD_NAME` from `frontend/src/brand.js` and show the logo with `<BrandLogo />` (`frontend/src/components/BrandLogo.jsx`). Never type "ShiftBoard" as the service's name.
   * **Colour:** gold `brand-*` for main buttons, the active tab or link, links, focus rings and section icons; text on solid gold is `text-slate-950`, never white. Green `emerald-*` only for confirmed / booked / on / verified / done. Amber = waiting. Rose = problem.
   * **Logo files** are in `frontend/public/brand/` and `frontend/public/icons/`, cut from `assets/main_logo_shift-up.png`. Don't redraw, recolour or regenerate them, and don't add an SVG version.
   * **Keep these as they are** (people never see them, and renaming breaks things): the database name and user, the Docker network and `shiftboard-demo` stack, demo sign-ins `@shiftboard.com`, browser storage keys starting `shiftboard_`, calendar entry ids ending `@shiftboard`, the time-tracking value `'shiftboard'`, the FCM app name, and the `ShiftBoard.jsx` / `ShiftBoardModal` component names.
```
Replace with:
```markdown
13. **Brand (Phase 37):** the service is **ShiftUp**. **ShiftBoard** is only the board of open shifts (the worker's tab, id `find`, and the heading of the public home page).
   * New screens import `APP_NAME` and `BOARD_NAME` from `frontend/src/brand.js` and show the logo with `<BrandLogo />` (`frontend/src/components/BrandLogo.jsx`). Never type "ShiftBoard" as the service's name.
   * **Colour (changed in 0.37.1):** gold `brand-*` is the ACCENT only: links, the current top-bar link, small icons, pay, focus rings, and the outline or tint of a selected option. **Never fill a button or a tab with gold and never put text on solid gold.** Buttons and selected tabs are green `emerald-*` (main button: `bg-emerald-500 hover:bg-emerald-400 text-slate-950`; selected tab: `bg-emerald-600 text-white`). Green also means confirmed / booked / on / verified / done. Amber = waiting. Rose = problem.
   * **Logo files** are in `frontend/public/brand/` and `frontend/public/icons/`, cut from `assets/main_logo_shift-up.png`. Don't redraw, recolour or regenerate them, and don't add an SVG version.
   * **Keep these as they are** (people never see them, and renaming breaks things): the database name and user, the Docker network and `shiftboard-demo` stack, demo sign-ins `@shiftboard.com`, browser storage keys starting `shiftboard_`, calendar entry ids ending `@shiftboard`, the time-tracking value `'shiftboard'`, the FCM app name, and the `ShiftBoard.jsx` / `ShiftBoardModal` component names.
```

---

## F2. `product-roadmap.md` (1 EDIT)

**Edit 1.** Find:
```markdown
  - **Read a worker's own calendar** (they paste its private link) to warn before they request a shift that clashes with something personal.

### Phase 37: ShiftUp branding and the ShiftBoard tab (shipped in 0.37.0)
- ✅ **New name and look:** the service is ShiftUp (shift-up.team), with the gold logo, a black header and gold buttons. Green is kept for "confirmed".
- ✅ **Worker view split in two:** **My shifts** (what's theirs) and the **ShiftBoard** (everything else that's up). The app opens whichever fits their week.
- ⏳ **Later, if wanted:** a light theme; the logo in emails.
```
Replace with:
```markdown
  - **Read a worker's own calendar** (they paste its private link) to warn before they request a shift that clashes with something personal.

### Phase 37: ShiftUp branding and the ShiftBoard tab (shipped in 0.37.0)
- ✅ **New name and look:** the service is ShiftUp (shift-up.team), with the gold logo, a black header and gold accents. Buttons are green (gold buttons were tried in 0.37.0 and changed back in 0.37.1: dark text on gold was hard to read).
- ✅ **Worker view split in two:** **My shifts** (what's theirs) and the **ShiftBoard** (everything else that's up). The app opens whichever fits their week.
- ⏳ **Later, if wanted:** a light theme; the logo in emails.
```

---

# PART V: Version, changelog & README (the standing directive, done for you)

## V1. `frontend/package.json` (1 EDIT)

**Edit 1.** Find:
```json
  "name": "shiftboard-frontend",
  "private": true,
  "version": "0.37.0",
  "type": "module",
  "scripts": {
```
Replace with:
```json
  "name": "shiftboard-frontend",
  "private": true,
  "version": "0.37.1",
  "type": "module",
  "scripts": {
```

---

## V2. `backend/src/version.py` (1 EDIT)

**Edit 1.** Find:
```python
container is still running an old build.
"""
APP_VERSION = "0.37.0"
```
Replace with:
```python
container is still running an old build.
"""
APP_VERSION = "0.37.1"
```

---

## V3. `CHANGELOG.md` (1 EDIT)
The new section goes above `[0.37.0]`.

**Edit 1.** Find:
```markdown
All notable changes to ShiftUp (called ShiftBoard until 0.37.0). The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/): while pre-1.0, **0.&lt;phase&gt;.&lt;sub-phase&gt;** (see README → Versioning & releases).

The newest version goes at the top. Each entry uses a `## [x.y.z] - YYYY-MM-DD - Phase N: title` heading, followed by bullets under **Added / Changed / Fixed / Removed**.

## [0.37.0] - 2026-10-06 - Phase 37: ShiftUp branding and the ShiftBoard tab
```
Replace with:
```markdown
All notable changes to ShiftUp (called ShiftBoard until 0.37.0). The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/): while pre-1.0, **0.&lt;phase&gt;.&lt;sub-phase&gt;** (see README → Versioning & releases).

The newest version goes at the top. Each entry uses a `## [x.y.z] - YYYY-MM-DD - Phase N: title` heading, followed by bullets under **Added / Changed / Fixed / Removed**.

## [0.37.1] - 2026-10-06 - Phase 37.1: Green buttons again

### Changed
- **Buttons and selected tabs are green again**, exactly as they were before 0.37.0. Dark text on a gold button was hard to read.
  - That covers every main button (Sign In, Save, Request, Approve, Post an event and the rest), the selected tab in each tab row, selected filter pills with a solid fill, today's date in the worker calendar, your own messages in the shift chat, and the manager calendar's selected view.
  - The button in notification emails and on the offline page is green again too.
- **Gold is now the accent colour only:** the logo, links, the current link in the top bar, small icons, pay, focus rings, and the outline or tint of a selected option. Nothing has text on solid gold any more.
- The black header, the logo, the name and the ShiftBoard tab from 0.37.0 are unchanged.
- The service worker's cache name is `shiftup-shell-v3`, so phones fetch the new offline page.

### Added
- `scripts/phase371_buttons.py`: the one-off script that made this change in 54 files.

## [0.37.0] - 2026-10-06 - Phase 37: ShiftUp branding and the ShiftBoard tab
```

---

## V4. `README.md` (2 EDITS)

**Edit 1.** Find:
```markdown
frontend/tailwind.config.js   the brand colours (brand-50 … brand-950; brand-500 is the logo's gold)
scripts/phase37_rebrand.py    the one-off rename and recolour of Phase 37 (kept for the record; it does nothing on a second run)
database/init.sql    the whole schema (runs on an empty database)
database/upgrades/   "keep your data" SQL per version, for a database you don't want to wipe
```
Replace with:
```markdown
frontend/tailwind.config.js   the brand colours (brand-50 … brand-950; brand-500 is the logo's gold)
scripts/phase37_rebrand.py    the one-off rename and recolour of Phase 37 (kept for the record; it does nothing on a second run)
scripts/phase371_buttons.py   the one-off change of 0.37.1: buttons and selected tabs back to green (same safety checks)
database/init.sql    the whole schema (runs on an empty database)
database/upgrades/   "keep your data" SQL per version, for a database you don't want to wipe
```

**Edit 2.** Find:
```markdown
9. **Brand and colour** (since 0.37.0):
   * The service is **ShiftUp**; the board of open shifts is the **ShiftBoard**. In new screens import `APP_NAME` and `BOARD_NAME` from `frontend/src/brand.js`, and show the logo with `<BrandLogo />`.
   * **Gold (`brand-*`)** is for main buttons, the active tab or link, links, focus rings and section icons. Text on solid gold is `text-slate-950`, never white.
   * **Green (`emerald-*`)** only means confirmed, booked, on, verified or done. **Amber** means waiting. **Rose** means a problem. Don't use green for a button that isn't one of those.
   * Two areas keep their own accent from before 0.37.0: the admin screens and the shift chat are indigo, and the organization screens are teal.
   * Don't redraw or recolour the logo. New sizes are cut from `assets/main_logo_shift-up.png`.
```
Replace with:
```markdown
9. **Brand and colour** (since 0.37.0):
   * The service is **ShiftUp**; the board of open shifts is the **ShiftBoard**. In new screens import `APP_NAME` and `BOARD_NAME` from `frontend/src/brand.js`, and show the logo with `<BrandLogo />`.
   * **Gold (`brand-*`) is the accent colour** (since 0.37.1): links, the current link in the top bar, small icons, pay, focus rings, and the outline or tint of a selected option. **Never fill a button or a tab with gold, and never put text on solid gold.**
   * **Green (`emerald-*`) is for buttons and selected tabs**, as before 0.37.0: `bg-emerald-500 hover:bg-emerald-400 text-slate-950` for a main button, `bg-emerald-600 text-white` for a selected tab. Green also means confirmed, booked, on, verified or done. **Amber** means waiting. **Rose** means a problem.
   * Two areas keep their own accent from before 0.37.0: the admin screens and the shift chat are indigo, and the organization screens are teal.
   * Don't redraw or recolour the logo. New sizes are cut from `assets/main_logo_shift-up.png`.
```

---

# PART R: For Andrew: restart and look (AGY: don't run any of this)

## 1. Restart the frontend, in EVERY stack (no database change)

```
docker compose restart frontend
```
* **This is what made dev and live look different after 0.37.0.** The dev site's frontend was still using the colour settings from before 0.37.0: its Sign In button stayed green, and most of its links and icons had no colour at all. The live site had picked the new ones up.
* A running frontend doesn't reliably notice a change to its colour settings (file-change events often don't reach a container on Windows), and it reads its version number only when it starts. So restart it in the dev folder and in the live folder whenever a phase changes colours or the version.
* The backend reloads by itself. Nothing in the database changes, so no wipe and no SQL. Your usual `docker compose up -d --build` works too.

## 2. Checklist
1. Admin → System: *Web app 0.37.1 · Server 0.37.1*, on both sites.
2. **Both sites now look the same.** Sign In is green on dev and on live.
3. The header is still black with the gold logo. Links, small heading icons and pay amounts are gold.
4. As a worker: the selected tab (My shifts or ShiftBoard) is green. "Ask to take it" and "Turn on notifications" are green.
5. As a manager: "Post an event", "Approve" and the selected Upcoming / Month buttons are green.
6. Nothing anywhere has dark text on a yellow button.
7. A browser that still shows the old colours needs a hard refresh (Ctrl+F5).

## 3. Things to know
* **"As before" means dark text on most buttons.** Before 0.37.0, most main buttons were bright green with dark text, and only some (and the selected tabs) were darker green with white text. This phase restores each one exactly as it was. If you'd rather have white text on every green button, say so: that is a small follow-up.
* **Amber buttons are unchanged.** "Review now", "Read the update" and "Open profile" are dark text on amber, as they were before 0.37.0. Say if those are hard to read too.
* **Emails already sent** keep the gold button. New ones are green.
* The admin screens are still indigo and the organization screens teal, as before.

---

**"CRITICAL SYSTEM DIRECTIVE: Starting immediately, upon the successful completion of any future phase or feature implementation, you must autonomously bump the version number in `frontend/package.json`, append a bulleted summary of changes to `CHANGELOG.md`, and update `README.md` if the architecture changed. Do not ask for permission to do this."**

(For this phase, Part V already does all three for 0.37.1. Apply it as written and don't bump again.)