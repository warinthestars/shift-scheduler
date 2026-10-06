# Phase 37: ShiftUp Branding & the ShiftBoard Tab (v0.37.0)

**Why:** the service has its own name and logo now. The domain is `shift-up.team`, so the product is **ShiftUp**. The old name gets a new job: the **ShiftBoard** is the board of open shifts. Workers get it as its own tab, separate from **My shifts**.

## What changes

### 1. The name
* The service is **ShiftUp** everywhere a person can read it: every screen, emails, text messages, notifications, calendar names, the API title, the installed app, the README and the deployment guide.
* **ShiftBoard** now means only the board of open shifts: the worker's tab, and the heading of the public home page.
* Names people never see keep `shiftboard`. Renaming them would sign people out, duplicate calendar entries or break a running stack:
  - the database name and user, the Docker network, the `shiftboard-demo` stack
  - demo sign-ins (`@shiftboard.com`)
  - browser storage keys that start `shiftboard_`
  - calendar entry ids that end `@shiftboard`
  - the time-tracking value `'shiftboard'`, and the FCM app name
  - the shift chat's component names, `ShiftBoard.jsx` and `ShiftBoardModal`

### 2. The colours
* Gold from the logo (`#FDD400`) is the brand colour. It is the Tailwind colour `brand-*`.
* **Gold:** main buttons, the active tab or link, links, focus rings, section icons and pay. Text on a solid gold button is dark (`text-slate-950`), never white.
* **Green (`emerald-*`) stays** where it means confirmed, booked, on, verified or done.
* **Amber** (waiting) and **rose** (a problem) are not changed.
* The header, the sign-in page and the invite page have a black background, like the logo.
* The admin screens and the shift chat keep indigo, and the organization screens keep teal. Those are area colours, not the brand.

### 3. The logo and icons
* Cut from `assets/main_logo_shift-up.png`. Nothing is redrawn.
* Header: the mark and the name side by side. Sign-in and invite pages: the full logo with "Teams App".
* New browser tab icons, installed-app icons and the notification badge.

### 4. The worker view: My shifts and the ShiftBoard
* **My shifts** is unchanged: everything that is theirs.
* **ShiftBoard** replaces "Find shifts". It lists every event that is up and **isn't theirs yet**. An event leaves the board when the worker:
  - asks for a shift in it, or is booked in it
  - joins a waitlist in it
  - is offered a shift in it by a manager
* A line at the top of the board says how many events are already on My shifts, and opens that tab.
* The "Hide ones I've requested" filter is removed. It has nothing left to hide.
* **Top bar:** a worker has two links, **My shifts** and **ShiftBoard**. On a phone they are the first two tabs of the bottom bar.
* **Which tab opens first** (only when the address has no `?tab=`):
  - **My shifts** when, in the next 7 days, they have a shift that is booked or asked for; or they are clocked in; or an offer is waiting on them (from a manager, or a waitlist spot being held); or they are in line for a shift that starts within 7 days.
  - **ShiftBoard** otherwise.
* `/worker?tab=schedule` and `/worker?tab=find` still open one or the other, so every existing notification link keeps working. `/shiftboard` is a new short address for the second.
* Calendar and Hand-offs are unchanged.

### 5. Small wording
* The shift chat is called **Shift chat** everywhere. Two buttons said "Board".
* "The public shift board" in cover requests is now "the ShiftBoard".
* Downloads are named `shiftup-hours-….csv` and `shiftup.ics`.

### Database, API, settings
* **Database: no change.** No table, column or SQL.
* **API: no change.** Still 217 operations. Only the title (`ShiftUp API`) and message texts change.
* **Settings: no new setting.** The default `EMAIL_FROM` becomes `ShiftUp <no-reply@example.com>`.
* **No new packages.**

**Version 0.37.0.** `frontend/package.json` and `backend/src/version.py` are both bumped, and the CHANGELOG and README updates are included below. **This covers the standing directive for this phase, so don't bump again.**

## How this phase is applied
It has four steps. **Do them in this order.**

| Step | What | Who |
| :--- | :--- | :--- |
| **A** | 10 pictures and 1 script are already in the repo | Claude put them there. Check they exist; don't change them. |
| **B** | Run the script once. It renames and recolours 113 files. | AGY |
| **C, D, E, F, V** | 2 new files, 46 edits in 15 files, 1 file deleted | AGY |
| **R** | Restart and try it | Andrew |

The edits in Parts D, F and V were written against the files **as the script leaves them**. Before Part B they will not match.

## 0. Rules for this phase
* **Order:** Part A, then Part B, then the rest. Never apply an edit from Parts D, F or V before the script has run.
* **Don't do the script's work by hand.** Don't rename "ShiftBoard" or change an `emerald` class in any file yourself, before or after. The script changes exactly what was tested, and nothing else should change.
* **Don't edit the script**, its rules or its fingerprints. If it stops, report the message it prints (rule in Part B).
* Do **NOT** touch, apart from what the script does:
  - `backend/src/auth.py`, `backend/src/routers/auth.py`, `backend/src/services/firebase.py`, `backend/src/services/always_admin.py`
  - `frontend/src/context/AuthContext.jsx`, `frontend/src/api/client.js`, `frontend/vite.config.js`
  - the CORS block in `backend/src/main.py`
  - `docker-compose.yaml`, `docker-compose.demo.yaml`, `database/init.sql`, `database/upgrades/`, `deploy_test_data.sh`, `deploy_test_data.ps1`, `test_deployment.md`
  - Any real settings file (`.env`, anything in `.secrets/` that isn't a `.template`, any `*.bak`). Never open, read or print one.
  - In `agy_system_instructions.md`, only the two edits in F1. Leave the Standing rules section exactly as it is.
  - `assets/` and every picture listed in Part A.
* **The sign-in files:** the script changes text only, and only these lines. This is the explicit approval for them; nothing else in these files may change.
  - `backend/src/auth.py`: the sentence "Contact your venue or ShiftBoard to turn it back on." (2 lines) now says ShiftUp.
  - `backend/src/routers/auth.py`: the same sentence (2 lines) and one comment. This file has Windows line endings and keeps them.
  - `backend/src/main.py`: two log lines, the API title and the welcome message.
  - `frontend/src/firebase.js`: one comment.
* **Keep these names as they are:** everything in the list under "The name" above. Don't "finish" the rename.
* **Do NOT run any `docker` or `docker compose` command, any SQL, or the demo data loader.** Andrew does that himself (Part R).
* **No database change.** Don't touch `models.py` or `init.sql`. No native PostgreSQL ENUMs, as always.
* **No new packages**, backend or frontend. No `VITE_` variables. The icons are from the same `lucide-react` 0.359.0 the repo has.
* **Code fences are not file content.** Every file and every *Find* / *Replace with* block in this prompt is wrapped in fence lines of three backticks. Those lines are Markdown; never write them into a file.
* **NEW FILES (2):** create them with exactly the content shown, with LF line endings. Each one states its first and last line: check them when you finish.
* **EDITS (46 in 15 files):** each edit is an exact *Find* → *Replace with*; every *Find* appears **exactly once** in the file as it is after Part B; apply them in order, top to bottom of each file.
  - If a *Find* doesn't match, stop and report it. Don't improvise a different edit.
  - Keep each file's existing line endings (all 15 have LF on this computer). Match on the text.
* **Verification.** Everything below was generated from the files in your repo (0.36.1 is applied) and replayed: the script was run on a copy of your files, then every edit was applied to its result. Each *Find* matched exactly once, and the end result is the code that was tested.
  - **The script** was run on a copy of the repo's files with their real line endings:
    - `--check` passes and changes nothing.
    - The real run changes 113 files, and the three files with Windows line endings still have them.
    - A second run says "Already applied" and changes nothing. So does a run after all of this phase's edits.
    - With one file altered beforehand, or with an extra file that uses the old name, it stops before writing anything.
    - Any option other than `--check` stops it.
    - Each file is written beside the original and swapped in, so none is left half written.
  - **Backend:** imports cleanly. 217 API operations, unchanged. The API reports **0.37.0** and is titled *ShiftUp API*.
  - **All 22 suites pass against a real PostgreSQL** (1,140 checks). The checks that read the product's name in notifications and calendar feeds were updated to expect ShiftUp. No check had to change for any other reason.
  - **Frontend:** bundles with no missing imports. In real Chromium, with the demo data:
    - **Landing tab:** a brand-new worker lands on the ShiftBoard. After asking for a shift 8 or more days away they still land on the ShiftBoard, that event is gone from the board, and the line "1 event is already on My shifts" appears. After asking for one inside 7 days they land on My shifts.
    - **Top bar:** a worker has My shifts, ShiftBoard, Hours & pay and Venues; the link for the open tab is marked. `/shiftboard` opens the ShiftBoard.
    - **Phone:** the bottom bar reads My shifts, ShiftBoard, Calendar, Hand-offs, Profile. A fresh load of `/shiftboard` marks the ShiftBoard tab. Switching between the two from the menu closes the menu. No sideways scrolling.
    - **Width:** at 1024px and 1100px the top bar stays on one line for a worker and for a shift lead (five links).
    - **Looked at:** the public home page, sign-in, My shifts, the ShiftBoard, an event's details, the worker calendar, Profile → Calendar sync, the manager dashboard and its calendar, venue settings and the admin panel.
    - No white text on gold anywhere in the code (searched, including hover states). No page errors and no console errors.
  - **An independent review** read the finished code and the script. It found no data or sign-in problem. What it did find is fixed in the code below: the phone menu staying open, the phone tab bar marking the wrong tab on a fresh load of `/shiftboard`, the script accepting unknown options, and the wording in "Small wording" above.
  - **Not tested:** nothing was run in Docker or behind the Cloudflare tunnel. The installed app's new icon was not checked on a real phone. Real email was not sent.

  Don't "improve" them.

---

# PART A: Already in the repo (don't create, edit, move or regenerate these)

Claude placed these 11 files directly. **Check that each one exists.** If one is missing, stop and tell Andrew. Don't try to make it.

| File | What it is |
| :--- | :--- |
| `frontend/public/brand/logo-mark.png` | the mark alone, transparent, 256×256 |
| `frontend/public/brand/logo-wordmark.png` | the name alone, transparent, 341×96 |
| `frontend/public/brand/logo-full.png` | mark, name and "Teams App", transparent, 567×640 |
| `frontend/public/icons/icon-192.png` | app icon (replaces the old one) |
| `frontend/public/icons/icon-512.png` | app icon (replaces the old one) |
| `frontend/public/icons/maskable-512.png` | app icon for Android's shaped icons (replaces the old one) |
| `frontend/public/icons/apple-touch-icon.png` | iPhone home screen icon (replaces the old one) |
| `frontend/public/icons/badge-96.png` | notification badge, white on transparent (replaces the old one) |
| `frontend/public/icons/favicon-32.png` | browser tab icon (new) |
| `frontend/public/icons/favicon-64.png` | browser tab icon (new) |
| `scripts/phase37_rebrand.py` | the script for Part B |

`assets/main_logo_shift-up.png` is the original they were cut from. Leave it where it is.

---

# PART B: Run the rebrand script (once)

**Where:** the repository's root folder (the one that has `docker-compose.yaml`). **When:** before any edit from Parts C to V.

## B1. Look first
```
python scripts/phase37_rebrand.py --check
```
It must print exactly:
```
Check passed: 113 file(s) would change, 0 already done. Nothing was changed (--check).
```

## B2. Do it
```
python scripts/phase37_rebrand.py
```
It must print exactly:
```
Done: 113 file(s) changed, 0 were already done.
```

## B3. Rules for this part
* If `python` isn't found, use `py -3` (Windows) or `python3` (Linux, macOS) with the same arguments. It needs Python 3.8 or newer and no packages. **Don't use Docker for this.** If there is no Python at all, stop and tell Andrew.
* **If it prints a line starting with `STOP`:** it changed nothing. Copy the whole message into your report and stop the phase. Don't edit the script, don't edit the files it names, and don't carry on with Parts C to V.
* If B1 says anything other than the line above (for example "already done" is not 0), stop and report it.
* Run B2 once. A second run prints `Already applied` and changes nothing; that is fine, but there is no reason to do it.
* Don't delete the script afterwards. It stays in the repo as the record of what changed.

## B4. What the script does (for the record; nothing to do here)
* **Name:** "ShiftBoard" → "ShiftUp" in `backend/src`, `frontend/src`, `frontend/index.html`, `frontend/public/` (manifest, offline page, service worker), `README.md`, `docs/DEPLOYMENT.md`, `product-roadmap.md` and the three `.env.template` files. It skips the code names listed in "The name" above.
* **Colour:** in `frontend/src`, each `emerald` Tailwind class becomes `brand` when it is a button, an active tab, a link, a focus ring, a section icon or pay. It stays green when it means confirmed, booked, on, verified or done. `text-white` on a solid gold background becomes `text-slate-950`.
* **Exact swaps:** the "Find shifts" and "public shift board" wording, the two "Board" buttons, the two download names, the email button's colour, the installed app's colours and its "ShiftBoard" shortcut, the favicon links, and the service worker's cache name (`shiftup-shell-v2`, so phones fetch the new offline page and icons).
* It checks a SHA-256 fingerprint of every file before and after. That is why it must run on the files exactly as they are now.

---

# PART C: Frontend, new files

## C1. NEW FILE `frontend/src/brand.js`
The names, in one place. The first line is `/**` and the **last line is `export const BOARD_NAME = 'ShiftBoard';`**.

```js
/**
 * Phase 37: the product's name in one place.
 *   APP_NAME    the service ("ShiftUp")
 *   BOARD_NAME  the board of open shifts ("ShiftBoard"): the worker's tab and the public home page
 * New code imports these instead of typing the names. Older screens, the backend's emails and calendar names,
 * index.html, public/manifest.webmanifest and public/offline.html have the name written out.
 */
export const APP_NAME = 'ShiftUp';
export const APP_TAGLINE = 'Teams App';
export const BOARD_NAME = 'ShiftBoard';
```

---

## C2. NEW FILE `frontend/src/components/BrandLogo.jsx`
The logo. It shows the pictures from Part A; it draws nothing itself. The first line is `import React from 'react';` and the **last line is `}`**.

```jsx
import React from 'react';
import { APP_NAME, APP_TAGLINE } from '../brand';

/**
 * Phase 37: the ShiftUp logo. The pictures are in frontend/public/brand/ (made from assets/main_logo_shift-up.png).
 *   variant "bar"   the mark and the name side by side (headers)
 *   variant "stack" the mark above the name and the tagline (sign-in and invite pages)
 *   variant "mark"  the mark alone
 * className on "stack" sets its height (default h-40).
 * The name is a picture so it keeps the logo's lettering; the alt text carries it for screen readers.
 */
export default function BrandLogo({ variant = 'bar', className = '' }) {
  if (variant === 'mark') {
    return <img src="/brand/logo-mark.png" alt={APP_NAME} className={`w-9 h-9 object-contain ${className}`} />;
  }
  if (variant === 'stack') {
    return (
      <img src="/brand/logo-full.png" alt={`${APP_NAME} ${APP_TAGLINE}`} width="567" height="640"
        className={`w-auto object-contain mx-auto ${className || 'h-40'}`} />
    );
  }
  return (
    <span className={`inline-flex items-center gap-2.5 flex-shrink-0 ${className}`}>
      <img src="/brand/logo-mark.png" alt="" className="w-9 h-9 object-contain flex-shrink-0" />
      <img src="/brand/logo-wordmark.png" alt={APP_NAME} className="h-[1.35rem] w-auto object-contain flex-shrink-0" />
    </span>
  );
}
```

---

# PART D: Frontend, edits (made AFTER Part B)

## D1. `frontend/tailwind.config.js` (1 EDIT)
The `brand` colours become gold. `brand-500` (`#FDD400`) is the gold in the logo.

**Edit 1.** Find:
```js
    extend: {
      colors: {
        brand: {
          50: '#f0fdf4',
          100: '#dcfce7',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
        }
      }
```
Replace with:
```js
    extend: {
      colors: {
        // Phase 37: ShiftUp gold. 500 is the gold in the logo (assets/main_logo_shift-up.png).
        // Use brand-* for buttons, active tabs, links and accents. Green (emerald-*) is only for
        // "confirmed / booked / on / success"; amber is "waiting"; rose is "problem".
        brand: {
          50: '#FFFDEB',
          100: '#FFF9C7',
          200: '#FFF08A',
          300: '#FFE74D',
          400: '#FEDE24',
          500: '#FDD400',
          600: '#D9B500',
          700: '#A88B00',
          800: '#6E5B00',
          900: '#453900',
          950: '#241E00',
        }
      }
```

---

## D2. `frontend/src/index.css` (2 EDITS)
The manager calendar's selected view button and today's column.

**Edit 1.** Find:
```css
}
.rbc-toolbar button.rbc-active {
  background-color: #059669;
  border-color: #10b981;
  color: #ffffff;
  box-shadow: none;
}
```
Replace with:
```css
}
.rbc-toolbar button.rbc-active {
  background-color: #FDD400;   /* Phase 37: brand gold, dark text */
  border-color: #FEDE24;
  color: #0a0a0a;
  box-shadow: none;
}
```

**Edit 2.** Find:
```css
}
.rbc-today {
  background-color: rgba(16, 185, 129, 0.08);
}
.rbc-event {
```
Replace with:
```css
}
.rbc-today {
  background-color: rgba(253, 212, 0, 0.08);   /* Phase 37 */
}
.rbc-event {
```

---

## D3. `frontend/src/App.jsx` (1 EDIT)
One new route: `/shiftboard` opens the worker's ShiftBoard tab.

**Edit 1.** Find:
```jsx
            />

            {/* Catch-all fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
```
Replace with:
```jsx
            />

            {/* Phase 37: a short address for the ShiftBoard (the worker's list of open shifts) */}
            <Route path="/shiftboard" element={<Navigate to="/worker?tab=find" replace />} />

            {/* Catch-all fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
```

---

## D4. `frontend/src/components/Navbar.jsx` (8 EDITS)
* New state: `const [workerTab, setWorkerTab] = useState(...)`, kept up to date by the `worker_tab_state` window event that `WorkerDashboard` already sends.
* A worker gets two links: **My shifts** (`/worker?tab=schedule`) and **ShiftBoard** (`/worker?tab=find`). Each link has an `on` flag for "this is the page they're on".
* Every link uses the same gold when it is the current page. The header is black and shows `<BrandLogo />`.
* The phone menu closes when the address's `?tab=` changes too. Below 1280px the links sit closer together and the person's name is hidden (the avatar stays), so five links fit.

**Edit 1.** Find:
```jsx
import api from '../api/client';
import NotificationBell from './NotificationBell';
import { Calendar, Shield, LogOut, Star, Building2, Briefcase, Menu, X, MapPin, UserRound, Wallet, ClipboardCheck, Network } from 'lucide-react';
import { Avatar } from './WorkerProfilePanel';
import { syncPush, disablePush } from '../utils/push';   // Phase 33

// Phase 33.1: role names people read
```
Replace with:
```jsx
import api from '../api/client';
import NotificationBell from './NotificationBell';
import { Shield, LogOut, Star, Building2, Briefcase, Menu, X, MapPin, UserRound, Wallet, ClipboardCheck, Network, LayoutGrid } from 'lucide-react';
import { Avatar } from './WorkerProfilePanel';
import { syncPush, disablePush } from '../utils/push';   // Phase 33
import BrandLogo from './BrandLogo';                        // Phase 37
import { BOARD_NAME } from '../brand';                     // Phase 37

// Phase 33.1: role names people read
```

**Edit 2.** Find:
```jsx
  }, [user?.id, userRole]);

  // Close the mobile menu whenever the route changes
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Super Admin venue switcher data (Phase 29.2: reloads when the admin console creates/deletes a venue)
```
Replace with:
```jsx
  }, [user?.id, userRole]);

  // Phase 37: which worker tab is open (My shifts / ShiftBoard are separate links). WorkerDashboard reports it
  // with the same 'worker_tab_state' event the phone tab bar listens to.
  const [workerTab, setWorkerTab] = useState(() => {
    try {
      return (JSON.parse(sessionStorage.getItem('shiftboard_worker_tab') || 'null') || {}).tab || 'schedule';
    } catch (e) {
      return 'schedule';
    }
  });
  useEffect(() => {
    const onState = (e) => setWorkerTab((e.detail || {}).tab || 'schedule');
    window.addEventListener('worker_tab_state', onState);
    return () => window.removeEventListener('worker_tab_state', onState);
  }, []);
  const onWorkerPage = location.pathname === '/worker';

  // Close the mobile menu whenever the route changes (Phase 37: also My shifts <-> ShiftBoard, which share /worker)
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, location.search]);

  // Super Admin venue switcher data (Phase 29.2: reloads when the admin console creates/deletes a venue)
```

**Edit 3.** Find:
```jsx
  };

  const links = [
    (isWorker || isPlatformAdmin) && {
      to: '/worker',
      label: isPlatformAdmin ? 'Worker view' : 'My shifts',
      icon: Briefcase,
      active: 'bg-slate-800 text-brand-400',
    },
    isWorker && {                                   // Phase 33.1
```
Replace with:
```jsx
  };

  // Phase 37: `on` = is this link the page they're on. Workers get My shifts and the ShiftBoard as two links.
  const links = [
    isPlatformAdmin && {
      to: '/worker',
      label: 'Worker view',
      icon: Briefcase,
      active: 'bg-slate-800 text-brand-400',
    },
    isWorker && !isPlatformAdmin && {
      to: '/worker?tab=schedule',
      label: 'My shifts',
      icon: Briefcase,
      active: 'bg-slate-800 text-brand-400',
      on: onWorkerPage && workerTab !== 'find',
    },
    isWorker && !isPlatformAdmin && {              // Phase 37: every shift that's up and isn't theirs yet
      to: '/worker?tab=find',
      label: BOARD_NAME,
      icon: LayoutGrid,
      active: 'bg-slate-800 text-brand-400',
      on: onWorkerPage && workerTab === 'find',
    },
    isWorker && {                                   // Phase 33.1
```

**Edit 4.** Find:
```jsx
      label: 'Lead',
      icon: ClipboardCheck,
      active: 'bg-slate-800 text-amber-300',
    },
    (isManagerRole || isPlatformAdmin) && {
      to: '/venue',
      label: isPlatformAdmin ? 'Manager view' : 'My venue',
      icon: Building2,
      active: 'bg-slate-800 text-teal-400',
    },
    isManagerRole && ownsOrg && {                   // Phase 36: organization owners (admins use Admin → Organizations)
      to: '/org',
      label: 'Organization',
      icon: Network,
      active: 'bg-slate-800 text-teal-300',
    },
    isPlatformAdmin && {
      to: '/admin',
      label: 'Admin',
      icon: Shield,
      active: 'bg-indigo-950 text-indigo-300 border border-indigo-700/50',
    },
    {
      to: '/venues',
      label: 'Venues',
      icon: MapPin,
      active: 'bg-slate-800 text-amber-400',
    },
  ].filter(Boolean);

  const venueSwitcher = (idSuffix) =>
```
Replace with:
```jsx
      label: 'Lead',
      icon: ClipboardCheck,
      active: 'bg-slate-800 text-brand-400',
    },
    (isManagerRole || isPlatformAdmin) && {
      to: '/venue',
      label: isPlatformAdmin ? 'Manager view' : 'My venue',
      icon: Building2,
      active: 'bg-slate-800 text-brand-400',
    },
    isManagerRole && ownsOrg && {                   // Phase 36: organization owners (admins use Admin → Organizations)
      to: '/org',
      label: 'Organization',
      icon: Network,
      active: 'bg-slate-800 text-brand-400',
    },
    isPlatformAdmin && {
      to: '/admin',
      label: 'Admin',
      icon: Shield,
      active: 'bg-slate-800 text-brand-400',
    },
    {
      to: '/venues',
      label: 'Venues',
      icon: MapPin,
      active: 'bg-slate-800 text-brand-400',
    },
  ].filter(Boolean).map((l) => ({
    ...l,
    on: l.on !== undefined ? l.on : (location.pathname === l.to || (l.to === '/venues' && location.pathname.startsWith('/venues/'))),
  }));

  const venueSwitcher = (idSuffix) =>
```

**Edit 5.** Find:
```jsx
    userRole === 'platform_admin' ? 'bg-indigo-400' : userRole === 'venue_manager' ? 'bg-teal-400' : 'bg-emerald-400';

  return (
    <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          {/* Brand + desktop links */}
          <div className="flex items-center space-x-3">
            <Link to="/" className="flex items-center space-x-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand-500 to-teal-400 flex items-center justify-center shadow-lg shadow-brand-500/20">
                <Calendar className="w-5 h-5 text-slate-950 font-bold" />
              </div>
              <span className="text-xl font-bold tracking-tight text-white">
                Shift<span className="text-brand-400">Board</span>
              </span>
            </Link>

            <nav className="hidden lg:flex ml-6 space-x-2">
              {links.map(({ to, label, icon: Icon, active }) => (
                <Link
                  key={to}
                  to={to}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition flex items-center space-x-1.5 ${
                    (location.pathname === to || (to === '/venues' && location.pathname.startsWith('/venues/'))) ? active : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{label}</span>
                </Link>
```
Replace with:
```jsx
    userRole === 'platform_admin' ? 'bg-indigo-400' : userRole === 'venue_manager' ? 'bg-teal-400' : 'bg-emerald-400';

  return (
    <header className="bg-black border-b border-brand-500/25 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          {/* Brand + desktop links */}
          <div className="flex items-center space-x-3">
            <Link to="/" className="flex items-center" aria-label="ShiftUp home">
              <BrandLogo />
            </Link>

            <nav className="hidden lg:flex ml-3 xl:ml-6 space-x-1 xl:space-x-2">
              {links.map(({ to, label, icon: Icon, active, on }) => (
                <Link
                  key={to}
                  to={to}
                  aria-current={on ? 'page' : undefined}
                  className={`px-2.5 xl:px-3 py-1.5 rounded-lg text-sm font-medium transition flex items-center space-x-1.5 ${isPlatformAdmin ? '' : 'whitespace-nowrap '}${
                    on ? active : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span>{label}</span>
                </Link>
```

**Edit 6.** Find:
```jsx
              <Link to="/profile" title="Your profile" className={`hidden lg:flex items-center gap-2 pl-1 pr-2 py-1 rounded-xl transition ${
                location.pathname === '/profile' ? 'bg-slate-800' : 'hover:bg-slate-800/60'}`}>
                <div className="text-right">
                  <div className="text-sm font-semibold text-slate-200">{user.first_name} {user.last_name}</div>
                  <div className="text-xs text-slate-400 capitalize flex items-center justify-end space-x-1">
```
Replace with:
```jsx
              <Link to="/profile" title="Your profile" className={`hidden lg:flex items-center gap-2 pl-1 pr-2 py-1 rounded-xl transition ${
                location.pathname === '/profile' ? 'bg-slate-800' : 'hover:bg-slate-800/60'}`}>
                <div className="text-right hidden xl:block">
                  <div className="text-sm font-semibold text-slate-200">{user.first_name} {user.last_name}</div>
                  <div className="text-xs text-slate-400 capitalize flex items-center justify-end space-x-1">
```

**Edit 7.** Find:
```jsx
      {/* Mobile menu panel */}
      {user && mobileOpen && (
        <div className="lg:hidden border-t border-slate-800 bg-slate-900 px-4 pb-4 pt-3 space-y-3 shadow-2xl">
          <div className="flex items-center justify-between">
            <div>
```
Replace with:
```jsx
      {/* Mobile menu panel */}
      {user && mobileOpen && (
        <div className="lg:hidden border-t border-slate-800 bg-black px-4 pb-4 pt-3 space-y-3 shadow-2xl">
          <div className="flex items-center justify-between">
            <div>
```

**Edit 8.** Find:
```jsx
          </div>

          <nav className="grid gap-2">
            {[...links, { to: '/profile', label: 'My profile', icon: UserRound, active: 'bg-slate-800 text-brand-400' }].map(({ to, label, icon: Icon, active }) => (
              <Link
                key={to}
                to={to}
                className={`px-4 py-3 rounded-xl text-base font-semibold transition flex items-center space-x-3 ${
                  (location.pathname === to || (to === '/venues' && location.pathname.startsWith('/venues/'))) ? active : 'text-slate-200 bg-slate-800/60 hover:bg-slate-800'
                }`}
              >
```
Replace with:
```jsx
          </div>

          <nav className="grid gap-2">
            {[...links, { to: '/profile', label: 'My profile', icon: UserRound, active: 'bg-slate-800 text-brand-400', on: location.pathname === '/profile' }].map(({ to, label, icon: Icon, active, on }) => (
              <Link
                key={to}
                to={to}
                aria-current={on ? 'page' : undefined}
                className={`px-4 py-3 rounded-xl text-base font-semibold transition flex items-center space-x-3 ${
                  on ? active : 'text-slate-200 bg-slate-800/60 hover:bg-slate-800'
                }`}
              >
```

---

## D5. `frontend/src/components/WorkerTabBar.jsx` (2 EDITS)
The phone tab bar: "Find" becomes **ShiftBoard**, and the bar reads the saved tab once more after it starts listening.

**Edit 1.** Find:
```jsx
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ListChecks, Search, CalendarDays, ArrowRightLeft, UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const ITEMS = [
  { id: 'schedule', label: 'My shifts', icon: ListChecks },
  { id: 'find', label: 'Find', icon: Search },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'transfers', label: 'Hand-offs', icon: ArrowRightLeft },
```
Replace with:
```jsx
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ListChecks, LayoutGrid, CalendarDays, ArrowRightLeft, UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { BOARD_NAME } from '../brand';   // Phase 37

const ITEMS = [
  { id: 'schedule', label: 'My shifts', icon: ListChecks },
  { id: 'find', label: BOARD_NAME, icon: LayoutGrid },   // Phase 37: was "Find"
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'transfers', label: 'Hand-offs', icon: ArrowRightLeft },
```

**Edit 2.** Find:
```jsx
    const onState = (e) => setState(e.detail);
    window.addEventListener('worker_tab_state', onState);
    return () => window.removeEventListener('worker_tab_state', onState);
  }, []);
```
Replace with:
```jsx
    const onState = (e) => setState(e.detail);
    window.addEventListener('worker_tab_state', onState);
    setState(savedState());   // Phase 37: the dashboard may have reported its tab before this listener existed
    return () => window.removeEventListener('worker_tab_state', onState);
  }, []);
```

---

## D6. `frontend/src/pages/LoginPage.jsx` (3 EDITS)
The logo above the form, a black page, and the back link says **ShiftBoard**.

**Edit 1.** Find:
```jsx
import { useAuth } from '../context/AuthContext';
import {
  Calendar,
  Shield,
  UserCheck,
```
Replace with:
```jsx
import { useAuth } from '../context/AuthContext';
import {
  Shield,
  UserCheck,
```

**Edit 2.** Find:
```jsx
} from 'lucide-react';
import { getPublicConfig } from '../utils/publicConfig';   // Phase 36
import {
  getFirebaseStatus,
```
Replace with:
```jsx
} from 'lucide-react';
import { getPublicConfig } from '../utils/publicConfig';   // Phase 36
import BrandLogo from '../components/BrandLogo';   // Phase 37
import { BOARD_NAME } from '../brand';              // Phase 37
import {
  getFirebaseStatus,
```

**Edit 3.** Find:
```jsx
    'w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-brand-500';

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 text-slate-100">
      {boardOn && (
        <div className="sm:mx-auto sm:w-full sm:max-w-md px-4 mb-4">
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-400 hover:text-white">
            <ArrowLeft className="w-4 h-4" /> Open shifts
          </Link>
        </div>
      )}
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="inline-flex w-14 h-14 rounded-2xl bg-gradient-to-tr from-brand-500 to-teal-400 items-center justify-center shadow-xl shadow-brand-500/20 mb-4">
          <Calendar className="w-8 h-8 text-slate-950 font-black" />
        </div>
        <h2 className="text-3xl font-extrabold tracking-tight text-white">
          Shift<span className="text-brand-400">Board</span>
        </h2>
        <p className="mt-2 text-sm text-slate-400">Pick up shifts. Fill your staff.</p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4">
```
Replace with:
```jsx
    'w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-brand-500';

  return (
    <div className="min-h-screen bg-black flex flex-col justify-center py-12 sm:px-6 lg:px-8 text-slate-100">
      {boardOn && (
        <div className="sm:mx-auto sm:w-full sm:max-w-md px-4 mb-4">
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-400 hover:text-white">
            <ArrowLeft className="w-4 h-4" /> {BOARD_NAME}
          </Link>
        </div>
      )}
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <h1><BrandLogo variant="stack" /></h1>
        <p className="mt-3 text-sm text-slate-400">Pick up shifts. Fill your staff.</p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4">
```

---

## D7. `frontend/src/pages/JoinPage.jsx` (2 EDITS)

**Edit 1.** Find:
```jsx
import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Calendar, Building2, MapPin, Check, AlertTriangle, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
```
Replace with:
```jsx
import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Building2, MapPin, Check, AlertTriangle, LogOut } from 'lucide-react';
import BrandLogo from '../components/BrandLogo';   // Phase 37
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
```

**Edit 2.** Find:
```jsx
    });

  const shell = (children) => (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 px-4 text-slate-100">
      <div className="text-center mb-6">
        <div className="inline-flex w-12 h-12 rounded-2xl bg-gradient-to-tr from-brand-500 to-teal-400 items-center justify-center shadow-xl shadow-brand-500/20 mb-3">
          <Calendar className="w-7 h-7 text-slate-950" />
        </div>
        <h1 className="text-2xl font-extrabold text-white">
          Shift<span className="text-brand-400">Board</span>
        </h1>
      </div>
      <div className="w-full max-w-md mx-auto bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-4">{children}</div>
```
Replace with:
```jsx
    });

  const shell = (children) => (
    <div className="min-h-screen bg-black flex flex-col justify-center py-12 px-4 text-slate-100">
      <div className="text-center mb-6">
        <h1><BrandLogo variant="stack" className="h-32" /></h1>
      </div>
      <div className="w-full max-w-md mx-auto bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-4">{children}</div>
```

---

## D8. `frontend/src/pages/PublicBoardPage.jsx` (3 EDITS)
The public home page: black header with the logo, and the heading is **ShiftBoard**.

**Edit 1.** Find:
```jsx
import { fmtLongDate, fmtTimeRange } from '../utils/venueTime';
import { rememberPublicEvent } from '../utils/publicConfig';

const REFRESH_MS = 60000;
```
Replace with:
```jsx
import { fmtLongDate, fmtTimeRange } from '../utils/venueTime';
import { rememberPublicEvent } from '../utils/publicConfig';
import BrandLogo from '../components/BrandLogo';   // Phase 37
import { APP_NAME, BOARD_NAME } from '../brand';    // Phase 37

const REFRESH_MS = 60000;
```

**Edit 2.** Find:
```jsx
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand-500 to-teal-400 flex items-center justify-center shadow-lg shadow-brand-500/20 flex-shrink-0">
              <Calendar className="w-5 h-5 text-slate-950" />
            </div>
            <span className="text-xl font-bold tracking-tight text-white truncate">
              Shift<span className="text-brand-400">Board</span>
            </span>
          </div>
          <button type="button" onClick={() => { setPicked(null); navigate('/login'); }}
            className="px-4 py-2 rounded-xl bg-brand-500 hover:bg-brand-400 text-slate-950 text-sm font-bold inline-flex items-center gap-1.5 whitespace-nowrap">
```
Replace with:
```jsx
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="bg-black border-b border-brand-500/25 sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <BrandLogo />
          <button type="button" onClick={() => { setPicked(null); navigate('/login'); }}
            className="px-4 py-2 rounded-xl bg-brand-500 hover:bg-brand-400 text-slate-950 text-sm font-bold inline-flex items-center gap-1.5 whitespace-nowrap">
```

**Edit 3.** Find:
```jsx
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">Open shifts</h1>
          <p className="mt-1 text-sm text-slate-400 max-w-2xl">
            Shifts posted by venues on ShiftUp.{' '}
            {canRegister
              ? 'Create a free worker account to see the pay and the full details, and to book.'
```
Replace with:
```jsx
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">{BOARD_NAME}</h1>
          <p className="mt-1 text-sm text-slate-400 max-w-2xl">
            Open shifts posted by venues on {APP_NAME}.{' '}
            {canRegister
              ? 'Create a free worker account to see the pay and the full details, and to book.'
```

---

## D9. `frontend/src/pages/WorkerDashboard.jsx` (13 EDITS)
* Removed state: `hideRequested`. No new state.
* New values: `offeredShiftIds`, `boardListings` (the listings that aren't on My shifts) and `onMyShifts` (how many were left out).
* The first tab is chosen in the existing `setActiveTab((prev) => ...)` call inside `loadAll`. No new request to the server.
* The tab's id stays `find`. Only its label and icon change.

**Edit 1.** Find:
```jsx
import {
  Calendar, AlertCircle, Briefcase, Check, Search, Filter, ArrowRightLeft, Zap, Info, CalendarDays, AlertTriangle,
  ListChecks, Send, ChevronRight, RotateCcw, X,
} from 'lucide-react';
import TransferModal from '../components/TransferModal';
```
Replace with:
```jsx
import {
  Calendar, AlertCircle, Briefcase, Check, Search, Filter, ArrowRightLeft, Zap, Info, CalendarDays, AlertTriangle,
  ListChecks, Send, ChevronRight, RotateCcw, X, LayoutGrid,
} from 'lucide-react';
import TransferModal from '../components/TransferModal';
```

**Edit 2.** Find:
```jsx
} from '../utils/listingFormat';
import { getCurrentPosition } from '../utils/geo';

const UPCOMING_STATUSES = ['pending', 'pending_manager_approval', 'approved', 'confirmed', 'checked_in'];
const TAB_IDS = ['schedule', 'find', 'calendar', 'transfers'];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;

/**
 * Worker home. Phase 29.4 layout:
 *   Tabs: My shifts (default when you have something coming up) · Find shifts · Calendar · Hand-offs.
 *   Each shift card has ONE main button (clock in/out, read the update, withdraw, ask to come back)
 *   and a ⋯ menu for the rest (details, directions, calendar, chat, hand off, drop).
```
Replace with:
```jsx
} from '../utils/listingFormat';
import { getCurrentPosition } from '../utils/geo';
import { BOARD_NAME } from '../brand';   // Phase 37

const UPCOMING_STATUSES = ['pending', 'pending_manager_approval', 'approved', 'confirmed', 'checked_in'];
const WEEK_MS = 7 * 86400000;   // Phase 37: "this week" for choosing the first tab
const TAB_IDS = ['schedule', 'find', 'calendar', 'transfers'];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;

/**
 * Worker home. Phase 29.4 layout:
 *   Tabs: My shifts · ShiftBoard · Calendar · Hand-offs.
 *   Phase 37: "Find shifts" is now the ShiftBoard: every shift that is up and is NOT already on My shifts
 *   (nothing they asked for, are booked on, are waitlisted for, or were offered).
 *   With no ?tab= in the address, the first tab is My shifts when they have something booked or waiting in the
 *   next 7 days, otherwise the ShiftBoard.
 *   Each shift card has ONE main button (clock in/out, read the update, withdraw, ask to come back)
 *   and a ⋯ menu for the rest (details, directions, calendar, chat, hand off, drop).
```

**Edit 3.** Find:
```jsx
  const [venueFilter, setVenueFilter] = useState('ALL');
  const [instantOnly, setInstantOnly] = useState(false);
  const [hideRequested, setHideRequested] = useState(false);
  const [fitsOnly, setFitsOnly] = useState(false);            // Phase 31: fits my availability, not on time off
  const [mineOnly, setMineOnly] = useState(false);            // Phase 32.2: hide other departments
```
Replace with:
```jsx
  const [venueFilter, setVenueFilter] = useState('ALL');
  const [instantOnly, setInstantOnly] = useState(false);
  const [fitsOnly, setFitsOnly] = useState(false);            // Phase 31: fits my availability, not on time off
  const [mineOnly, setMineOnly] = useState(false);            // Phase 32.2: hide other departments
```

**Edit 4.** Find:
```jsx
      setOutgoingTransfers(outRes.data || []);
      setActiveClockIns(new Set((activeClocksRes.data || []).map((te) => te.shift_id)));
      // First load: open My shifts when there's something coming up, otherwise Find shifts
      setActiveTab((prev) => {
        if (prev) return prev;
        const upcoming = (myRes.data || []).some((r) => {
          const st = String(r.status || '').toLowerCase();
          return UPCOMING_STATUSES.includes(st) && new Date(r.shift?.end_time).getTime() >= Date.now();
        });
        const waitOffer = (waitRes.data || []).some((w) => w.status === 'offered');
        return upcoming || waitOffer || (offersRes.data || []).length ? 'schedule' : 'find';
      });
    } catch (err) {
```
Replace with:
```jsx
      setOutgoingTransfers(outRes.data || []);
      setActiveClockIns(new Set((activeClocksRes.data || []).map((te) => te.shift_id)));
      // First load (Phase 37): My shifts when something is booked or waiting in the next 7 days, otherwise the ShiftBoard.
      //   booked or asked for  a request whose shift starts within 7 days (or is running now)
      //   waiting on them      an offer from a manager, or a waitlist spot being held
      //   in line              a waitlist place for a shift that starts within 7 days
      setActiveTab((prev) => {
        if (prev) return prev;
        const now = Date.now();
        const soon = (start) => {
          const t = new Date(start).getTime();
          return !Number.isNaN(t) && t <= now + WEEK_MS;
        };
        const upcoming = (myRes.data || []).some((r) => {
          const st = String(r.status || '').toLowerCase();
          if (!UPCOMING_STATUSES.includes(st)) return false;
          if (st === 'checked_in') return true;
          return new Date(r.shift?.end_time).getTime() >= now && soon(r.shift?.start_time);
        });
        const waiting = (waitRes.data || []).some((w) => w.status === 'offered' || soon(w.start_time));
        return upcoming || waiting || (offersRes.data || []).length ? 'schedule' : 'find';
      });
    } catch (err) {
```

**Edit 5.** Find:
```jsx
  }, [pendingDeepLink, calendarByRequest]);

  // Find Shifts
  const openListingCount = listings.filter((l) => l.total_spots_left > 0 && !l.my_request).length;   // Phase 34: full events don't count
  const roleOptions = useMemo(
    () => Array.from(new Set(listings.flatMap((l) => l.positions.filter((p) => p.status === 'OPEN' || p.can_waitlist).map((p) => p.role_type)))).sort(),
    [listings]
  );
  const venueOptions = useMemo(() => {
    const m = new Map();
    listings.forEach((l) => l.venue && m.set(l.venue.id, l.venue.name));
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [listings]);
  const filteredListings = useMemo(() => {
    const q = search.trim().toLowerCase();
    const weekEnd = Date.now() + 7 * 86400000;
    return listings.filter((l) => {
      const tz = l.venue?.timezone;
      if (q) {
```
Replace with:
```jsx
  }, [pendingDeepLink, calendarByRequest]);

  // The ShiftBoard (Phase 37): everything that is up and is NOT already on My shifts.
  // Left out: an event they asked for or are booked on, one they are waitlisted for, and one they were offered.
  const offeredShiftIds = useMemo(() => new Set(offers.map((o) => o.shift_id)), [offers]);
  const boardListings = useMemo(
    () => listings.filter((l) => !l.my_request && !l.positions.some((p) => p.my_waitlist || offeredShiftIds.has(p.shift_id))),
    [listings, offeredShiftIds]
  );
  const onMyShifts = listings.length - boardListings.length;
  const openListingCount = boardListings.filter((l) => l.total_spots_left > 0).length;   // Phase 34: full events don't count
  const roleOptions = useMemo(
    () => Array.from(new Set(boardListings.flatMap((l) => l.positions.filter((p) => p.status === 'OPEN' || p.can_waitlist).map((p) => p.role_type)))).sort(),
    [boardListings]
  );
  const venueOptions = useMemo(() => {
    const m = new Map();
    boardListings.forEach((l) => l.venue && m.set(l.venue.id, l.venue.name));
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [boardListings]);
  const filteredListings = useMemo(() => {
    const q = search.trim().toLowerCase();
    const weekEnd = Date.now() + 7 * 86400000;
    return boardListings.filter((l) => {
      const tz = l.venue?.timezone;
      if (q) {
```

**Edit 6.** Find:
```jsx
      if (whenFilter === 'tomorrow' && !isOnDay(l.start_time, tz, 1)) return false;
      if (whenFilter === 'week' && new Date(l.start_time).getTime() > weekEnd) return false;
      if (roleFilter !== 'ALL' && !l.positions.some((p) => p.role_type === roleFilter && (p.status === 'OPEN' || p.my_status || p.can_waitlist || p.my_waitlist))) return false;
      if (venueFilter !== 'ALL' && l.venue?.id !== venueFilter) return false;
      if (instantOnly && !l.any_instant) return false;
      if (hideRequested && l.my_request) return false;
      if (fitsOnly && (l.availability === 'outside' || l.time_off === 'blocked')) return false;   // Phase 31 / 32.1
      if (mineOnly && isOtherDept(l)) return false;                                              // Phase 32.2
      return true;
    });
  }, [listings, search, whenFilter, roleFilter, venueFilter, instantOnly, hideRequested, fitsOnly, mineOnly]);
  // Phase 32.2: shifts in my departments first; everything else under "Other departments"
  const listingGroups = useMemo(() => groupByDay(filteredListings.filter((l) => !isOtherDept(l) && !isFullOnly(l))), [filteredListings]);
  const otherGroups = useMemo(() => groupByDay(filteredListings.filter((l) => isOtherDept(l) && !isFullOnly(l))), [filteredListings]);
  const fullListings = useMemo(() => filteredListings.filter(isFullOnly), [filteredListings]);                 // Phase 34
  const fullGroups = useMemo(() => groupByDay(fullListings), [fullListings]);
  const myWaitCount = fullListings.filter((l) => l.positions.some((p) => p.my_waitlist)).length;
  const coverByRequest = useMemo(() => new Map(myCovers.map((c) => [c.request_id, c])), [myCovers]);
  const waitOffers = waitlists.filter((w) => w.status === 'offered').length;
  const filtersActive = search || whenFilter !== 'all' || roleFilter !== 'ALL' || venueFilter !== 'ALL' || instantOnly || hideRequested || fitsOnly || mineOnly;
  const clearFilters = () => {
    setSearch('');
    setWhenFilter('all');
    setRoleFilter('ALL');
    setVenueFilter('ALL');
    setInstantOnly(false);
    setHideRequested(false);
    setFitsOnly(false);
    setMineOnly(false);
```
Replace with:
```jsx
      if (whenFilter === 'tomorrow' && !isOnDay(l.start_time, tz, 1)) return false;
      if (whenFilter === 'week' && new Date(l.start_time).getTime() > weekEnd) return false;
      if (roleFilter !== 'ALL' && !l.positions.some((p) => p.role_type === roleFilter && (p.status === 'OPEN' || p.can_waitlist))) return false;
      if (venueFilter !== 'ALL' && l.venue?.id !== venueFilter) return false;
      if (instantOnly && !l.any_instant) return false;
      if (fitsOnly && (l.availability === 'outside' || l.time_off === 'blocked')) return false;   // Phase 31 / 32.1
      if (mineOnly && isOtherDept(l)) return false;                                              // Phase 32.2
      return true;
    });
  }, [boardListings, search, whenFilter, roleFilter, venueFilter, instantOnly, fitsOnly, mineOnly]);
  // Phase 32.2: shifts in my departments first; everything else under "Other departments"
  const listingGroups = useMemo(() => groupByDay(filteredListings.filter((l) => !isOtherDept(l) && !isFullOnly(l))), [filteredListings]);
  const otherGroups = useMemo(() => groupByDay(filteredListings.filter((l) => isOtherDept(l) && !isFullOnly(l))), [filteredListings]);
  const fullListings = useMemo(() => filteredListings.filter(isFullOnly), [filteredListings]);                 // Phase 34
  const fullGroups = useMemo(() => groupByDay(fullListings), [fullListings]);
  const coverByRequest = useMemo(() => new Map(myCovers.map((c) => [c.request_id, c])), [myCovers]);
  const waitOffers = waitlists.filter((w) => w.status === 'offered').length;
  const filtersActive = search || whenFilter !== 'all' || roleFilter !== 'ALL' || venueFilter !== 'ALL' || instantOnly || fitsOnly || mineOnly;
  const clearFilters = () => {
    setSearch('');
    setWhenFilter('all');
    setRoleFilter('ALL');
    setVenueFilter('ALL');
    setInstantOnly(false);
    setFitsOnly(false);
    setMineOnly(false);
```

**Edit 7.** Find:
```jsx
  const tabs = [
    { id: 'schedule', label: 'My shifts', icon: ListChecks, count: upcomingRequests.length, badge: waitOffers },
    { id: 'find', label: 'Find shifts', icon: Search, count: openListingCount, badge: coverOpen.filter((c) => c.can_take).length },
    { id: 'calendar', label: 'Calendar', icon: CalendarDays, badge: calendar.unread_count },
    { id: 'transfers', label: 'Hand-offs', icon: ArrowRightLeft, badge: incomingTransfers.length },
```
Replace with:
```jsx
  const tabs = [
    { id: 'schedule', label: 'My shifts', icon: ListChecks, count: upcomingRequests.length, badge: waitOffers },
    { id: 'find', label: BOARD_NAME, icon: LayoutGrid, count: openListingCount, badge: coverOpen.filter((c) => c.can_take).length },   // Phase 37
    { id: 'calendar', label: 'Calendar', icon: CalendarDays, badge: calendar.unread_count },
    { id: 'transfers', label: 'Hand-offs', icon: ArrowRightLeft, badge: incomingTransfers.length },
```

**Edit 8.** Find:
```jsx
                  <h3 className="text-sm font-semibold text-slate-300">Nothing coming up</h3>
                  <button type="button" onClick={() => setActiveTab('find')} className="mt-2 text-xs text-brand-400 hover:text-brand-300 font-semibold">
                    Find a shift →
                  </button>
                </div>
```
Replace with:
```jsx
                  <h3 className="text-sm font-semibold text-slate-300">Nothing coming up</h3>
                  <button type="button" onClick={() => setActiveTab('find')} className="mt-2 text-xs text-brand-400 hover:text-brand-300 font-semibold">
                    Open the {BOARD_NAME} →
                  </button>
                </div>
```

**Edit 9.** Find:
```jsx
        )}

        {/* Find shifts */}
        {activeTab === 'find' && (
          <div className="mt-6">
            <CoverBoard items={coverOpen} busyId={coverBusy} onTake={(c) => setCoverTake(c)} />
            <div className="mt-6 bg-slate-900/60 border border-slate-800 rounded-2xl p-3 sm:p-4 space-y-3">
```
Replace with:
```jsx
        )}

        {/* The ShiftBoard (Phase 37; the tab id is still 'find') */}
        {activeTab === 'find' && (
          <div className="mt-6">
            <div className="mb-5 flex flex-col sm:flex-row sm:items-end justify-between gap-2">
              <div>
                <h2 className="hidden md:flex text-xl font-extrabold text-white items-center gap-2">
                  <LayoutGrid className="w-5 h-5 text-brand-400" /> {BOARD_NAME}
                </h2>
                <p className="text-sm text-slate-400 md:mt-0.5">Every shift that's up and isn't yours yet.</p>
              </div>
              {onMyShifts > 0 && (
                <button type="button" onClick={() => setActiveTab('schedule')}
                  className="self-start sm:self-auto text-xs font-semibold text-brand-400 hover:text-brand-300 inline-flex items-center gap-1">
                  {plural(onMyShifts, 'event')} {onMyShifts === 1 ? 'is' : 'are'} already on My shifts <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <CoverBoard items={coverOpen} busyId={coverBusy} onTake={(c) => setCoverTake(c)} />
            <div className="mt-6 bg-slate-900/60 border border-slate-800 rounded-2xl p-3 sm:p-4 space-y-3">
```

**Edit 10.** Find:
```jsx
                  <Zap className="w-3.5 h-3.5" /> Instant book
                </button>
                <button type="button" onClick={() => setHideRequested((v) => !v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                    hideRequested ? 'bg-brand-500/15 text-brand-300 border-brand-500/40' : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'}`}>
                  Hide ones I've requested
                </button>
                <button type="button" onClick={() => setFitsOnly((v) => !v)}
                  title="Hide shifts outside your weekly availability or on days you have time off"
```
Replace with:
```jsx
                  <Zap className="w-3.5 h-3.5" /> Instant book
                </button>
                <button type="button" onClick={() => setFitsOnly((v) => !v)}
                  title="Hide shifts outside your weekly availability or on days you have time off"
```

**Edit 11.** Find:
```jsx
              <div className="mt-6 text-center py-20 bg-slate-900/40 rounded-2xl border border-slate-800">
                <Briefcase className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <h3 className="text-sm font-semibold text-slate-300">{listings.length === 0 ? 'No shifts open right now' : 'Nothing matches these filters'}</h3>
                <p className="text-xs text-slate-500 mt-1">
                  {listings.length === 0 ? "Check back soon. You'll get a notification when a venue you work with posts a shift." : 'Try clearing a filter or two.'}
                </p>
              </div>
```
Replace with:
```jsx
              <div className="mt-6 text-center py-20 bg-slate-900/40 rounded-2xl border border-slate-800">
                <Briefcase className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <h3 className="text-sm font-semibold text-slate-300">{boardListings.length === 0 ? (onMyShifts > 0 ? 'Nothing else is open right now' : 'No shifts open right now') : 'Nothing matches these filters'}</h3>
                <p className="text-xs text-slate-500 mt-1">
                  {boardListings.length === 0 ? "Check back soon. You'll get a notification when a venue you work with posts a shift." : 'Try clearing a filter or two.'}
                </p>
              </div>
```

**Edit 12.** Find:
```jsx
                {/* Phase 34: full events, so people can get in line */}
                {fullGroups.length > 0 && (
                  <details className="group border-t border-slate-800 pt-6" open={myWaitCount > 0}>
                    <summary className="cursor-pointer select-none list-none">
                      <span className="text-sm font-bold text-slate-200">Full: join a waitlist ({fullListings.length})</span>
                      {myWaitCount > 0 && <span className="ml-2 text-[11px] text-emerald-300">You're in line for {plural(myWaitCount, 'event')}</span>}
                      <span className="block text-xs text-slate-500 mt-0.5">
                        No spots left. Join the line and we'll book you (or offer you the spot) if one opens.
```
Replace with:
```jsx
                {/* Phase 34: full events, so people can get in line */}
                {fullGroups.length > 0 && (
                  <details className="group border-t border-slate-800 pt-6">
                    <summary className="cursor-pointer select-none list-none">
                      <span className="text-sm font-bold text-slate-200">Full: join a waitlist ({fullListings.length})</span>
                      <span className="block text-xs text-slate-500 mt-0.5">
                        No spots left. Join the line and we'll book you (or offer you the spot) if one opens.
```

**Edit 13.** Find:
```jsx
              <WorkerCalendar
                items={calendar.items}
                openListings={listings.filter((l) => !isFullOnly(l))}
                onSelectItem={(item) => setDetailRequestId(item.request_id)}
                onSelectListing={(l) => setOpenListing({ eventId: l.event_id, initial: l })}
```
Replace with:
```jsx
              <WorkerCalendar
                items={calendar.items}
                openListings={boardListings.filter((l) => !isFullOnly(l))}
                onSelectItem={(item) => setDetailRequestId(item.request_id)}
                onSelectListing={(l) => setOpenListing({ eventId: l.event_id, initial: l })}
```

---

# PART E: Delete one file

## E1. DELETE `frontend/public/icons/favicon.svg`
It is the old calendar icon. After Part B nothing refers to it (`frontend/index.html` now links `favicon-32.png` and `favicon-64.png`). Delete only this file: `git rm frontend/public/icons/favicon.svg` (or delete it in the file tree).

---

# PART F: Guides

## F1. `agy_system_instructions.md` (2 EDITS)
The title line, and a new rule 13 at the end of the file. **Leave the Standing rules section exactly as it is.**

**Edit 1.** Find:
```markdown
# Project Context: "ShiftBoard" Scheduling Platform

You are an expert full-stack developer and DevOps engineer. Your task is to build a shift-scheduling and community call-board application designed for the service industry (bartenders, servers, dishwashers, AV techs, etc.). 
```
Replace with:
```markdown
# Project Context: "ShiftUp" Scheduling Platform (called "ShiftBoard" until 0.37.0)

You are an expert full-stack developer and DevOps engineer. Your task is to build a shift-scheduling and community call-board application designed for the service industry (bartenders, servers, dishwashers, AV techs, etc.). 
```

**Edit 2.** Find:
```markdown
   * Every text value written to a feed goes through `ics_text()` (it escapes the value and neutralises every kind of line break), and every link through `app_link()`.
   * Feeds are one-way and written by hand as iCalendar text (no new package). Don't add sign-in-with-Google or Microsoft calendar connections unless a phase asks.
```
Replace with:
```markdown
   * Every text value written to a feed goes through `ics_text()` (it escapes the value and neutralises every kind of line break), and every link through `app_link()`.
   * Feeds are one-way and written by hand as iCalendar text (no new package). Don't add sign-in-with-Google or Microsoft calendar connections unless a phase asks.
13. **Brand (Phase 37):** the service is **ShiftUp**. **ShiftBoard** is only the board of open shifts (the worker's tab, id `find`, and the heading of the public home page).
   * New screens import `APP_NAME` and `BOARD_NAME` from `frontend/src/brand.js` and show the logo with `<BrandLogo />` (`frontend/src/components/BrandLogo.jsx`). Never type "ShiftBoard" as the service's name.
   * **Colour:** gold `brand-*` for main buttons, the active tab or link, links, focus rings and section icons; text on solid gold is `text-slate-950`, never white. Green `emerald-*` only for confirmed / booked / on / verified / done. Amber = waiting. Rose = problem.
   * **Logo files** are in `frontend/public/brand/` and `frontend/public/icons/`, cut from `assets/main_logo_shift-up.png`. Don't redraw, recolour or regenerate them, and don't add an SVG version.
   * **Keep these as they are** (people never see them, and renaming breaks things): the database name and user, the Docker network and `shiftboard-demo` stack, demo sign-ins `@shiftboard.com`, browser storage keys starting `shiftboard_`, calendar entry ids ending `@shiftboard`, the time-tracking value `'shiftboard'`, the FCM app name, and the `ShiftBoard.jsx` / `ShiftBoardModal` component names.
   * A worker's ShiftBoard never lists an event they have requested, are waitlisted for or have been offered: those are on My shifts (`boardListings` in `frontend/src/pages/WorkerDashboard.jsx`).
```

---

## F2. `product-roadmap.md` (1 EDIT)

**Edit 1.** Find:
```markdown
  - **Read a worker's own calendar** (they paste its private link) to warn before they request a shift that clashes with something personal.

### Later / nice to have
- **Admin "needs attention" dashboard:**
```
Replace with:
```markdown
  - **Read a worker's own calendar** (they paste its private link) to warn before they request a shift that clashes with something personal.

### Phase 37: ShiftUp branding and the ShiftBoard tab (shipped in 0.37.0)
- ✅ **New name and look:** the service is ShiftUp (shift-up.team), with the gold logo, a black header and gold buttons. Green is kept for "confirmed".
- ✅ **Worker view split in two:** **My shifts** (what's theirs) and the **ShiftBoard** (everything else that's up). The app opens whichever fits their week.
- ⏳ **Later, if wanted:** a light theme; the logo in emails.

### Later / nice to have
- **Admin "needs attention" dashboard:**
```

---

# PART V: Version, changelog & README (the standing directive, done for you)

## V1. `frontend/package.json` (1 EDIT)

**Edit 1.** Find:
```json
  "name": "shiftboard-frontend",
  "private": true,
  "version": "0.36.1",
  "type": "module",
  "scripts": {
```
Replace with:
```json
  "name": "shiftboard-frontend",
  "private": true,
  "version": "0.37.0",
  "type": "module",
  "scripts": {
```

---

## V2. `backend/src/version.py` (1 EDIT)

**Edit 1.** Find:
```python
container is still running an old build.
"""
APP_VERSION = "0.36.1"
```
Replace with:
```python
container is still running an old build.
"""
APP_VERSION = "0.37.0"
```

---

## V3. `CHANGELOG.md` (1 EDIT)
The intro line, and the new section above `[0.36.1]`.

**Edit 1.** Find:
```markdown
# Changelog

All notable changes to ShiftBoard. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/): while pre-1.0, **0.&lt;phase&gt;.&lt;sub-phase&gt;** (see README → Versioning & releases).

The newest version goes at the top. Each entry uses a `## [x.y.z] - YYYY-MM-DD - Phase N: title` heading, followed by bullets under **Added / Changed / Fixed / Removed**.

## [0.36.1] - 2026-10-06 - Phase 36.1: Calendar sync
```
Replace with:
```markdown
# Changelog

All notable changes to ShiftUp (called ShiftBoard until 0.37.0). The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/): while pre-1.0, **0.&lt;phase&gt;.&lt;sub-phase&gt;** (see README → Versioning & releases).

The newest version goes at the top. Each entry uses a `## [x.y.z] - YYYY-MM-DD - Phase N: title` heading, followed by bullets under **Added / Changed / Fixed / Removed**.

## [0.37.0] - 2026-10-06 - Phase 37: ShiftUp branding and the ShiftBoard tab

### Added
- **ShiftBoard tab** for workers: every shift that's up and isn't theirs yet. It replaces "Find shifts".
  - An event leaves the ShiftBoard once the worker requests it, joins its waitlist or is offered a shift in it. It is then on **My shifts**. A line at the top of the board says how many are there.
  - **My shifts** and **ShiftBoard** are two links in the top bar, and two tabs on a phone.
  - With no tab chosen, the app opens My shifts when the worker has something booked, requested, offered or waitlisted in the next 7 days, and the ShiftBoard when they don't.
  - `/shiftboard` opens the ShiftBoard directly.
- **Logo and icons** from `assets/main_logo_shift-up.png`: the header, the sign-in and invite pages, the public home page, the browser tab, the installed app and notification badges. The pictures are in `frontend/public/brand/` and `frontend/public/icons/`.
- `frontend/src/brand.js` (`APP_NAME`, `APP_TAGLINE`, `BOARD_NAME`) and `frontend/src/components/BrandLogo.jsx`.
- `scripts/phase37_rebrand.py`: the one-off script that renamed and recoloured more than 100 files in this version.

### Changed
- **The service is now ShiftUp** (shift-up.team). Every screen, email, text message, notification, calendar name and the API title say ShiftUp. "ShiftBoard" now means the board of open shifts: the worker tab, and the heading of the public home page.
- **Gold brand colour** (`brand-*` in `frontend/tailwind.config.js`, taken from the logo) on a black header. Main buttons, active tabs, links, focus rings and section icons are gold with dark text.
  - Green now only means confirmed, booked, on, verified or done. Amber still means waiting, and rose a problem.
  - Every link in the top bar uses the same gold when it is the current page.
- The default `EMAIL_FROM` is `ShiftUp <no-reply@example.com>`. A stack whose `.env` sets `EMAIL_FROM` keeps sending under the name written there until that line is changed.
- The shift chat is called **Shift chat** everywhere (two buttons said "Board"), and "the public shift board" in cover requests is now "the ShiftBoard".
- Downloads are named `shiftup-hours-….csv` and `shiftup.ics`.
- The manager calendar's selected view button and today's column are gold.
- The installed app's name, colours and icons (`manifest.webmanifest`), the offline page, and the service worker's cache name (`shiftup-shell-v2`).
- One sentence of text in `backend/src/auth.py` and `backend/src/routers/auth.py` ("Contact your venue or ShiftUp…"). Sign-in itself is unchanged.

### Removed
- The "Hide ones I've requested" filter: requested shifts are no longer on the board.
- `frontend/public/icons/favicon.svg` (the old calendar icon).

### Not changed, on purpose
- No database change. Names people never see still say `shiftboard`: the database and its user, the Docker network, the demo stack and demo sign-ins (`@shiftboard.com`), browser storage keys, calendar entry ids and the time-tracking value `shiftboard`.

## [0.36.1] - 2026-10-06 - Phase 36.1: Calendar sync
```

---

## V4. `README.md` (5 EDITS)

**Edit 1.** Find:
```markdown
| **Waitlist** | A line for a full shift. | | `WaitlistEntry` / `waitlist_entries` |
| **Offer** | A manager offers a shift to one or more people; the first to accept gets it. | | `ShiftOffer` / `shift_offers` |

Many API fields still say `positions` for an event's shifts (for example `EventListing.positions[]`). That's a historical name: the UI says **shifts**.

---
```
Replace with:
```markdown
| **Waitlist** | A line for a full shift. | | `WaitlistEntry` / `waitlist_entries` |
| **Offer** | A manager offers a shift to one or more people; the first to accept gets it. | | `ShiftOffer` / `shift_offers` |
| **ShiftBoard** | The board of open shifts. For a worker: every shift that's up and isn't theirs yet. For a visitor: the public home page. | | `BOARD_NAME` in `frontend/src/brand.js`; the worker tab's id is still `find` |

Many API fields still say `positions` for an event's shifts (for example `EventListing.positions[]`). That's a historical name: the UI says **shifts**.

**The name.** The service is **ShiftUp** (shift-up.team). Until 0.37.0 it was called ShiftBoard; that word now means only the board of open shifts. Names people never see still say `shiftboard`, on purpose: the database and its user, the Docker network and demo stack, the demo sign-ins (`@shiftboard.com`), browser storage keys, calendar entry ids and the `ShiftBoard.jsx` component. Don't rename them: it would sign people out, duplicate calendar entries or break a running stack.

---
```

**Edit 2.** Find:
```markdown
### Home page and the public board
* **`PUBLIC_EVENT_BOARD=false` (the default):** the home page (`/`) sends people who aren't signed in to the sign-in page.
* **`PUBLIC_EVENT_BOARD=true`:** the home page is a **public board** of every posted, upcoming event, with a **Sign in / Sign up** button in the corner.
  * It shows only: event name, date and time, venue name, city, positions and open spots (`GET /api/public/board`, no sign-in needed).
  * It never shows pay, the street address, map pin, location name, notes, requirements or venue ids. Those need a worker account.
```
Replace with:
```markdown
### Home page and the public board
* **`PUBLIC_EVENT_BOARD=false` (the default):** the home page (`/`) sends people who aren't signed in to the sign-in page.
* **`PUBLIC_EVENT_BOARD=true`:** the home page is a **public board** (titled **ShiftBoard**) of every posted, upcoming event, with a **Sign in / Sign up** button in the corner.
  * It shows only: event name, date and time, venue name, city, positions and open spots (`GET /api/public/board`, no sign-in needed).
  * It never shows pay, the street address, map pin, location name, notes, requirements or venue ids. Those need a worker account.
```

**Edit 3.** Find:
```markdown
* Feeds cover 30 days back and 180 days ahead.

### For workers
* **Find shifts**: upcoming events, grouped by day, with filters:
  * date
  * position
```
Replace with:
```markdown
* Feeds cover 30 days back and 180 days ahead.

### For workers
* Two main tabs since 0.37.0: **My shifts** (everything that's theirs) and the **ShiftBoard** (everything else that's up). Both are links in the top bar and tabs on a phone.
  * With no tab in the address, the app opens **My shifts** when the worker has something booked, requested, offered or waitlisted in the next 7 days, and the **ShiftBoard** when they don't.
  * `/worker?tab=schedule` and `/worker?tab=find` open one or the other. `/shiftboard` is a short address for the second.
* **ShiftBoard**: upcoming events that aren't theirs yet, grouped by day. An event leaves the board once they request it, join its waitlist or are offered a shift in it; it is then on My shifts. Filters:
  * date
  * position
```

**Edit 4.** Find:
```markdown
                     PublicBoardPage (home page when the board is on), LeadPage (/lead), OrganizationPage (/org)
  components/        shared UI; admin/, manager/, worker/, profile/, lead/, org/ sub-folders
  context/AuthContext.jsx, api/client.js   (locked: change only when asked)
  utils/             formatting, time zones, errors, push, version
database/init.sql    the whole schema (runs on an empty database)
database/upgrades/   "keep your data" SQL per version, for a database you don't want to wipe
```
Replace with:
```markdown
                     PublicBoardPage (home page when the board is on), LeadPage (/lead), OrganizationPage (/org)
  components/        shared UI; admin/, manager/, worker/, profile/, lead/, org/ sub-folders
                     BrandLogo.jsx = the logo (bar, stack or mark)
  brand.js           the names: APP_NAME ("ShiftUp"), APP_TAGLINE, BOARD_NAME ("ShiftBoard")
  context/AuthContext.jsx, api/client.js   (locked: change only when asked)
  utils/             formatting, time zones, errors, push, version
frontend/public/brand/   the logo pictures the app shows · frontend/public/icons/ = app icons and favicons
assets/                  the original logo (main_logo_shift-up.png); the files above are cut from it
frontend/tailwind.config.js   the brand colours (brand-50 … brand-950; brand-500 is the logo's gold)
scripts/phase37_rebrand.py    the one-off rename and recolour of Phase 37 (kept for the record; it does nothing on a second run)
database/init.sql    the whole schema (runs on an empty database)
database/upgrades/   "keep your data" SQL per version, for a database you don't want to wipe
```

**Edit 5.** Find:
```markdown
7. **No new packages** unless the phase says so.
8. **Every phase ends with a version bump and a CHANGELOG entry** (section 9).

---
```
Replace with:
```markdown
7. **No new packages** unless the phase says so.
8. **Every phase ends with a version bump and a CHANGELOG entry** (section 9).
9. **Brand and colour** (since 0.37.0):
   * The service is **ShiftUp**; the board of open shifts is the **ShiftBoard**. In new screens import `APP_NAME` and `BOARD_NAME` from `frontend/src/brand.js`, and show the logo with `<BrandLogo />`.
   * **Gold (`brand-*`)** is for main buttons, the active tab or link, links, focus rings and section icons. Text on solid gold is `text-slate-950`, never white.
   * **Green (`emerald-*`)** only means confirmed, booked, on, verified or done. **Amber** means waiting. **Rose** means a problem. Don't use green for a button that isn't one of those.
   * Two areas keep their own accent from before 0.37.0: the admin screens and the shift chat are indigo, and the organization screens are teal.
   * Don't redraw or recolour the logo. New sizes are cut from `assets/main_logo_shift-up.png`.

---
```

---

# PART R: For Andrew: restart and try it (AGY: don't run any of this)

## 1. Restart (no database change)

Nothing in the database changes, so **no wipe is needed** and there is no SQL. In each stack's folder:
```
docker compose restart frontend
```
* The frontend needs the restart to show 0.37.0 and to read the new colours. The backend reloads by itself.
* Your usual `docker compose up -d --build` works too. A wipe (`docker compose down -v`, then `docker compose up -d --build`) is only if you want one for other reasons.

## 2. Things only you can do

* **`EMAIL_FROM`:** if a stack's `.env` has `EMAIL_FROM=ShiftBoard <...>`, change the name to ShiftUp there, then `docker compose up -d --force-recreate`. Only the default changed; your `.env` wins.
* **Names outside the code:** the Firebase project's public name (shown on the Google sign-in screen and in Firebase emails), the Cloudflare tunnel's hostnames, and the sender name in Resend or your SMTP service.
* **Phones that already installed the app** keep the old icon and name for a while. Android updates them by itself within a day or two. On an iPhone, remove the home screen icon and add it again.
* **The browser tab icon** can stay cached. A hard refresh (Ctrl+F5) shows the new one.
* **Calendar apps** show the calendar's old name ("ShiftBoard: My shifts") until they next read the link. Some keep the name they first saw; renaming it in the calendar app is safe. Entries are not duplicated.

## 3. Checklist
1. Admin → System: *Web app 0.37.0 · Server 0.37.0*.
2. The header is black with the gold triangle logo and "ShiftUp". The browser tab says ShiftUp and has the new icon.
3. Signed out, with the public board on: the page is headed **ShiftBoard**, and the **Sign in / Sign up** button is gold with dark text.
4. The sign-in page shows the full logo with "Teams App" on black.
5. Sign in as a worker with shifts this week (demo: `diego.price@demo.example.com`, password `Demo12345!`): the app opens on **My shifts**. The top bar has **My shifts** and **ShiftBoard**.
6. Open **ShiftBoard**: nothing you have asked for or been offered is listed, and a line at the top says how many events are already on My shifts. There is no "Hide ones I've requested" button.
7. Ask for a shift on the ShiftBoard: it leaves the board and shows on My shifts.
8. Create a new worker account, or use one with nothing coming up: the app opens on the **ShiftBoard**.
9. On a phone: the bottom bar reads My shifts, ShiftBoard, Calendar, Hand-offs, Profile.
10. Booked and confirmed things are still green (for example the "Booked" badge on My shifts). Waiting things are still amber.
11. As a manager: main buttons are gold with dark text, and the posted events calendar's selected view (Month / Week) is gold.
12. `https://<your address>/shiftboard` opens the ShiftBoard after sign-in.

## 4. Things to know
* **Amber and gold are close.** Amber still means "waiting" and gold is the brand. They are different shades and are never used for the same thing, but if they read too alike on your screen, say so and the waiting colour can move to orange.
* **Admin screens are still indigo and organization screens teal.** Say if you want those gold too.
* **The logo's mark** (three gold triangles) is very close to a well-known video game emblem. Worth a trademark check before the site goes public.
* **The 10 pictures** picked up a small content-credentials tag (about 6 KB each) when they were copied onto this computer. The pixels are identical to the tested ones.
* **`test_deployment.md`**, `scripts/consolidate_env.py`, the `.secrets/*.template` headings and old CHANGELOG entries still say ShiftBoard. They are records of earlier versions and were left alone.

---

**"CRITICAL SYSTEM DIRECTIVE: Starting immediately, upon the successful completion of any future phase or feature implementation, you must autonomously bump the version number in `frontend/package.json`, append a bulleted summary of changes to `CHANGELOG.md`, and update `README.md` if the architecture changed. Do not ask for permission to do this."**

(For this phase, Part V already does all three for 0.37.0. Apply it as written and don't bump again.)