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