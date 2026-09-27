import React, { useEffect, useState } from 'react';
import { Camera, Trash2, Save, Phone, HeartPulse, X, Plus, Check } from 'lucide-react';
import { WORKER_DEPARTMENTS } from '../../utils/departments';
import api from '../../api/client';
import { Avatar } from '../WorkerProfilePanel';
import { resizeImage, uploadFile } from '../../utils/files';

const inputCls = 'mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500';
const labelCls = 'block text-xs font-semibold text-slate-300';
const SUGGESTED = ['Bartender', 'Barback', 'Server', 'Host', 'Runner', 'Busser', 'Line cook', 'Prep cook', 'Dishwasher', 'Security', 'AV tech', 'Event staff'];
const BIO_MAX = 600;

/**
 * Phase 32: Photo, name, mobile (required for workers), bio, positions I work, emergency contact.
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
    if (!v || form.skills.some((s) => s.toLowerCase() === v.toLowerCase()) || form.skills.length >= 12) return;
    set('skills', [...form.skills, v]);
    setSkillDraft('');
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.put('/me/profile', form);
      onSaved(res.data, 'Profile saved.');
    } catch (err) {
      onError(err.response?.data?.detail || 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  };

  const pickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPhotoBusy(true);
    try {
      const small = await resizeImage(file);
      const res = await uploadFile('/me/avatar', small);
      onSaved(res.data, 'Photo updated.');
    } catch (err) {
      onError(err.response?.data?.detail || err.message || 'Could not upload that photo.');
    } finally {
      setPhotoBusy(false);
    }
  };

  const removePhoto = async () => {
    setPhotoBusy(true);
    try {
      const res = await api.delete('/me/avatar');
      onSaved(res.data, 'Photo removed.');
    } catch (err) {
      onError(err.response?.data?.detail || 'Could not remove your photo.');
    } finally {
      setPhotoBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Photo */}
      <section className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-2xl bg-slate-900 border border-slate-800">
        <Avatar person={{ ...profile, avatar_url: profile.avatar_url }} size="w-20 h-20 text-2xl" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">Profile photo</p>
          <p className="text-xs text-slate-400">A clear photo of your face helps the door staff and managers know who you are.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <label className={`px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer ${photoBusy ? 'opacity-50 pointer-events-none' : ''}`}>
              <Camera className="w-3.5 h-3.5" /> {profile.avatar_url ? 'Change photo' : 'Add a photo'}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={pickPhoto} />
            </label>
            {profile.avatar_url && (
              <button type="button" onClick={removePhoto} disabled={photoBusy}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">
                <Trash2 className="w-3.5 h-3.5" /> Remove
              </button>
            )}
            {photoBusy && <span className="text-xs text-slate-400 self-center">Uploading…</span>}
          </div>
        </div>
      </section>

      {/* About */}
      <section className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className={labelCls}>First name
            <input value={form.first_name} onChange={(e) => set('first_name', e.target.value)} className={inputCls} />
          </label>
          <label className={labelCls}>Last name
            <input value={form.last_name} onChange={(e) => set('last_name', e.target.value)} className={inputCls} />
          </label>
          <label className={labelCls}>
            <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" /> Mobile number {isWorker && <span className="text-rose-300">(required)</span>}</span>
            <input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="(212) 555-0199" inputMode="tel" className={inputCls} />
            <span className="block text-[11px] text-slate-500 font-normal mt-1">Managers can call you, and shift texts go here once you turn texts on in Notifications.</span>
          </label>
          <div className="text-xs text-slate-400 sm:pt-5">
            Signed in as <span className="text-slate-200">{profile.email}</span>
          </div>
        </div>
        <label className={labelCls}>About you
          <textarea value={form.bio} onChange={(e) => set('bio', e.target.value.slice(0, BIO_MAX))} rows={3}
            placeholder="e.g. Eight years behind busy cocktail bars. Comfortable running a service well on my own."
            className={inputCls} />
          <span className="block text-[11px] text-slate-500 font-normal text-right">{form.bio.length}/{BIO_MAX}</span>
        </label>
        {isWorker && (
          <div>
            <p className={labelCls}>Departments I work <span className="text-rose-300">(pick at least one)</span></p>
            <p className="text-[11px] text-slate-500">
              Shifts in these departments show up first and book as usual. Anything else needs a manager's OK.
              A position a manager gives you on their team also counts, at that venue.
            </p>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {WORKER_DEPARTMENTS.map((d) => {
                const on = form.departments.includes(d.key);
                return (
                  <button key={d.key} type="button" aria-pressed={on}
                    onClick={() => set('departments', on ? form.departments.filter((k) => k !== d.key) : [...form.departments, d.key])}
                    className={`p-2.5 rounded-xl border text-left transition ${on ? 'border-emerald-500/60 bg-emerald-500/10' : 'border-slate-700 bg-slate-950 hover:border-slate-500'}`}>
                    <span className="flex items-center gap-2">
                      <span className={`w-4 h-4 rounded border flex items-center justify-center ${on ? 'bg-emerald-500 border-emerald-500' : 'border-slate-600'}`}>
                        {on && <Check className="w-3 h-3 text-slate-950" />}
                      </span>
                      <span className="text-sm font-semibold text-white">{d.label}</span>
                    </span>
                    <span className="block text-[11px] text-slate-400 mt-0.5 ml-6">{d.examples}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {isWorker && (
          <div>
            <p className={labelCls}>Specific roles <span className="text-slate-500 font-normal">(optional, shown to managers)</span></p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {form.skills.map((s) => (
                <span key={s} className="px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-xs font-semibold inline-flex items-center gap-1">
                  {s}
                  <button type="button" aria-label={`Remove ${s}`} onClick={() => set('skills', form.skills.filter((x) => x !== s))} className="hover:text-white">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <input value={skillDraft} onChange={(e) => setSkillDraft(e.target.value)} placeholder="Add a position"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addSkill(skillDraft);
                  }
                }}
                className="px-2 py-1 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white w-36 focus:outline-none focus:border-emerald-500" />
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {SUGGESTED.filter((s) => !form.skills.some((x) => x.toLowerCase() === s.toLowerCase())).map((s) => (
                <button key={s} type="button" onClick={() => addSkill(s)}
                  className="px-2 py-0.5 rounded-md border border-slate-700 text-[11px] text-slate-400 hover:text-white hover:border-slate-500 inline-flex items-center gap-0.5">
                  <Plus className="w-3 h-3" /> {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Emergency contact */}
      {isWorker && (
        <section className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <div>
            <p className="text-sm font-semibold text-white inline-flex items-center gap-1.5"><HeartPulse className="w-4 h-4 text-rose-300" /> Emergency contact</p>
            <p className="text-xs text-slate-400">Only managers of venues you're booked at or on the team with can see this.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className={labelCls}>Name
              <input value={form.emergency_contact_name} onChange={(e) => set('emergency_contact_name', e.target.value)} placeholder="e.g. Pat Lee (partner)" className={inputCls} />
            </label>
            <label className={labelCls}>Phone
              <input value={form.emergency_contact_phone} onChange={(e) => set('emergency_contact_phone', e.target.value)} inputMode="tel" className={inputCls} />
            </label>
          </div>
        </section>
      )}

      <div className="flex justify-end">
        <button type="button" onClick={save} disabled={saving}
          className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
          <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </div>
  );
}
