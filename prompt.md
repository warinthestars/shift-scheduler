# Phase 22: Firebase Authentication with JIT User Provisioning

Replace the mocked Google sign-in with real Firebase Authentication. A user signs in with Google in the browser via the Firebase JS SDK; the frontend sends the Firebase ID token to `POST /api/auth/firebase-login`; the backend verifies it and either finds the matching ShiftBoard user or creates one Just-In-Time with role `worker`, then issues the existing ShiftBoard JWT. All downstream auth (`get_current_user`, role checks, Axios interceptors) stays exactly as it is.

**Config source of truth:** the Firebase web config is pasted verbatim (JS `firebaseConfig = {...}` snippet) into `.secrets/firebase-web-config.js`. The backend parses that file and (a) uses `projectId` to verify tokens, (b) serves the public config to the frontend at runtime via `GET /api/auth/firebase-config`. No `VITE_FIREBASE_*` env vars, no frontend rebuild when the config changes, and **no service-account private key is needed** (ID-token verification only needs the project ID + Google's public certs).

> The `.gitignore`, `.secrets/.secrets.env.template`, and `.secrets/firebase-web-config.js.template` files have ALREADY been updated by the architect. Do not touch them.

---

## 0. Guardrails (read before editing)
* DO NOT modify: `.gitignore`, anything inside `.secrets/`, `backend/src/auth.py`, `backend/src/main.py`, `frontend/src/api/client.js`, `frontend/src/components/ProtectedRoute.jsx`.
* In `backend/src/routers/auth.py`, modify ONLY the `firebase_login` function and ADD the new `firebase_config` endpoint + helper. Do NOT touch `register`, `login`, or `get_current_user_profile`.
* In `frontend/src/context/AuthContext.jsx`, changes are ADDITIVE ONLY (one import, one new function, one line in `logout`, one key in the Provider `value`). Do not rename, reorder or refactor anything else.
* NEVER call `UserResponse.model_validate(<User ORM>)` or read `user.venue_id` / `user.managed_venues` in the Firebase path — use explicit `select(...)` queries. (Lazy loads → `MissingGreenlet`.)
* All `datetime` comparisons use `datetime.now(timezone.utc)`.
* No schema changes in this phase. `users.firebase_uid` already exists (`VARCHAR(128) UNIQUE NULL`), and `users.hashed_password` is already nullable.

---

## 1. Dependencies (`backend/requirements.txt`)
Append these two lines (they are transitive deps of `firebase-admin` but must be pinned explicitly because we import them directly):
```
google-auth>=2.27.0
requests>=2.31.0
```

---

## 2. Configuration

### A. `backend/src/config.py`
* Change the `USE_MOCK_FIREBASE` default from `"true"` to `"false"`:
```python
    USE_MOCK_FIREBASE: bool = os.getenv("USE_MOCK_FIREBASE", "false").lower() in ("true", "1", "yes")
```
* Directly below `FIREBASE_CREDENTIALS_PATH`, add:
```python
    FIREBASE_WEB_CONFIG_PATH: str = os.getenv("FIREBASE_WEB_CONFIG_PATH", "/app/secrets/firebase-web-config.js")
```

### B. `docker-compose.yml`
In the `backend` service `environment:` list, DELETE this line:
```yaml
      - USE_MOCK_FIREBASE=${USE_MOCK_FIREBASE:-true}
```
(Reason: `environment:` overrides `env_file:`, so this line was forcing mock mode on regardless of `.secrets/.secrets.env`.) Change nothing else in the compose file. The `./.secrets:/app/secrets:ro` volume already exists and is what makes the config file visible to the backend.

### C. `frontend/.env.template`
Delete the entire `# Firebase Client SDK Configuration (PWA Authentication)` block (the six `VITE_FIREBASE_*` lines). Leave everything else.

### D. `backend/.env.template`
Replace the `# Firebase Admin SDK ...` block (the comment lines + `FIREBASE_CREDENTIALS_PATH`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`) with:
```
# Firebase Authentication — real config lives in .secrets/firebase-web-config.js
FIREBASE_WEB_CONFIG_PATH=/app/secrets/firebase-web-config.js
```
And change `USE_MOCK_FIREBASE=true` → `USE_MOCK_FIREBASE=false`.

---

## 3. Firebase Service Module (`backend/src/services/firebase.py` — NEW FILE)
Create with exactly this content:
```python
"""
Phase 22: Firebase helpers.
- load_firebase_web_config(): parses the pasted JS `firebaseConfig = {...}` snippet.
- verify_firebase_id_token(): verifies a Firebase ID token using Google's public certs.
No service-account credentials are required.
"""
import os
import re
from typing import Optional, Dict

from starlette.concurrency import run_in_threadpool
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests

from src.config import settings

_ALLOWED_KEYS = (
    "apiKey", "authDomain", "projectId", "storageBucket",
    "messagingSenderId", "appId", "measurementId",
)
_REQUIRED_KEYS = ("apiKey", "authDomain", "projectId", "appId")
_PLACEHOLDER_PROJECT_IDS = ("your-project-id", "shiftboard-firebase-project", "")
_KV_PATTERN = re.compile(r'([A-Za-z_][A-Za-z0-9_]*)\s*:\s*["\']([^"\']*)["\']')

_google_request = google_requests.Request()

_cache: Dict[str, object] = {"mtime": None, "config": None}


def load_firebase_web_config() -> Optional[Dict[str, str]]:
    """
    Returns the Firebase web config dict, or None if the file is missing,
    incomplete, or still contains template placeholders.
    Re-reads the file only when its modification time changes.
    """
    path = settings.FIREBASE_WEB_CONFIG_PATH
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        _cache["mtime"], _cache["config"] = None, None
        return None

    if _cache["mtime"] == mtime:
        return _cache["config"]

    try:
        with open(path, "r", encoding="utf-8") as fh:
            raw = fh.read()
    except OSError:
        return None

    # Strip // line comments and /* */ block comments before parsing
    raw = re.sub(r"/\*.*?\*/", "", raw, flags=re.S)
    raw = re.sub(r"(^|[^:])//.*$", r"\1", raw, flags=re.M)

    parsed = {k: v.strip() for k, v in _KV_PATTERN.findall(raw) if k in _ALLOWED_KEYS}
    if any(not parsed.get(k) for k in _REQUIRED_KEYS):
        config = None
    elif parsed["projectId"] in _PLACEHOLDER_PROJECT_IDS or parsed["apiKey"].startswith("your-"):
        config = None
    else:
        config = parsed

    _cache["mtime"], _cache["config"] = mtime, config
    return config


def _verify_sync(token: str, project_id: str) -> dict:
    claims = google_id_token.verify_firebase_token(
        token, _google_request, audience=project_id, clock_skew_in_seconds=10
    )
    if not claims:
        raise ValueError("Empty token claims")
    if claims.get("iss") != f"https://securetoken.google.com/{project_id}":
        raise ValueError("Invalid token issuer")
    if not claims.get("sub"):
        raise ValueError("Token has no subject (uid)")
    return claims


async def verify_firebase_id_token(token: str, project_id: str) -> dict:
    """Verify signature, expiry, audience and issuer. Runs the blocking call in a threadpool."""
    return await run_in_threadpool(_verify_sync, token, project_id)
```

---

## 4. Auth Router (`backend/src/routers/auth.py`)

### A. Imports
* Change `from sqlalchemy import select` → `from sqlalchemy import select, func`
* Add: `from src.services.firebase import load_firebase_web_config, verify_firebase_id_token`
* `VenueManager` is already imported from `src.models` — confirm it is; add it if missing.

### B. Add a safe serializer helper (place directly below `router = APIRouter(...)`)
```python
def _firebase_user_response(user: User, venue_id_str) -> UserResponse:
    """Column-only serializer for the Firebase path. Never touches ORM relationships."""
    return UserResponse(
        id=user.id,
        email=user.email,
        first_name=user.first_name or "",
        last_name=user.last_name or "",
        role=normalize_role(user.role),
        phone=user.phone,
        avatar_url=user.avatar_url,
        bio=user.bio,
        skills=user.skills or [],
        venue_id=venue_id_str,
        venue_ids=[venue_id_str] if venue_id_str else [],
        venue_names=[],
        aggregate_rating=float(user.aggregate_rating or 0.0),
        rating_count=int(user.rating_count or 0),
        total_shifts=int(user.total_shifts or 0),
        is_active=bool(user.is_active),
        created_at=user.created_at,
    )
```

### C. New endpoint — add directly ABOVE `firebase_login`
```python
@router.get("/firebase-config")
async def firebase_config():
    """
    Phase 22: Public Firebase web config for the frontend SDK.
    These values are public client identifiers by design (not secrets).
    """
    cfg = load_firebase_web_config()
    return {
        "enabled": cfg is not None,
        "mock": bool(settings.USE_MOCK_FIREBASE),
        "config": cfg,
    }
```

### D. Replace the ENTIRE `firebase_login` function with:
```python
@router.post("/firebase-login", response_model=TokenResponse)
async def firebase_login(request: FirebaseLoginRequest, db: AsyncSession = Depends(get_db)):
    """
    Phase 22: Exchange a Firebase ID token for a ShiftBoard JWT.
    JIT provisioning rules:
      1. Match on users.firebase_uid  -> sign in.
      2. Else match on email (case-insensitive) -> link firebase_uid ONLY if the
         Firebase email is verified, and the account is not linked to another uid.
      3. Else create a new user with role 'worker' (no venue access until a
         manager whitelists them).
    """
    token = (request.firebase_token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Missing Firebase token.")

    if settings.USE_MOCK_FIREBASE and token.startswith("mock-firebase-"):
        user = await get_or_create_mock_firebase_user(
            db,
            email=request.email or "demo_google_worker@shiftboard.com",
            first_name=request.first_name or "Alex",
            last_name=request.last_name or "Rivera"
        )
    else:
        web_cfg = load_firebase_web_config()
        if not web_cfg:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Firebase sign-in is not configured on this server."
            )

        try:
            claims = await verify_firebase_id_token(token, web_cfg["projectId"])
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Firebase token verification failed: {str(e)}"
            )

        firebase_uid = claims["sub"]
        email = (claims.get("email") or "").lower().strip()
        email_verified = bool(claims.get("email_verified"))
        if not email:
            raise HTTPException(status_code=400, detail="Your sign-in account has no email address.")

        try:
            user = await db.scalar(select(User).where(User.firebase_uid == firebase_uid))

            if not user:
                existing = await db.scalar(select(User).where(func.lower(User.email) == email))
                if existing:
                    if not email_verified:
                        raise HTTPException(
                            status_code=409,
                            detail="An account with this email already exists. Verify your email with your sign-in provider to link it."
                        )
                    if existing.firebase_uid and existing.firebase_uid != firebase_uid:
                        raise HTTPException(
                            status_code=409,
                            detail="This email is already linked to a different sign-in account."
                        )
                    existing.firebase_uid = firebase_uid
                    if not existing.avatar_url and claims.get("picture"):
                        existing.avatar_url = claims.get("picture")
                    user = existing
                else:
                    full_name = (claims.get("name") or "").strip()
                    parts = full_name.split(" ") if full_name else []
                    first_name = parts[0] if parts else email.split("@")[0]
                    last_name = " ".join(parts[1:]) if len(parts) > 1 else ""
                    user = User(
                        firebase_uid=firebase_uid,
                        email=email,
                        hashed_password=None,
                        first_name=first_name[:100],
                        last_name=last_name[:100],
                        role="worker",
                        avatar_url=claims.get("picture"),
                        skills=[],
                        aggregate_rating=5.0,
                        rating_count=0,
                        total_shifts=0,
                        is_active=True,
                    )
                    db.add(user)

                await db.commit()
                await db.refresh(user)
        except HTTPException:
            await db.rollback()
            raise
        except Exception as e:
            await db.rollback()
            raise HTTPException(status_code=500, detail=f"Failed to provision user: {str(e)}")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is inactive")

    venue_id = await db.scalar(
        select(VenueManager.venue_id).where(VenueManager.user_id == user.id).limit(1)
    )
    venue_id_str = str(venue_id) if venue_id else None

    try:
        jwt_token = create_access_token(data={
            "sub": str(user.id),
            "role": normalize_role(user.role),
            "venue_id": venue_id_str
        })
    except Exception as e:
        print(f"JWT Generation Error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server configuration error."
        )

    return TokenResponse(
        access_token=jwt_token,
        token_type="bearer",
        user=_firebase_user_response(user, venue_id_str)
    )
```

---

## 5. Frontend Firebase Module (`frontend/src/firebase.js` — NEW FILE)
The `firebase` npm package (`^10.9.0`) is already in `package.json`. Do not add or upgrade packages.
```jsx
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import api from './api/client';

let statusPromise = null;

/** Returns { enabled: bool, mock: bool, config: object|null }. Cached per page load. */
export function getFirebaseStatus() {
  if (!statusPromise) {
    statusPromise = api
      .get('/auth/firebase-config')
      .then((res) => res.data || { enabled: false, mock: false, config: null })
      .catch(() => ({ enabled: false, mock: false, config: null }));
  }
  return statusPromise;
}

async function getFirebaseAuth() {
  const status = await getFirebaseStatus();
  if (!status.enabled || !status.config) {
    throw new Error('Firebase sign-in is not configured on this server.');
  }
  const app = getApps().length ? getApps()[0] : initializeApp(status.config);
  return getAuth(app);
}

/** Opens the Google popup and returns a fresh Firebase ID token. */
export async function signInWithGoogle() {
  const auth = await getFirebaseAuth();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const credential = await signInWithPopup(auth, provider);
  return credential.user.getIdToken();
}

/** Signs out of the Firebase browser session (ShiftBoard JWT is cleared separately). */
export async function firebaseSignOut() {
  if (!getApps().length) return;
  await signOut(getAuth(getApps()[0]));
}
```

---

## 6. Auth Context — ADDITIVE ONLY (`frontend/src/context/AuthContext.jsx`)
1. Add import at the top: `import { signInWithGoogle, firebaseSignOut } from '../firebase';`
2. Add this function directly after `loginWithGoogleMock`:
```jsx
  const loginWithFirebase = async () => {
    const idToken = await signInWithGoogle();
    const response = await api.post('/auth/firebase-login', { firebase_token: idToken });
    const { access_token, user: apiUser } = response.data;
    return saveAuthSession(access_token, apiUser);
  };
```
3. As the FIRST line inside the existing `logout` function body, add:
```jsx
    firebaseSignOut().catch(() => {});
```
4. In the `AuthContext.Provider` `value={{ ... }}` object, add `loginWithFirebase,` directly after `loginWithGoogleMock,`.

Nothing else in this file changes.

---

## 7. Login Page (`frontend/src/pages/LoginPage.jsx`)

### A. Imports / hooks
* Add `useEffect` to the React import if not already imported.
* Add: `import { getFirebaseStatus } from '../firebase';`
* Change `const { login, loginWithGoogleMock, register } = useAuth();` → `const { login, loginWithGoogleMock, loginWithFirebase, register } = useAuth();`
* Add state + effect (after the existing `useState` declarations):
```jsx
  const [fbStatus, setFbStatus] = useState({ enabled: false, mock: false, config: null });

  useEffect(() => {
    let active = true;
    getFirebaseStatus().then((s) => { if (active) setFbStatus(s); });
    return () => { active = false; };
  }, []);
```

### B. Handler — add directly after `handleGoogleDemo`
```jsx
  const handleGoogleSignIn = async () => {
    setError('');
    setSubmitting(true);
    try {
      const userSession = await loginWithFirebase();
      navigateToRoleRoute(userSession);
    } catch (err) {
      const code = err?.code || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        // user closed the popup — not an error
      } else if (code === 'auth/unauthorized-domain') {
        setError('This domain is not authorized in Firebase. Add it under Authentication → Settings → Authorized domains.');
      } else {
        setError(err.response?.data?.detail || err.message || 'Google sign-in failed.');
      }
    } finally {
      setSubmitting(false);
    }
  };
```

### C. Button rendering
Wrap the EXISTING "Sign in with Google (Demo)" `<button>...</button>` element so it only renders in mock mode, and add the real button before it:
```jsx
          {fbStatus.enabled && (
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={submitting}
              className="w-full flex items-center justify-center py-2.5 px-4 rounded-xl border border-slate-700 bg-white hover:bg-slate-100 text-sm font-semibold text-slate-900 shadow-sm transition focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-6 disabled:opacity-60"
            >
              {/* reuse the same four-path Google "G" <svg> from the demo button here, unchanged */}
              <span>Sign in with Google</span>
            </button>
          )}

          {fbStatus.mock && !fbStatus.enabled && (
            /* existing "Sign in with Google (Demo)" <button> goes here, unchanged */
          )}
```
Copy the existing Google `<svg className="w-4 h-4 mr-2.5" ...>` element (all four `<path>`s) into the new button before the `<span>`. Do not change the demo button's markup. If neither `fbStatus.enabled` nor `fbStatus.mock` is true, no Google button renders. Leave the email/password form and the "or" divider unchanged.

---

## 8. Rebuild & Verification

No schema change → no `down -v`. Rebuild both services so the new Python deps install:
```bash
docker compose up -d --build backend frontend
```

Verify:
1. `curl -s https://dev-scheduler.jaccollective.com/api/auth/firebase-config` → `{"enabled": true, "mock": false, "config": {"apiKey": ..., "projectId": ...}}`. If `enabled` is `false`, the backend could not read/parse `/app/secrets/firebase-web-config.js` — check `docker compose exec backend cat /app/secrets/firebase-web-config.js`.
2. `docker compose exec backend printenv USE_MOCK_FIREBASE` → `false`.
3. Login page shows a white "Sign in with Google" button and NO "(Demo) Mocked" button.
4. Sign in with a Google account whose email is NOT in ShiftBoard → lands on `/worker`; a new row exists in `users` with `role='worker'`, `firebase_uid` set, `hashed_password` NULL.
5. As admin, create a user (Admin Panel) with a Gmail address you control, role `venue_manager`. Sign out, then "Sign in with Google" with that Gmail → lands on `/venue` with that venue, and `users.firebase_uid` is now populated for the existing row (no duplicate user created).
6. Deactivate a Firebase-provisioned user in Admin Panel → their next Google sign-in returns 403 "Account is inactive".
7. `POST /api/auth/firebase-login` with `{"firebase_token": "garbage"}` → 401.
8. Password login for the demo accounts still works unchanged.
9. `git status` shows NO changes under `.secrets/` and no change to `.gitignore` from this phase.

# Phase 22.1: Dynamic Sign-In Methods + Self-Service Registration

Phase 22 (Firebase + JIT provisioning) is already implemented. This phase builds on the CURRENT code:

1. **Dynamic sign-in methods.** The backend asks Firebase which sign-in providers are enabled (Firebase Console → Authentication → Sign-in method) and the login page renders exactly those buttons. Enabling or disabling a provider in Firebase shows or hides its button within ~5 minutes, with no code change or rebuild. Supported: Email/Password, Google, Microsoft, Apple, GitHub, Facebook, X/Twitter, Yahoo.
2. **Self-service registration.** A "Create a worker account" flow on the login page:
   * If Firebase **Email/Password** is enabled → Firebase account + verification email → user clicks the link → ShiftBoard account is JIT-created as a **worker**.
   * If only OAuth providers are enabled → the register view shows "Sign up with …" buttons (same JIT path).
   * If Firebase is NOT configured (or mock mode) → the existing local `/api/auth/register` endpoint is used, **forced to role `worker`**.
   * All of it can be switched off with `ALLOW_SELF_REGISTRATION=false`.
3. **Security fix.** `POST /api/auth/register` currently lets the caller choose `venue_manager` or even `platform_admin`, and the login page exposes a role dropdown. After this phase, self-registration can ONLY create workers.

> `.secrets/.secrets.env.template` and `.secrets/.secrets.env` have ALREADY been updated by the architect with `ALLOW_SELF_REGISTRATION` and `FIREBASE_AUTH_PROVIDERS`. Do not touch anything in `.secrets/` or `.gitignore`.

---

## 0. Guardrails (read before editing)
* DO NOT modify: `.gitignore`, anything in `.secrets/`, `docker-compose.yml`, `backend/src/auth.py`, `backend/src/main.py`, `frontend/src/api/client.js`, `frontend/src/components/ProtectedRoute.jsx`.
* In `backend/src/routers/auth.py`: replace ONLY `register` and `firebase_config`, and make ONLY the two edits to `firebase_login` specified in §4C. Do NOT touch `login` or `get_current_user_profile`.
* In `frontend/src/context/AuthContext.jsx`: ADDITIVE ONLY (one new function + one key in the Provider value).
* `frontend/src/firebase.js` and `frontend/src/pages/LoginPage.jsx` are REPLACED IN FULL with the exact content below. Do not merge old code back in.
* NEVER call `UserResponse.model_validate(<User ORM>)` in any code you touch. Use the existing `_firebase_user_response(user, venue_id_str)` helper.
* No schema changes. No new npm packages (`firebase@^10.9.0` and `lucide-react@^0.359.0` are already installed). `httpx` is already in `backend/requirements.txt`.

---

## 1. Configuration (`backend/src/config.py`)
Directly below the existing `FIREBASE_WEB_CONFIG_PATH` line, add:
```python
    FIREBASE_AUTH_PROVIDERS: str = os.getenv("FIREBASE_AUTH_PROVIDERS", "")
    ALLOW_SELF_REGISTRATION: bool = os.getenv("ALLOW_SELF_REGISTRATION", "true").lower() in ("true", "1", "yes")
```

---

## 2. Schema (`backend/src/schemas.py`)
In `class FirebaseLoginRequest`, add after `last_name`:
```python
    phone: Optional[str] = None
```
Change nothing else.

---

## 3. Provider Discovery (`backend/src/services/firebase.py`)

### A. Imports — add at the top with the others:
```python
import time
import logging
import httpx
```
and directly below the imports:
```python
logger = logging.getLogger(__name__)
```

### B. Append to the END of the file:
```python
# ------------------------------------------------------------------------------
# Phase 22.1: Sign-in provider discovery
# ------------------------------------------------------------------------------
SUPPORTED_PROVIDERS = (
    "password", "google.com", "microsoft.com", "apple.com",
    "github.com", "facebook.com", "twitter.com", "yahoo.com",
)
_DISCOVERY_URL = "https://www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig"
_SUCCESS_TTL_SECONDS = 300
_FAILURE_TTL_SECONDS = 30
_providers_cache: Dict[str, object] = {"api_key": None, "expires": 0.0, "value": None}


def _parse_provider_override(raw: str) -> list:
    out = []
    for p in raw.split(","):
        p = p.strip()
        if p in SUPPORTED_PROVIDERS and p not in out:
            out.append(p)
    return out


async def get_enabled_providers(cfg: Dict[str, str], referer: Optional[str] = None) -> dict:
    """
    Returns {"providers": [...], "source": "override" | "firebase" | "firebase-stale" | "fallback"}.
    Uses only the public web API key (no service account). Cached 5 min on success, 30 s on failure.
    """
    override = (settings.FIREBASE_AUTH_PROVIDERS or "").strip()
    if override:
        return {"providers": _parse_provider_override(override), "source": "override"}

    now = time.monotonic()
    if _providers_cache["api_key"] == cfg["apiKey"] and _providers_cache["expires"] > now:
        return _providers_cache["value"]

    # Browser API keys are often HTTP-referrer restricted; forward the page's referer.
    headers = {"Referer": referer or f"https://{cfg['authDomain']}/"}
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(_DISCOVERY_URL, params={"key": cfg["apiKey"]}, headers=headers)
        resp.raise_for_status()
        data = resp.json()

        providers = []
        if data.get("allowPasswordUser"):
            providers.append("password")
        for idp in data.get("idpConfig") or []:
            pid = idp.get("provider")
            if idp.get("enabled") and pid in SUPPORTED_PROVIDERS and pid not in providers:
                providers.append(pid)

        value = {"providers": providers, "source": "firebase"}
        ttl = _SUCCESS_TTL_SECONDS
    except Exception as e:
        logger.warning(f"Firebase provider discovery failed: {e}")
        prev = _providers_cache["value"] if _providers_cache["api_key"] == cfg["apiKey"] else None
        if prev and prev.get("source") in ("firebase", "firebase-stale"):
            value = {"providers": prev["providers"], "source": "firebase-stale"}
        else:
            value = {"providers": ["google.com"], "source": "fallback"}
        ttl = _FAILURE_TTL_SECONDS

    _providers_cache.update(api_key=cfg["apiKey"], expires=now + ttl, value=value)
    return value
```

---

## 4. Auth Router (`backend/src/routers/auth.py`)

### A. Imports
* Change `from fastapi import APIRouter, Depends, HTTPException, status` → `from fastapi import APIRouter, Depends, HTTPException, status, Request`
* Change `from src.services.firebase import load_firebase_web_config, verify_firebase_id_token` → `from src.services.firebase import load_firebase_web_config, verify_firebase_id_token, get_enabled_providers`

### B. Replace the ENTIRE `register` function with:
```python
@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(request: UserCreate, db: AsyncSession = Depends(get_db)):
    """
    Phase 22.1: Local self-service registration.
    - ALWAYS creates a 'worker' (request.role is ignored).
    - Only available when real Firebase is NOT configured; otherwise sign-up goes through Firebase.
    """
    if not settings.ALLOW_SELF_REGISTRATION:
        raise HTTPException(status_code=403, detail="Self-registration is disabled. Ask an administrator to create your account.")
    if load_firebase_web_config() is not None and not settings.USE_MOCK_FIREBASE:
        raise HTTPException(status_code=409, detail="Use the sign-up options on the login page.")

    email = request.email.lower().strip()
    if len(request.password or "") < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")

    existing = await db.scalar(select(User).where(func.lower(User.email) == email))
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A user with this email already exists")

    try:
        user = User(
            email=email,
            hashed_password=get_password_hash(request.password),
            role="worker",
            first_name=(request.first_name or "").strip()[:100],
            last_name=(request.last_name or "").strip()[:100],
            phone=request.phone.strip() if request.phone else None,
            skills=request.skills or [],
            bio=request.bio,
            aggregate_rating=5.00,
            rating_count=0,
            total_shifts=0,
            is_active=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create account: {str(e)}")

    try:
        token = create_access_token(data={"sub": str(user.id), "role": "worker", "venue_id": None})
    except Exception as e:
        print(f"JWT Generation Error: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server configuration error.")

    return TokenResponse(access_token=token, token_type="bearer", user=_firebase_user_response(user, None))
```

### C. Two edits inside `firebase_login` (change nothing else in this function)

**Edit 1** — the new-user branch. Find the `else:` block that begins with `full_name = (claims.get("name") or "").strip()` (it follows the `if existing:` block). Replace everything from that `else:` down to and including the closing `)` of `user = User(...)` and the `db.add(user)` line with:
```python
                else:
                    if not settings.ALLOW_SELF_REGISTRATION:
                        raise HTTPException(
                            status_code=403,
                            detail="Self-registration is disabled. Ask an administrator to create your account."
                        )
                    if not email_verified:
                        raise HTTPException(
                            status_code=403,
                            detail="Please verify your email address first. Check your inbox for the verification link."
                        )

                    if request.first_name and request.first_name.strip():
                        first_name = request.first_name.strip()[:100]
                        last_name = (request.last_name or "").strip()[:100]
                    else:
                        full_name = (claims.get("name") or "").strip()
                        parts = full_name.split(" ") if full_name else []
                        first_name = (parts[0] if parts else email.split("@")[0])[:100]
                        last_name = (" ".join(parts[1:]) if len(parts) > 1 else "")[:100]

                    user = User(
                        firebase_uid=firebase_uid,
                        email=email,
                        hashed_password=None,
                        first_name=first_name,
                        last_name=last_name,
                        phone=request.phone.strip() if request.phone else None,
                        role="worker",
                        avatar_url=claims.get("picture"),
                        skills=[],
                        aggregate_rating=5.0,
                        rating_count=0,
                        total_shifts=0,
                        is_active=True,
                    )
                    db.add(user)
```
Keep the existing `await db.commit()` / `await db.refresh(user)` lines and the `except HTTPException: await db.rollback(); raise` handler that follow it unchanged.

**Edit 2** — none of the email-linking logic (`if existing:` branch) changes. Confirm it still requires `email_verified` before linking.

### D. Replace the ENTIRE `firebase_config` function with:
```python
@router.get("/firebase-config")
async def firebase_config(request: Request):
    """
    Phase 22.1: Public Firebase web config + the sign-in providers currently enabled in Firebase.
    These values are public client identifiers by design (not secrets).
    """
    cfg = load_firebase_web_config()
    providers, source = [], "none"
    if cfg is not None and not settings.USE_MOCK_FIREBASE:
        discovered = await get_enabled_providers(cfg, referer=request.headers.get("referer"))
        providers, source = discovered["providers"], discovered["source"]
    return {
        "enabled": cfg is not None,
        "mock": bool(settings.USE_MOCK_FIREBASE),
        "config": cfg,
        "providers": providers,
        "providers_source": source,
        "self_registration": bool(settings.ALLOW_SELF_REGISTRATION),
    }
```

---

## 5. Frontend Firebase Module — REPLACE FILE (`frontend/src/firebase.js`)
```jsx
import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  GithubAuthProvider,
  FacebookAuthProvider,
  TwitterAuthProvider,
  OAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  updateProfile,
  signOut,
} from 'firebase/auth';
import api from './api/client';

const EMPTY_STATUS = {
  enabled: false,
  mock: false,
  config: null,
  providers: [],
  providers_source: 'none',
  self_registration: false,
};

/** Display metadata for OAuth providers. 'password' is handled by the email form. */
export const PROVIDER_META = {
  'google.com': { label: 'Google' },
  'microsoft.com': { label: 'Microsoft' },
  'apple.com': { label: 'Apple' },
  'github.com': { label: 'GitHub' },
  'facebook.com': { label: 'Facebook' },
  'twitter.com': { label: 'X (Twitter)' },
  'yahoo.com': { label: 'Yahoo' },
};

let statusPromise = null;

/** Returns the /auth/firebase-config payload merged over EMPTY_STATUS. Cached per page load. */
export function getFirebaseStatus() {
  if (!statusPromise) {
    statusPromise = api
      .get('/auth/firebase-config')
      .then((res) => ({ ...EMPTY_STATUS, ...(res.data || {}) }))
      .catch(() => ({ ...EMPTY_STATUS }));
  }
  return statusPromise;
}

async function getFirebaseAuth() {
  const status = await getFirebaseStatus();
  if (!status.enabled || !status.config) {
    throw new Error('Firebase sign-in is not configured on this server.');
  }
  const app = getApps().length ? getApps()[0] : initializeApp(status.config);
  return getAuth(app);
}

function buildProvider(providerId) {
  switch (providerId) {
    case 'google.com': {
      const p = new GoogleAuthProvider();
      p.setCustomParameters({ prompt: 'select_account' });
      return p;
    }
    case 'github.com':
      return new GithubAuthProvider();
    case 'facebook.com':
      return new FacebookAuthProvider();
    case 'twitter.com':
      return new TwitterAuthProvider();
    case 'microsoft.com':
    case 'apple.com':
    case 'yahoo.com':
      return new OAuthProvider(providerId);
    default:
      throw new Error(`Unsupported sign-in provider: ${providerId}`);
  }
}

/** Opens the provider popup and returns a Firebase ID token. */
export async function signInWithProviderId(providerId) {
  const auth = await getFirebaseAuth();
  const credential = await signInWithPopup(auth, buildProvider(providerId));
  return credential.user.getIdToken();
}

/** Backward-compatible alias used by AuthContext.loginWithFirebase. */
export async function signInWithGoogle() {
  return signInWithProviderId('google.com');
}

/** Email/password sign-in. Returns the Firebase user (caller checks emailVerified). */
export async function signInWithEmail(email, password) {
  const auth = await getFirebaseAuth();
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user;
}

/** Creates a Firebase email/password account, sets display name, sends verification email. */
export async function registerWithEmail({ email, password, firstName, lastName }) {
  const auth = await getFirebaseAuth();
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  const displayName = `${firstName || ''} ${lastName || ''}`.trim();
  if (displayName) {
    await updateProfile(credential.user, { displayName });
  }
  await sendEmailVerification(credential.user);
  return credential.user;
}

export async function resendVerificationEmail() {
  const auth = await getFirebaseAuth();
  if (!auth.currentUser) {
    throw new Error('Your session expired. Sign in with your email and password to resend the link.');
  }
  await sendEmailVerification(auth.currentUser);
}

/** Reloads the Firebase user; returns a fresh ID token if verified, otherwise throws. */
export async function completeEmailVerification() {
  const auth = await getFirebaseAuth();
  if (!auth.currentUser) {
    throw new Error('Your session expired. Sign in with your email and password.');
  }
  await auth.currentUser.reload();
  if (!auth.currentUser.emailVerified) {
    const err = new Error('Your email is not verified yet. Click the link in your inbox, then try again.');
    err.code = 'app/email-not-verified';
    throw err;
  }
  return auth.currentUser.getIdToken(true);
}

export async function sendPasswordReset(email) {
  const auth = await getFirebaseAuth();
  await sendPasswordResetEmail(auth, email);
}

/** Signs out of the Firebase browser session (ShiftBoard JWT is cleared separately). */
export async function firebaseSignOut() {
  if (!getApps().length) return;
  await signOut(getAuth(getApps()[0]));
}
```

---

## 6. Auth Context — ADDITIVE ONLY (`frontend/src/context/AuthContext.jsx`)
1. Directly after the existing `loginWithFirebase` function, add:
```jsx
  const loginWithFirebaseToken = async (idToken, profile = {}) => {
    const response = await api.post('/auth/firebase-login', { firebase_token: idToken, ...profile });
    const { access_token, user: apiUser } = response.data;
    return saveAuthSession(access_token, apiUser);
  };
```
2. In the Provider `value={{ ... }}`, add `loginWithFirebaseToken,` directly after `loginWithFirebase,`.

Nothing else changes. (`loginWithFirebase` stays for backward compatibility.)

---

## 7. Login Page — REPLACE FILE (`frontend/src/pages/LoginPage.jsx`)
```jsx
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  Calendar,
  Shield,
  UserCheck,
  AlertCircle,
  ArrowRight,
  Building2,
  LogIn,
  MailCheck,
  Info,
} from 'lucide-react';
import {
  getFirebaseStatus,
  PROVIDER_META,
  signInWithProviderId,
  signInWithEmail,
  registerWithEmail,
  resendVerificationEmail,
  completeEmailVerification,
  sendPasswordReset,
  firebaseSignOut,
} from '../firebase';

function GoogleIcon() {
  return (
    <svg className="w-4 h-4 mr-2.5" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
    </svg>
  );
}

function friendlyError(err, fallback) {
  const code = err?.code || '';
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return null;
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Sign in instead.';
    case 'auth/weak-password':
      return 'Password is too weak. Use at least 8 characters.';
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is turned off in Firebase.';
    case 'auth/account-exists-with-different-credential':
      return 'You already signed up with a different method for this email. Use that method instead.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized in Firebase. Add it under Authentication → Settings → Authorized domains.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in popup. Allow popups for this site and try again.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a moment and try again.';
    default:
      return err?.response?.data?.detail || err?.message || fallback;
  }
}

const TITLES = {
  signin: 'Sign in',
  register: 'Create your worker account',
  verify: 'Verify your email',
  reset: 'Reset your password',
};

export default function LoginPage() {
  const [mode, setMode] = useState('signin'); // 'signin' | 'register' | 'verify' | 'reset'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fbStatus, setFbStatus] = useState({
    enabled: false,
    mock: false,
    config: null,
    providers: [],
    self_registration: false,
  });

  const { login, loginWithGoogleMock, loginWithFirebaseToken, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname;

  useEffect(() => {
    let active = true;
    getFirebaseStatus().then((s) => {
      if (active) setFbStatus(s);
    });
    return () => {
      active = false;
    };
  }, []);

  // ---- Derived availability (driven by what is enabled in Firebase) ----
  const fbReady = fbStatus.enabled && !fbStatus.mock;
  const providers = fbReady ? fbStatus.providers || [] : [];
  const oauthProviders = providers.filter((p) => p !== 'password' && PROVIDER_META[p]);
  const firebasePassword = providers.includes('password');
  const showRegisterForm = !fbReady || firebasePassword;
  const canRegister =
    !!fbStatus.self_registration && (!fbReady || firebasePassword || oauthProviders.length > 0);

  const navigateToRoleRoute = (userSession) => {
    const userRole = (userSession?.role || '').toLowerCase();
    const defaultRoute =
      userRole === 'platform_admin' ? '/admin' : userRole === 'venue_manager' ? '/venue' : '/worker';
    const target = from && from !== '/' ? from : defaultRoute;
    navigate(target, { replace: true });
  };

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setInfo('');
  };

  const profilePayload = () => ({
    first_name: firstName.trim() || undefined,
    last_name: lastName.trim() || undefined,
    phone: phone.trim() || undefined,
  });

  // ---- Sign in: local password first (demo/admin-created accounts), then Firebase email/password ----
  const handleSignIn = async () => {
    try {
      const userSession = await login(email, password);
      navigateToRoleRoute(userSession);
      return;
    } catch (err) {
      if (!(firebasePassword && err.response?.status === 401)) throw err;
    }
    const fbUser = await signInWithEmail(email, password);
    if (!fbUser.emailVerified) {
      setMode('verify');
      setError('');
      setInfo(`${email} isn't verified yet. Click the link we emailed you, then press "I've verified my email".`);
      return;
    }
    const idToken = await fbUser.getIdToken();
    const userSession = await loginWithFirebaseToken(idToken);
    navigateToRoleRoute(userSession);
  };

  const handleRegister = async () => {
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (fbReady && firebasePassword) {
      await registerWithEmail({
        email,
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      setMode('verify');
      setError('');
      setInfo(`We sent a verification link to ${email}. Click it, then press "I've verified my email".`);
      return;
    }
    const userSession = await register({
      email,
      password,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      phone: phone.trim() || null,
    });
    navigateToRoleRoute(userSession);
  };

  const handleResetRequest = async () => {
    await sendPasswordReset(email);
    setInfo('If an account exists for that email, a password reset link is on its way.');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setSubmitting(true);
    try {
      if (mode === 'register') await handleRegister();
      else if (mode === 'reset') await handleResetRequest();
      else await handleSignIn();
    } catch (err) {
      const msg = friendlyError(err, 'Authentication failed. Please check your credentials.');
      if (msg) setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifiedContinue = async () => {
    setError('');
    setSubmitting(true);
    try {
      const idToken = await completeEmailVerification();
      const userSession = await loginWithFirebaseToken(idToken, profilePayload());
      navigateToRoleRoute(userSession);
    } catch (err) {
      const msg = friendlyError(err, 'Could not complete sign-in.');
      if (msg) setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    setError('');
    setSubmitting(true);
    try {
      await resendVerificationEmail();
      setInfo('Verification email sent again. Check your inbox (and spam folder).');
    } catch (err) {
      const msg = friendlyError(err, 'Could not resend the email.');
      if (msg) setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleBackToSignIn = async () => {
    await firebaseSignOut().catch(() => {});
    switchMode('signin');
  };

  const handleProvider = async (providerId) => {
    setError('');
    setInfo('');
    setSubmitting(true);
    try {
      const idToken = await signInWithProviderId(providerId);
      const userSession = await loginWithFirebaseToken(idToken);
      navigateToRoleRoute(userSession);
    } catch (err) {
      const msg = friendlyError(err, 'Sign-in failed.');
      if (msg) setError(msg);
      if (err?.response) firebaseSignOut().catch(() => {});
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleDemo = async () => {
    setError('');
    setSubmitting(true);
    try {
      const userSession = await loginWithGoogleMock();
      navigateToRoleRoute(userSession);
    } catch (err) {
      setError(err.response?.data?.detail || 'Google Mock Auth failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const fillCredentials = (demoEmail, demoPassword) => {
    setEmail(demoEmail);
    setPassword(demoPassword);
    switchMode('signin');
  };

  const showOauth = (mode === 'signin' || mode === 'register') && oauthProviders.length > 0;
  const showMockButton = mode === 'signin' && fbStatus.mock;
  const showForm = mode === 'signin' || mode === 'reset' || (mode === 'register' && showRegisterForm);
  const inputClass =
    'w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-emerald-500';

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 text-slate-100">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="inline-flex w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 items-center justify-center shadow-xl shadow-emerald-500/20 mb-4">
          <Calendar className="w-8 h-8 text-slate-950 font-black" />
        </div>
        <h2 className="text-3xl font-extrabold tracking-tight text-white">
          Shift<span className="text-emerald-400">Board</span>
        </h2>
        <p className="mt-2 text-sm text-slate-400">Hospitality Call-Board & Shift Scheduling Platform</p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4">
        <div className="bg-slate-900 py-8 px-6 shadow-2xl rounded-2xl border border-slate-800 sm:px-10">
          {mode === 'signin' && (
            <div className="mb-6 p-3 bg-slate-800/60 rounded-xl border border-slate-700/60 text-xs">
              <div className="font-semibold text-slate-300 mb-2">⚡ Quick Demo Credentials:</div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => fillCredentials('demo_admin@shiftboard.com', 'SuperSecretDemo123!')}
                  className="px-2 py-1.5 rounded-lg bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/50 text-indigo-300 font-medium transition text-left flex items-center space-x-1"
                  title="Super Admin (platform_admin)"
                >
                  <Shield className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">Admin</span>
                </button>
                <button
                  type="button"
                  onClick={() => fillCredentials('demo_manager@shiftboard.com', 'DemoManager123!')}
                  className="px-2 py-1.5 rounded-lg bg-teal-950/80 hover:bg-teal-900 border border-teal-700/50 text-teal-300 font-medium transition text-left flex items-center space-x-1"
                  title="Venue Manager (venue_manager)"
                >
                  <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">Manager</span>
                </button>
                <button
                  type="button"
                  onClick={() => fillCredentials('demo_worker@shiftboard.com', 'DemoWorker123!')}
                  className="px-2 py-1.5 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-700/50 text-emerald-300 font-medium transition text-left flex items-center space-x-1"
                  title="Demo Worker (worker)"
                >
                  <UserCheck className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">Worker</span>
                </button>
              </div>
            </div>
          )}

          <h3 className="text-lg font-bold text-white mb-4">{TITLES[mode]}</h3>

          {mode === 'register' && (
            <div className="mb-4 p-3 bg-slate-800/60 border border-slate-700/60 rounded-xl text-slate-300 text-xs flex items-start space-x-2">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-slate-400" />
              <span>New accounts start as Workers. Venue manager and admin accounts are set up by an administrator.</span>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {info && (
            <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-300 text-sm flex items-start space-x-2">
              <MailCheck className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{info}</span>
            </div>
          )}

          {mode === 'verify' ? (
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleVerifiedContinue}
                disabled={submitting}
                className="w-full flex items-center justify-center py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 font-semibold text-slate-950 text-sm shadow-lg shadow-emerald-500/20 transition disabled:opacity-50"
              >
                <span>{submitting ? 'Checking…' : "I've verified my email"}</span>
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </button>
              <button
                type="button"
                onClick={handleResend}
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-sm font-semibold text-slate-200 transition disabled:opacity-50"
              >
                Resend verification email
              </button>
              <button
                type="button"
                onClick={handleBackToSignIn}
                className="w-full text-xs text-slate-400 hover:text-emerald-400 transition underline underline-offset-4"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <>
              {showOauth && (
                <div className="space-y-2 mb-6">
                  {oauthProviders.map((pid) => {
                    const verb = mode === 'register' ? 'Sign up' : 'Continue';
                    const isGoogle = pid === 'google.com';
                    return (
                      <button
                        key={pid}
                        type="button"
                        onClick={() => handleProvider(pid)}
                        disabled={submitting}
                        className={
                          isGoogle
                            ? 'w-full flex items-center justify-center py-2.5 px-4 rounded-xl border border-slate-700 bg-white hover:bg-slate-100 text-sm font-semibold text-slate-900 shadow-sm transition focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60'
                            : 'w-full flex items-center justify-center py-2.5 px-4 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-sm font-semibold text-white shadow-sm transition focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60'
                        }
                      >
                        {isGoogle ? <GoogleIcon /> : <LogIn className="w-4 h-4 mr-2.5" />}
                        <span>{`${verb} with ${PROVIDER_META[pid].label}`}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {showMockButton && (
                <button
                  type="button"
                  onClick={handleGoogleDemo}
                  disabled={submitting}
                  className="w-full flex items-center justify-center py-2.5 px-4 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-sm font-semibold text-white shadow-sm transition focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-6"
                >
                  <GoogleIcon />
                  <span>Sign in with Google (Demo)</span>
                  <span className="ml-2 text-xs text-emerald-400 bg-emerald-950 px-1.5 py-0.5 rounded border border-emerald-800">
                    Mocked
                  </span>
                </button>
              )}

              {(showOauth || showMockButton) && showForm && (
                <div className="relative mb-6">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-slate-800"></div>
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-slate-900 px-3 text-slate-500 font-medium tracking-wider">or use email</span>
                  </div>
                </div>
              )}

              {showForm && (
                <form onSubmit={handleSubmit} className="space-y-4">
                  {mode === 'register' && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-300 mb-1">First Name</label>
                          <input type="text" required value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} placeholder="Jane" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-300 mb-1">Last Name</label>
                          <input type="text" required value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass} placeholder="Doe" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-300 mb-1">Phone (optional)</label>
                        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} placeholder="555-555-0100" />
                      </div>
                    </>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Email address</label>
                    <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="name@example.com" />
                  </div>

                  {mode !== 'reset' && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-medium text-slate-300">Password</label>
                        {mode === 'signin' && firebasePassword && (
                          <button type="button" onClick={() => switchMode('reset')} className="text-xs text-slate-400 hover:text-emerald-400 transition">
                            Forgot password?
                          </button>
                        )}
                      </div>
                      <input
                        type="password"
                        required
                        minLength={mode === 'register' ? 8 : undefined}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className={inputClass}
                        placeholder="••••••••••••"
                      />
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full mt-2 flex items-center justify-center py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 font-semibold text-slate-950 text-sm shadow-lg shadow-emerald-500/20 transition focus:outline-none disabled:opacity-50"
                  >
                    <span>
                      {submitting
                        ? 'Please wait...'
                        : mode === 'register'
                        ? 'Create Account'
                        : mode === 'reset'
                        ? 'Send reset link'
                        : 'Sign In'}
                    </span>
                    <ArrowRight className="w-4 h-4 ml-1.5" />
                  </button>
                </form>
              )}

              {mode === 'register' && !showRegisterForm && oauthProviders.length > 0 && (
                <p className="text-xs text-slate-400 text-center">Choose a sign-up option above.</p>
              )}

              <div className="mt-6 text-center">
                {mode === 'signin' && canRegister && (
                  <button
                    type="button"
                    onClick={() => switchMode('register')}
                    className="text-xs text-slate-400 hover:text-emerald-400 transition underline underline-offset-4"
                  >
                    New here? Create a worker account
                  </button>
                )}
                {(mode === 'register' || mode === 'reset') && (
                  <button
                    type="button"
                    onClick={() => switchMode('signin')}
                    className="text-xs text-slate-400 hover:text-emerald-400 transition underline underline-offset-4"
                  >
                    Already have an account? Sign in
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

---

## 8. Rebuild & Verification

No schema change → no `down -v`:
```bash
docker compose up -d --build backend frontend
```

Verify:
1. `curl -s https://dev-scheduler.jaccollective.com/api/auth/firebase-config | python3 -m json.tool` → `"providers"` lists what is enabled in Firebase Console (e.g. `["password", "google.com"]`), `"providers_source": "firebase"`, `"self_registration": true`.
   * If `providers_source` is `"fallback"`: run `docker compose logs backend | grep "provider discovery"` to see the error. A `403` usually means the Firebase browser API key has HTTP-referrer restrictions that don't include the site; either add `dev-scheduler.jaccollective.com/*` to the key's allowed referrers in Google Cloud Console → APIs & Services → Credentials, or set `FIREBASE_AUTH_PROVIDERS=password,google.com` in `.secrets/.secrets.env` and restart the backend.
2. In Firebase Console, **disable** Google → wait up to 5 min (or `docker compose restart backend`) → hard-refresh login page → Google button is gone. Re-enable → it returns.
3. With Email/Password enabled: "New here? Create a worker account" → fill form → "Create Account" → verification screen appears → click link in email → "I've verified my email" → lands on `/worker`. `users` row has `role='worker'`, `firebase_uid` set, and the first/last name/phone entered in the form.
4. Before clicking the verification link, "I've verified my email" shows "Your email is not verified yet…" and no `users` row is created.
5. Sign out, then sign in with that email/password on the normal form → goes straight to `/worker`.
6. Demo accounts (Admin/Manager/Worker quick buttons) still sign in via local password.
7. "Forgot password?" (only visible when Email/Password is enabled) sends a Firebase reset email.
8. Set `ALLOW_SELF_REGISTRATION=false` in `.secrets/.secrets.env` → `docker compose up -d backend` → the "Create a worker account" link disappears, and a brand-new Google account gets "Self-registration is disabled…" while existing users still sign in.
9. `curl -s -X POST https://dev-scheduler.jaccollective.com/api/auth/register -H 'Content-Type: application/json' -d '{"email":"x@example.com","password":"Password123!","role":"platform_admin"}'` → with Firebase configured returns `409`; with Firebase not configured it creates a user whose role is `worker` (never `platform_admin`).
10. `git status` shows no changes under `.secrets/` or to `.gitignore` from this phase.