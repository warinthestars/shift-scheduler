# Phase 32.2.1: Profile save errors show next to the Save button

**Why:** On Profile → About me, the departments, specific roles, name, mobile number and emergency contact are all saved by **one** request. If any field is rejected (usually a missing or malformed **mobile number**, or a bad emergency-contact phone), **nothing** is saved. The reason did appear, but in the banner at the **top** of the page, while the Save button is at the **bottom**. It looked like departments and roles just didn't save. Ticking a department card also looks like it saves instantly, but it doesn't until you click Save.

**What changes (one file, frontend only, no schema change, no backend change):**
1. The Save row now shows the result **right beside the button**:
   * red with the server's reason (e.g. "A mobile number is required so venues can reach you and texts can work.")
   * or green "Saved."
2. While the form has unsaved changes, the Save row **pins to the bottom of the screen** ("You have unsaved changes." + Save profile), on desktop and phone.
3. The page banner at the top still shows too (unchanged).

## 0. Rules
* Edit **only** `frontend/src/components/profile/AboutSection.jsx`. Don't touch anything else, including auth files, `main.py`, `AuthContext.jsx`, `api/client.js` or `vite.config.js`.
* No new packages.
* Each edit is an exact *Find* → *Replace with*. Every *Find* appears **exactly once**; apply them in order. Keep the file's line endings.
* These blocks were generated from your current 32.2 file (verified to match). They were tested in a real browser:
  - a worker with no mobile number gets a 400, and the reason shows beside Save
  - after they add the number, departments + roles + phone save and survive a reload
  - the pinned bar was rendered on desktop and phone

  Don't "improve" them.

---

## 1. `frontend/src/components/profile/AboutSection.jsx` (EDITS)

**Edit 1.** Find:
```jsx
import React, { useEffect, useState } from 'react';
import { Camera, Trash2, Save, Phone, HeartPulse, X, Plus, Check } from 'lucide-react';
import { WORKER_DEPARTMENTS } from '../../utils/departments';
import api from '../../api/client';
```
Replace with:
```jsx
import React, { useEffect, useState } from 'react';
import { Camera, Trash2, Save, Phone, HeartPulse, X, Plus, Check, AlertCircle } from 'lucide-react';
import { WORKER_DEPARTMENTS } from '../../utils/departments';
import api from '../../api/client';
```

**Edit 2.** Find:
```jsx
 * Props: profile (MyProfile), onSaved(profile, message), onError(message)
 */
export default function AboutSection({ profile, onSaved, onError }) {
  const isWorker = profile.role === 'worker';
  const [form, setForm] = useState(null);
  const [skillDraft, setSkillDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);

  useEffect(() => {
    setForm({
      first_name: profile.first_name || '',
      last_name: profile.last_name || '',
      phone: profile.phone || '',
      bio: profile.bio || '',
      skills: profile.skills || [],
      departments: profile.departments || [],        // Phase 32.2
      emergency_contact_name: profile.emergency_contact_name || '',
      emergency_contact_phone: profile.emergency_contact_phone || '',
    });
  }, [profile]);

  if (!form) return null;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const addSkill = (value) => {
    const v = (value || '').trim();
```
Replace with:
```jsx
 * Props: profile (MyProfile), onSaved(profile, message), onError(message)
 */
// Phase 32.2.1: the form's starting values (also used to tell whether there are unsaved changes)
const formFrom = (profile) => ({
  first_name: profile.first_name || '',
  last_name: profile.last_name || '',
  phone: profile.phone || '',
  bio: profile.bio || '',
  skills: profile.skills || [],
  departments: profile.departments || [],        // Phase 32.2
  emergency_contact_name: profile.emergency_contact_name || '',
  emergency_contact_phone: profile.emergency_contact_phone || '',
});

export default function AboutSection({ profile, onSaved, onError }) {
  const isWorker = profile.role === 'worker';
  const [form, setForm] = useState(null);
  const [skillDraft, setSkillDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);   // Phase 32.2.1: { type: 'success' | 'error', text } shown next to Save

  useEffect(() => {
    setForm(formFrom(profile));
  }, [profile]);

  if (!form) return null;
  const dirty = JSON.stringify(form) !== JSON.stringify(formFrom(profile));   // Phase 32.2.1
  const set = (k, v) => { setSaveStatus(null); setForm((f) => ({ ...f, [k]: v })); };
  const addSkill = (value) => {
    const v = (value || '').trim();
```

**Edit 3.** Find:
```jsx
  const save = async () => {
    setSaving(true);
    try {
      const res = await api.put('/me/profile', form);
      onSaved(res.data, 'Profile saved.');
    } catch (err) {
      onError(err.response?.data?.detail || 'Could not save your profile.');
    } finally {
      setSaving(false);
```
Replace with:
```jsx
  const save = async () => {
    setSaving(true);
    setSaveStatus(null);
    try {
      const res = await api.put('/me/profile', form);
      onSaved(res.data, 'Profile saved.');
      setSaveStatus({ type: 'success', text: 'Saved.' });
    } catch (err) {
      const detail = err.response?.data?.detail;
      const text = typeof detail === 'string' ? detail : 'Could not save your profile.';
      onError(text);
      setSaveStatus({ type: 'error', text });
    } finally {
      setSaving(false);
```

**Edit 4.** Find:
```jsx
      )}

      <div className="flex justify-end">
        <button type="button" onClick={save} disabled={saving}
          className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
          <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save profile'}
        </button>
```
Replace with:
```jsx
      )}

      {/* Phase 32.2.1: pinned to the bottom of the screen while there are unsaved changes; save errors show right here */}
      <div className={`${dirty || saveStatus?.type === 'error' ? 'sticky bottom-3 z-20 p-3 rounded-2xl bg-slate-900/95 border border-slate-700 shadow-xl backdrop-blur' : ''} flex flex-col sm:flex-row sm:items-center sm:justify-end gap-3`}>
        {saveStatus?.type === 'error' ? (
          <p role="alert" className="flex-1 text-sm text-rose-300 inline-flex items-start gap-1.5">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {saveStatus.text}
          </p>
        ) : dirty ? (
          <p className="flex-1 text-sm text-amber-300">You have unsaved changes.</p>
        ) : saveStatus?.type === 'success' ? (
          <p className="text-sm text-emerald-300 inline-flex items-center gap-1.5"><Check className="w-4 h-4" /> {saveStatus.text}</p>
        ) : null}
        <button type="button" onClick={save} disabled={saving}
          className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-50">
          <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save profile'}
        </button>
```

---

## 2. Rebuild & verification
No schema change, so **no `docker compose down -v`** is needed. Just:
```bash
docker compose up -d --build frontend
```
(If the page is blank or shows "Invalid hook call": `docker compose exec frontend rm -rf node_modules/.vite && docker compose restart frontend`, then hard-refresh.)

### Checklist
1. As a worker, open Profile → About me and tick a department. A bar pins to the bottom: "You have unsaved changes." + **Save profile**.
2. Clear the mobile number and click Save. The red reason appears **next to the button**, and nothing is saved.
3. Put the number back and click Save. It shows "Saved.", and the bar un-pins. Reload the page: the departments and specific roles are still there.