# Phase 34.6: Venue Website

**Why:** venues want to point people to their own site. Managers get a **Website** field in Venue settings, and it shows on the venue's public profile page as a link.

## What changes
* **Database:** new nullable column `venues.website_url VARCHAR(500)`.
* **Venue settings → Details:**
  * A **Website** field sits under the street address, with the placeholder "www.yourvenue.com" and the hint "Shown on your public venue page. Leave it blank to hide it."
  * It's a plain text field with a URL keyboard on phones, **not** `type="url"`, so the browser doesn't block "www.yourvenue.com" before the server can tidy it up.
* **Public venue page** (`/venues/:id`): next to the address and phone, a globe icon plus the site's name (e.g. `thehippodrome.com`) with an external-link icon. It opens in a new tab with `rel="noopener noreferrer nofollow"`. It's hidden when there's no website.
* **Server rules** (`clean_website()` in `services/venue_positions.py`, used on create and on settings update):
  * Spaces are trimmed. A bare domain gets `https://` added (`hippodrome.com` → `https://hippodrome.com`). `http://` and `https://` addresses are kept as typed; paths, query strings and ports are allowed.
  * **Refused** with 400 *"Enter the venue's web address, like www.yourvenue.com."*:
    * other schemes (`javascript:`, `mailto:`, `data:`, `ftp:`)
    * `localhost`, IP-only and single-word hosts
    * addresses with a user name / password
    * anything with spaces
    * more than 500 characters
  * An empty value **clears** it. Saving other settings leaves it alone.
  * The page also only renders `http(s)` links (a second guard).
* **API** (still 187 operations):
  * `website_url` is added to `VenueBase` / `VenueResponse`, `VenueCreate`, `VenueUpdateSettings` and `VenueProfileResponse`.
  * `GET /api/venues/{id}/profile` returns it to anyone signed in, since it's public information.
* **Version 0.34.6.** `frontend/package.json` and `backend/src/version.py` are both bumped, and the CHANGELOG entry is included below. **This covers the standing directive for this phase, so don't bump again.** No README change (no architecture change).

## 0. Rules for this phase
* Do **NOT** touch:
  - `backend/src/auth.py`, `backend/src/routers/auth.py`, `backend/src/main.py`
  - `frontend/src/context/AuthContext.jsx`, `frontend/src/api/client.js`, `frontend/vite.config.js`
* **Schema change:** see Part C (keep-your-data SQL, or `docker compose down -v` / `up -d --build`). No ENUMs.
* No new packages.
* **EDITS:** each edit is an exact *Find* → *Replace with*; every *Find* appears **exactly once** in the current file; apply them in order.
  - Some files use Windows line endings (CRLF). Match on the text and keep the file's line endings.
* **Verification.** All 10 files were checked against your repo and match (34.5 is fully applied). They were verified:
  - **Backend:** imports cleanly. 187 API operations. The API reports **0.34.6**.
  - **Frontend:** bundles with no missing imports.
  - **A new 23-check suite passes.** It covers:
    - bare domain → `https://`, http kept, trimmed, shown on the public profile
    - 10 bad inputs refused, with the saved value untouched
    - other settings keep it; empty clears it
    - workers can't set it (403)
    - new venues with a good or bad website
  - **Every earlier suite still passes**, including the 34.5 schema audit (no drift, no ENUMs).
  - **The keep-your-data SQL** was run twice on a copy of your current schema, and the result matches a fresh `init.sql` exactly.
  - In real Chromium:
    - a bad address shows the plain message in settings
    - a good one saves as `https://thehippodrome.com`
    - the public page shows `thehippodrome.com` with `target="_blank"` and `rel="noopener noreferrer nofollow"`, on desktop and phone
    - no page errors

  Don't "improve" them.

---

# PART A: Backend

## A1. `database/init.sql` (EDIT)
The new column in `CREATE TABLE venues`, right after `phone`.

**Edit 1.** Find:
```sql
    timezone VARCHAR(64) NOT NULL DEFAULT 'America/New_York',
    phone VARCHAR(30),
    arrival_instructions TEXT,
    dress_code TEXT,
```
Replace with:
```sql
    timezone VARCHAR(64) NOT NULL DEFAULT 'America/New_York',
    phone VARCHAR(30),
    website_url VARCHAR(500),                                -- Phase 34.6: the venue's own website (public profile)
    arrival_instructions TEXT,
    dress_code TEXT,
```

---

## A2. `backend/src/models.py` (EDIT)
`Venue.website_url`.

**Edit 1.** Find:
```python
    timezone = Column(String(64), nullable=False, default="America/New_York")
    phone = Column(String(30), nullable=True)
    arrival_instructions = Column(Text, nullable=True)
    dress_code = Column(Text, nullable=True)
```
Replace with:
```python
    timezone = Column(String(64), nullable=False, default="America/New_York")
    phone = Column(String(30), nullable=True)
    website_url = Column(String(500), nullable=True)                           # Phase 34.6: public profile link
    arrival_instructions = Column(Text, nullable=True)
    dress_code = Column(Text, nullable=True)
```

---

## A3. `backend/src/schemas.py` (EDITS)
Edits 1–4: `VenueBase`, `VenueCreate`, `VenueUpdateSettings`, `VenueProfileResponse`.

**Edit 1.** Find:
```python
    timezone: str = "America/New_York"
    phone: Optional[str] = None
    arrival_instructions: Optional[str] = None
    dress_code: Optional[str] = None
```
Replace with:
```python
    timezone: str = "America/New_York"
    phone: Optional[str] = None
    website_url: Optional[str] = None       # Phase 34.6
    arrival_instructions: Optional[str] = None
    dress_code: Optional[str] = None
```

**Edit 2.** Find:
```python
    timezone: Optional[str] = "America/New_York"
    phone: Optional[str] = None
    arrival_instructions: Optional[str] = None
    dress_code: Optional[str] = None
```
Replace with:
```python
    timezone: Optional[str] = "America/New_York"
    phone: Optional[str] = None
    website_url: Optional[str] = Field(None, max_length=500)          # Phase 34.6
    arrival_instructions: Optional[str] = None
    dress_code: Optional[str] = None
```

**Edit 3.** Find:
```python
    timezone: Optional[str] = None
    phone: Optional[str] = None
    arrival_instructions: Optional[str] = None
    dress_code: Optional[str] = None
```
Replace with:
```python
    timezone: Optional[str] = None
    phone: Optional[str] = None
    website_url: Optional[str] = Field(None, max_length=500)          # Phase 34.6: "" clears it
    arrival_instructions: Optional[str] = None
    dress_code: Optional[str] = None
```

**Edit 4.** Find:
```python
    logo_url: Optional[str] = None
    phone: Optional[str] = None
    timezone: str = "America/New_York"
    lat: float
```
Replace with:
```python
    logo_url: Optional[str] = None
    phone: Optional[str] = None
    website_url: Optional[str] = None        # Phase 34.6
    timezone: str = "America/New_York"
    lat: float
```

---

## A4. `backend/src/services/venue_positions.py` (EDITS)
`clean_website()` and its call inside `clean_venue_payload()` (used by both create and update).

**Edit 1.** Find:
```python
"""Phase 25: Default positions and venue field validation."""
from zoneinfo import ZoneInfo

```
Replace with:
```python
"""Phase 25: Default positions and venue field validation."""
import re
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

```

**Edit 2.** Find:
```python
    "name", "address", "phone", "arrival_instructions", "dress_code",
    "default_shift_notes", "description", "logo_url", "timezone", "approval_policy",
)


```
Replace with:
```python
    "name", "address", "phone", "arrival_instructions", "dress_code",
    "default_shift_notes", "description", "logo_url", "timezone", "approval_policy",
    "website_url",                                                                                   # Phase 34.6
)
WEBSITE_ERROR = "Enter the venue's web address, like www.yourvenue.com."
_HOST = re.compile(r"^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$", re.IGNORECASE)


def clean_website(value):
    """Phase 34.6: 'hippodrome.com' -> 'https://hippodrome.com'. Only http(s) links to a real-looking
    domain are kept (no javascript:, mailto:, IP-only or local addresses). None / '' -> None."""
    if value is None:
        return None
    url = str(value).strip()
    if not url:
        return None
    if any(ch.isspace() for ch in url):
        raise HTTPException(status_code=400, detail=WEBSITE_ERROR)
    if "://" not in url:
        if ":" in url.split("/")[0].split("?")[0] and not re.match(r"^[^:/]+:\d+", url):
            raise HTTPException(status_code=400, detail=WEBSITE_ERROR)      # e.g. javascript:alert(1), mailto:x
        url = "https://" + url
    try:
        parts = urlsplit(url)
        host = (parts.hostname or "").rstrip(".")
    except ValueError:
        raise HTTPException(status_code=400, detail=WEBSITE_ERROR)
    if parts.scheme.lower() not in ("http", "https") or not _HOST.match(host) or parts.username or parts.password:
        raise HTTPException(status_code=400, detail=WEBSITE_ERROR)
    if len(url) > 500:
        raise HTTPException(status_code=400, detail="That web address is too long (up to 500 characters).")
    return url


```

**Edit 3.** Find:
```python
            raise HTTPException(status_code=400, detail="Pick a time zone from the list.")

    if "approval_policy" in data and data["approval_policy"] not in VALID_APPROVAL_POLICIES:
        raise HTTPException(status_code=400, detail="Choose how shift requests are approved.")
```
Replace with:
```python
            raise HTTPException(status_code=400, detail="Pick a time zone from the list.")

    if "website_url" in data:                                                # Phase 34.6
        data["website_url"] = clean_website(data["website_url"])

    if "approval_policy" in data and data["approval_policy"] not in VALID_APPROVAL_POLICIES:
        raise HTTPException(status_code=400, detail="Choose how shift requests are approved.")
```

---

## A5. `backend/src/services/venue_public.py` (EDIT)

**Edit 1.** Find:
```python
        logo_url=venue.logo_url,
        phone=venue.phone,
        timezone=venue.timezone or "America/New_York",
        lat=float(venue.lat),
```
Replace with:
```python
        logo_url=venue.logo_url,
        phone=venue.phone,
        website_url=venue.website_url,                                      # Phase 34.6
        timezone=venue.timezone or "America/New_York",
        lat=float(venue.lat),
```

---

# PART B: Frontend

## B1. `frontend/src/components/VenueSettingsModal.jsx` (EDITS)
Form state, the save payload (sends `""` to clear), and the field.

**Edit 1.** Find:
```jsx
    address: venue?.address || '',
    phone: venue?.phone || '',
    timezone: venue?.timezone || 'America/New_York',
    lat: venue?.lat != null ? String(venue.lat) : '',
```
Replace with:
```jsx
    address: venue?.address || '',
    phone: venue?.phone || '',
    website_url: venue?.website_url || '',                                        // Phase 34.6
    timezone: venue?.timezone || 'America/New_York',
    lat: venue?.lat != null ? String(venue.lat) : '',
```

**Edit 2.** Find:
```jsx
      address: form.address.trim(),
      phone: form.phone.trim(),
      timezone: form.timezone,
      geofence_radius_meters: parseInt(form.geofence_radius_meters, 10) || 150,
```
Replace with:
```jsx
      address: form.address.trim(),
      phone: form.phone.trim(),
      website_url: form.website_url.trim(),                                       // Phase 34.6: "" clears it
      timezone: form.timezone,
      geofence_radius_meters: parseInt(form.geofence_radius_meters, 10) || 150,
```

**Edit 3.** Find:
```jsx
                <label className={labelCls}>Street address *</label>
                <input value={form.address} onChange={set('address')} className={inputCls} placeholder="142 Grand St, New York, NY" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
```
Replace with:
```jsx
                <label className={labelCls}>Street address *</label>
                <input value={form.address} onChange={set('address')} className={inputCls} placeholder="142 Grand St, New York, NY" />
              </div>
              {/* Phase 34.6: the venue's own website, linked from the public venue page */}
              <div>
                <label className={labelCls} htmlFor="venue-website">Website</label>
                <input id="venue-website" type="text" inputMode="url" autoComplete="url" value={form.website_url}
                  onChange={set('website_url')} className={inputCls} placeholder="www.yourvenue.com" maxLength={500} />
                <p className="text-[11px] text-slate-500 mt-1">Shown on your public venue page. Leave it blank to hide it.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
```

---

## B2. `frontend/src/pages/VenueProfile.jsx` (EDITS)
`Globe` icon import, two small helpers (only `http(s)` links are rendered), and the link next to the phone number.

**Edit 1.** Find:
```jsx
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, MapPin, Phone, ExternalLink, Info, Users, Calendar, Clock, Building2, Check, AlertCircle,
} from 'lucide-react';
import api from '../api/client';
```
Replace with:
```jsx
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, MapPin, Phone, ExternalLink, Info, Users, Calendar, Clock, Building2, Check, AlertCircle, Globe,
} from 'lucide-react';
import api from '../api/client';
```

**Edit 2.** Find:
```jsx
import { fmtDate, fmtTimeRange } from '../utils/venueTime';
import EventListingModal from '../components/EventListingModal';

const MY_STATUS = {
```
Replace with:
```jsx
import { fmtDate, fmtTimeRange } from '../utils/venueTime';
import EventListingModal from '../components/EventListingModal';

// Phase 34.6: the venue's website. Only http(s) links are ever rendered (the server checks this too).
function websiteHref(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;
}
function websiteLabel(url) {
  return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
}

const MY_STATUS = {
```

**Edit 3.** Find:
```jsx
                  <a href={`tel:${profile.phone}`} className="inline-flex items-center gap-1 hover:text-emerald-400">
                    <Phone className="w-4 h-4" /> {profile.phone}
                  </a>
                )}
```
Replace with:
```jsx
                  <a href={`tel:${profile.phone}`} className="inline-flex items-center gap-1 hover:text-emerald-400">
                    <Phone className="w-4 h-4" /> {profile.phone}
                  </a>
                )}
                {websiteHref(profile.website_url) && (
                  <a href={websiteHref(profile.website_url)} target="_blank" rel="noopener noreferrer nofollow"
                    className="inline-flex items-center gap-1 hover:text-emerald-400 min-w-0" title="Opens the venue's website">
                    <Globe className="w-4 h-4 flex-shrink-0" />
                    <span className="truncate max-w-[16rem]">{websiteLabel(profile.website_url)}</span>
                    <ExternalLink className="w-3 h-3 flex-shrink-0" />
                  </a>
                )}
```

---

# PART V: Version & changelog (the standing directive, done for you)

## V1. `frontend/package.json` (EDIT)

**Edit 1.** Find:
```json
  "name": "shiftboard-frontend",
  "private": true,
  "version": "0.34.0",
  "type": "module",
  "scripts": {
```
Replace with:
```json
  "name": "shiftboard-frontend",
  "private": true,
  "version": "0.34.6",
  "type": "module",
  "scripts": {
```

---

## V2. `backend/src/version.py` (EDIT)

**Edit 1.** Find:
```python
container is still running an old build.
"""
APP_VERSION = "0.34.0"
```
Replace with:
```python
container is still running an old build.
"""
APP_VERSION = "0.34.6"
```

---

## V3. `CHANGELOG.md` (EDIT)
The new section goes above `[0.34.0]`.

**Edit 1.** Find:
```markdown

The newest version goes at the top. Each entry uses a `## [x.y.z] - YYYY-MM-DD - Phase N: title` heading, followed by bullets under **Added / Changed / Fixed / Removed**.

## [0.34.0] - Phase 34 Feature Freeze
```
Replace with:
```markdown

The newest version goes at the top. Each entry uses a `## [x.y.z] - YYYY-MM-DD - Phase N: title` heading, followed by bullets under **Added / Changed / Fixed / Removed**.

## [0.34.6] - 2026-09-28 - Phase 34.6: Venue website

### Added
- Venues have a **Website** (`venues.website_url`, up to 500 characters). Managers set it in Venue settings → Details, under the street address.
- The public venue page shows it next to the address and phone, as a link that opens in a new tab.
- The server tidies what's typed (`hippodrome.com` → `https://hippodrome.com`) and only keeps real `http(s)` web addresses. Anything else is refused with a plain message: `javascript:`, `mailto:`, local or IP-only addresses, or addresses with a user name / password. An empty field clears it.
- `website_url` is included in the venue API responses (`VenueResponse`, `VenueProfileResponse`) and accepted when creating or updating a venue.

## [0.34.0] - Phase 34 Feature Freeze
```

---

# PART C: Rebuild & verification

**Schema change (one new, empty column).** Pick ONE:

**Option 1: fresh database (wipes all data):**
```bash
docker compose down -v
docker compose up -d --build
```

**Option 2: keep your data.** Run once, then rebuild without `-v`. It's safe to run twice.
```bash
docker compose exec -T database psql -U shiftboard_user -d shiftboard <<'SQL'
-- Phase 34.6: keep your data (run once; safe to run again). Adds one empty column.
ALTER TABLE venues ADD COLUMN IF NOT EXISTS website_url VARCHAR(500);
SQL
docker compose up -d --build
```
(If your database user or name differ in `.env`, use those.)

Then `docker compose restart frontend` so Vite picks up version 0.34.6.

### Checklist
1. Admin → System → Version says *Web app 0.34.6 · Server 0.34.6*.
2. Manager → **Settings** → Details: type `javascript:alert(1)` in **Website** and save. You see *"Enter the venue's web address, like www.yourvenue.com."*
3. Change it to `yourvenue.com` and save. Reopen Settings: it shows `https://yourvenue.com`.
4. Open the venue's public page (Venues → the venue). Next to the address you see 🌐 **yourvenue.com**, which opens the site in a new tab.
5. Clear the field and save. The link is gone from the public page.