# Phase 25.4: Admin Password Reset + Sign-in Method Badges

Patch on top of Phase 25.3 (implemented). **No schema change, no database wipe.**

1. **Sign-in method badge** on every user in Admin Panel → Users:
   * **Local**: has a ShiftBoard password (created by an admin, seeded, or local sign-up).
   * **Firebase**: signs in only through Firebase (Google, email link, Firebase email/password, etc.).
   * **Local + Firebase**: an account that has a local password AND has also been linked to Firebase (e.g. admin-created, then signed in with Google).
   Plus a **Sign-in** filter (All / Local / Firebase).
2. **Reset password** (key icon) for any user with a local password. The admin either **generates a temporary password** (shown once with a Copy button) or **sets one**. Firebase-only users show a disabled key icon explaining their password lives in Firebase.

Derived from existing columns: `users.hashed_password` (local password present) and `users.firebase_uid` (linked to Firebase). Never returns the hash or the uid to the browser, only the derived label.

---

## 0. Guardrails
* DO NOT modify: `.gitignore`, `.secrets/`, `docker-compose.yml`, `database/init.sql`, `backend/src/models.py`, `backend/src/auth.py`, `backend/src/main.py`, `backend/src/routers/auth.py`, `frontend/src/context/AuthContext.jsx`, `frontend/src/api/client.js`, `App.jsx`, `Navbar.jsx`, `LoginPage.jsx`.
* `backend/src/serializers.py`: ONLY the additions in §2.
* Never include `hashed_password` or `firebase_uid` in any API response.
* Passwords are hashed with the existing `get_password_hash` (bcrypt). Minimum 8 characters.
* Use `ModalShell` for the new modal (so it stacks, scrolls, and closes on Esc like the others).
* Only these `lucide-react` icons are used in new code: `KeyRound`, `Flame`, `Copy`, `Eye`, `EyeOff`, `RefreshCw`, `Check`.

---

## 1. Schemas (`backend/src/schemas.py`)
1. In `class UserResponse`, add directly after `created_at: datetime`:
```python
    auth_source: Optional[str] = None     # "local" | "firebase" | "both"
    has_password: bool = False
```
2. Append at the END of the file:
```python
# ------------------------------------------------------------------------------
# Phase 25.4: Admin password reset
# ------------------------------------------------------------------------------
class AdminPasswordReset(BaseModel):
    new_password: Optional[str] = None     # omit to generate a temporary password


class AdminPasswordResetResponse(BaseModel):
    user_id: UUID
    generated: bool
    temporary_password: Optional[str] = None   # only returned when generated=True
```

## 2. `backend/src/serializers.py`
1. Add this function directly ABOVE `async def get_user_affiliations`:
```python
def auth_source_for(user: User) -> str:
    """'local' (ShiftBoard password), 'firebase' (Firebase only), or 'both'."""
    has_pw = bool(user.hashed_password)
    has_fb = bool(user.firebase_uid)
    if has_pw and has_fb:
        return "both"
    if has_fb:
        return "firebase"
    return "local"
```
2. In `build_user_response`, add these two arguments to the `UserResponse(...)` constructor, directly after `created_at=user.created_at,`:
```python
        auth_source=auth_source_for(user),
        has_password=bool(user.hashed_password),
```

## 3. `backend/src/routers/admin.py`
1. Imports:
   * add `import secrets` at the top of the file.
   * change `from src.schemas import VenueResponse, UserResponse, UserCreateAdmin, UserUpdateAdmin` → `from src.schemas import VenueResponse, UserResponse, UserCreateAdmin, UserUpdateAdmin, AdminPasswordReset, AdminPasswordResetResponse`
   * add `from src.serializers import auth_source_for`
2. In `_build_user_response`, add to the `UserResponse(...)` constructor, directly after `created_at=user.created_at,`:
```python
        auth_source=auth_source_for(user),
        has_password=bool(user.hashed_password),
```
3. Add this helper directly below `VALID_ROLES = (...)`:
```python
# No 0/O, 1/l/I so it's easy to read aloud or copy by hand
_TEMP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"


def _generate_temp_password(length: int = 12) -> str:
    return "".join(secrets.choice(_TEMP_ALPHABET) for _ in range(length))
```
4. Add this endpoint directly AFTER `update_admin_user` (before `delete_admin_user`):
```python
@router.post("/users/{user_id}/reset-password", response_model=AdminPasswordResetResponse)
async def admin_reset_password(
    user_id: UUID,
    body: AdminPasswordReset,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Phase 25.4: Reset a LOCAL password. Firebase-only accounts are refused (their password is in Firebase).
    If new_password is omitted, a 12-character temporary password is generated and returned once.
    """
    user = await db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if not user.hashed_password:
        raise HTTPException(
            status_code=400,
            detail="This person signs in with Firebase, so there's no ShiftBoard password to reset. "
                   "They can use 'Forgot password' on the login page, or you can reset it in the Firebase Console."
        )

    generated = body.new_password is None or body.new_password.strip() == ""
    new_password = _generate_temp_password() if generated else body.new_password
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")

    try:
        user.hashed_password = get_password_hash(new_password)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to reset password: {str(e)}")

    return AdminPasswordResetResponse(
        user_id=user.id,
        generated=generated,
        temporary_password=new_password if generated else None,
    )
```

---

## 4. Frontend: NEW FILE `frontend/src/components/ResetPasswordModal.jsx`
```jsx
import React, { useState } from 'react';
import { KeyRound, Copy, Eye, EyeOff, RefreshCw, Check } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';

const inputCls =
  'w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-indigo-500';

export default function ResetPasswordModal({ user, onClose, onDone }) {
  const [mode, setMode] = useState('generate'); // 'generate' | 'custom'
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { generated, temporary_password }
  const [copied, setCopied] = useState(false);

  const name = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email;

  const submit = async () => {
    setError('');
    if (mode === 'custom') {
      if (pw.length < 8) return setError('Password must be at least 8 characters.');
      if (pw !== pw2) return setError("The two passwords don't match.");
    }
    setSaving(true);
    try {
      const res = await api.post(`/admin/users/${user.id}/reset-password`, mode === 'custom' ? { new_password: pw } : {});
      setResult(res.data);
      onDone && onDone(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not reset the password.');
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.temporary_password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      setError('Copy failed. Select the password and copy it manually.');
    }
  };

  const footer = result ? (
    <button type="button" onClick={onClose} className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold">
      Done
    </button>
  ) : (
    <>
      <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700">
        Cancel
      </button>
      <button
        type="button"
        onClick={submit}
        disabled={saving}
        className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold disabled:opacity-50"
      >
        {saving ? 'Resetting…' : mode === 'generate' ? 'Generate password' : 'Set password'}
      </button>
    </>
  );

  return (
    <ModalShell
      title="Reset password"
      subtitle={`${name} · ${user.email}`}
      icon={<KeyRound className="w-5 h-5 text-indigo-400" />}
      onClose={onClose}
      maxWidth="max-w-md"
      footer={footer}
    >
      {error && <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">{error}</div>}

      {result ? (
        result.generated ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-300">New temporary password for <strong className="text-white">{name}</strong>:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-lg tracking-wider text-emerald-300 font-mono select-all">
                {result.temporary_password}
              </code>
              <button type="button" onClick={copy} className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200" title="Copy">
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-slate-400">
              This is the only time it's shown. Send it to them privately (text or in person). They can sign in with it right away.
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-300">
            Password updated for <strong className="text-white">{name}</strong>. Let them know the new password privately.
          </p>
        )
      ) : (
        <div className="space-y-3">
          <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${mode === 'generate' ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-700 bg-slate-800/40'}`}>
            <input type="radio" checked={mode === 'generate'} onChange={() => setMode('generate')} className="mt-1" />
            <span>
              <span className="block text-sm font-semibold text-white flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" /> Generate a temporary password
              </span>
              <span className="block text-xs text-slate-400">Easiest. We'll show it once so you can pass it on.</span>
            </span>
          </label>
          <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${mode === 'custom' ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-700 bg-slate-800/40'}`}>
            <input type="radio" checked={mode === 'custom'} onChange={() => setMode('custom')} className="mt-1" />
            <span>
              <span className="block text-sm font-semibold text-white">Set a specific password</span>
              <span className="block text-xs text-slate-400">At least 8 characters.</span>
            </span>
          </label>

          {mode === 'custom' && (
            <div className="space-y-2">
              <div className="relative">
                <input
                  type={show ? 'text' : 'password'}
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  placeholder="New password"
                  className={`${inputCls} pr-10`}
                  autoComplete="new-password"
                />
                <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white">
                  {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <input
                type={show ? 'text' : 'password'}
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                placeholder="Type it again"
                className={inputCls}
                autoComplete="new-password"
              />
            </div>
          )}

          {user.auth_source === 'both' && (
            <p className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl p-2.5">
              This person can also sign in with Firebase. That login isn't affected.
            </p>
          )}
        </div>
      )}
    </ModalShell>
  );
}
```

---

## 5. Frontend: `frontend/src/pages/AdminPanel.jsx` (targeted edits)

### A. Imports
* Add `KeyRound`, `Flame` to the existing `lucide-react` import list.
* Add `import ResetPasswordModal from '../components/ResetPasswordModal';`

### B. State (directly below `const [savingEdit, setSavingEdit] = useState(false);`)
```jsx
  const [resetUser, setResetUser] = useState(null);
  const [authFilter, setAuthFilter] = useState('ALL'); // 'ALL' | 'local' | 'firebase'
```

### C. Badge helper (directly above `const filteredUsers = ...`)
```jsx
  const AuthBadge = ({ source }) => {
    if (source === 'firebase') {
      return (
        <span title="Signs in with Firebase (Google, email link, etc.)" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30">
          <Flame className="w-3 h-3" /> Firebase
        </span>
      );
    }
    if (source === 'both') {
      return (
        <span title="Has a ShiftBoard password and is linked to Firebase" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-500/10 text-indigo-300 border border-indigo-500/30">
          <KeyRound className="w-3 h-3" /> Local <span className="text-slate-500">+</span> <Flame className="w-3 h-3 text-amber-300" /> Firebase
        </span>
      );
    }
    return (
      <span title="Signs in with a ShiftBoard password" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-slate-700/40 text-slate-300 border border-slate-600/50">
        <KeyRound className="w-3 h-3" /> Local
      </span>
    );
  };
```

### D. Filter logic
In `filteredUsers`, directly before `return matchesSearch && matchesRole;`, add:
```jsx
    const src = u.auth_source || 'local';
    const matchesAuth =
      authFilter === 'ALL' ||
      (authFilter === 'local' && (src === 'local' || src === 'both')) ||
      (authFilter === 'firebase' && (src === 'firebase' || src === 'both'));
```
and change that return line to `return matchesSearch && matchesRole && matchesAuth;`.

### E. Filter dropdown
Directly AFTER the closing `</select>` of the Role filter (the select bound to `userRoleFilter`), add:
```jsx
                <select
                  value={authFilter}
                  onChange={(e) => setAuthFilter(e.target.value)}
                  className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
                  title="Filter by sign-in method"
                >
                  <option value="ALL">All sign-in methods</option>
                  <option value="local">Local password</option>
                  <option value="firebase">Firebase</option>
                </select>
```

### F. Badge in the user row
In the users table name cell, replace:
```jsx
                              <div className="text-white font-bold">{u.first_name} {u.last_name}</div>
```
with:
```jsx
                              <div className="text-white font-bold flex flex-wrap items-center gap-1.5">
                                <span>{u.first_name} {u.last_name}</span>
                                <AuthBadge source={u.auth_source} />
                              </div>
```

### G. Reset button in Actions
In the Actions cell, directly AFTER the Edit (`Pencil`) `</button>` and BEFORE the `{currentUser?.id !== u.id && (` delete block, add:
```jsx
                              {u.has_password ? (
                                <button
                                  type="button"
                                  onClick={() => setResetUser(u)}
                                  className="p-2 text-slate-500 hover:text-indigo-300 rounded-lg hover:bg-indigo-500/10 transition"
                                  title="Reset password"
                                >
                                  <KeyRound className="w-4 h-4" />
                                </button>
                              ) : (
                                <span
                                  className="p-2 text-slate-700 cursor-not-allowed inline-flex"
                                  title="Firebase account: password is managed in Firebase ('Forgot password' on the login page)"
                                >
                                  <KeyRound className="w-4 h-4" />
                                </span>
                              )}
```

### H. Render the modal
Directly BEFORE the comment `{/* Modal: Confirm User Deletion */}`, add:
```jsx
      {resetUser && (
        <ResetPasswordModal
          user={resetUser}
          onClose={() => setResetUser(null)}
          onDone={() => setNotification({ type: 'success', message: `Password reset for ${resetUser.email}.` })}
        />
      )}
```

---

## 6. Rebuild & Verification
No schema change:
```bash
docker compose up -d --build backend frontend
```
Hard-refresh the browser afterwards. If the page goes blank with "Invalid hook call", run `docker compose exec frontend rm -rf node_modules/.vite && docker compose restart frontend` and hard-refresh.

Verify:
1. Admin Panel → Users: every row shows a badge. Demo/seeded and admin-created users show **Local**; users who signed up through Google or Firebase email show **Firebase**; an admin-created user who later signed in with Google shows **Local + Firebase**.
2. The "All sign-in methods / Local password / Firebase" filter narrows the list (Local + Firebase users appear under both).
3. Key icon on a Local user → **Generate password** → a 12-character password is shown once with Copy. Log out, sign in as that user with it → works; the old password no longer works.
4. Key icon → **Set a specific password** → mismatch or fewer than 8 characters shows an error; a valid one saves.
5. Firebase-only users show a greyed key icon with a tooltip; `POST /api/admin/users/{id}/reset-password` for them returns 400 with the Firebase explanation.
6. `GET /api/admin/users` contains `auth_source` and `has_password` but NOT `hashed_password` or `firebase_uid`.
7. As a worker, `POST /api/admin/users/{id}/reset-password` → 403.