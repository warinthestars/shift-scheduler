import React, { useEffect, useState } from 'react';
import { Bell, Mail, MessageSquare, Moon, Send, Info, Eye } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import { TIMEZONE_OPTIONS } from '../utils/venueTime';

const inputCls =
  'w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500';
const cardCls = 'p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3';

const HOURS = Array.from({ length: 24 }, (_, h) => ({
  value: h,
  label: new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' }),
}));

function Toggle({ checked, onChange, title, body, disabled = false }) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={!!checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 w-4 h-4 rounded bg-slate-800 border-slate-700 text-emerald-500"
      />
      <span>
        <span className="block text-sm font-semibold text-white">{title}</span>
        {body && <span className="block text-xs text-slate-400">{body}</span>}
      </span>
    </label>
  );
}

/**
 * Phase 28: What gets sent where. Everything always shows in the bell; these settings control
 * email and text messages, reminders, new-shift alerts and quiet hours.
 */
export default function NotificationSettingsModal({ onClose, onSent }) {
  const [prefs, setPrefs] = useState(null);
  const [phone, setPhone] = useState('');
  const [quietOn, setQuietOn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState(null); // { type, text }

  useEffect(() => {
    api
      .get('/notifications/preferences')
      .then((res) => {
        setPrefs(res.data);
        setPhone(res.data.phone || '');
        setQuietOn(res.data.quiet_start !== null && res.data.quiet_start !== undefined);
      })
      .catch((err) => setMsg({ type: 'error', text: err.response?.data?.detail || 'Could not load your settings.' }));
  }, []);

  const set = (key, value) => setPrefs((p) => ({ ...p, [key]: value }));

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const body = {
        email_enabled: prefs.email_enabled,
        sms_enabled: prefs.sms_enabled,
        reminders_enabled: prefs.reminders_enabled,
        new_shift_alerts: prefs.new_shift_alerts,
        manager_alerts_email: prefs.manager_alerts_email,
        timezone: prefs.timezone,
        phone,
        discoverable: prefs.discoverable || 'private',   // Phase 29.1
      };
      if (quietOn) {
        body.quiet_start = Number(prefs.quiet_start ?? 22);
        body.quiet_end = Number(prefs.quiet_end ?? 7);
      } else {
        body.clear_quiet_hours = true;
      }
      const res = await api.put('/notifications/preferences', body);
      setPrefs(res.data);
      setMsg({ type: 'success', text: 'Saved.' });
    } catch (err) {
      setMsg({ type: 'error', text: err.response?.data?.detail || 'Could not save.' });
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setMsg(null);
    try {
      await api.post('/notifications/test');
      setMsg({ type: 'success', text: 'Test sent. Check the bell now; email / text arrive within a minute.' });
      if (onSent) onSent();
    } catch (err) {
      setMsg({ type: 'error', text: err.response?.data?.detail || 'Could not send a test.' });
    } finally {
      setTesting(false);
    }
  };

  const footer = (
    <>
      <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700 mr-auto">
        Close
      </button>
      <button type="button" onClick={sendTest} disabled={testing || !prefs}
        className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm text-slate-200 inline-flex items-center gap-1.5 disabled:opacity-50">
        <Send className="w-4 h-4" /> {testing ? 'Sending…' : 'Send me a test'}
      </button>
      <button type="button" onClick={save} disabled={saving || !prefs}
        className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold disabled:opacity-50">
        {saving ? 'Saving…' : 'Save'}
      </button>
    </>
  );

  return (
    <ModalShell
      title="Notifications & privacy"
      subtitle="Everything always shows in the bell. Choose what also reaches your email and phone, and who can find you."
      icon={<Bell className="w-5 h-5 text-emerald-400" />}
      onClose={onClose}
      maxWidth="max-w-3xl"
      footer={footer}
    >
      {msg && (
        <div className={`mb-4 p-3 rounded-xl text-sm border ${msg.type === 'success' ? 'bg-emerald-950/60 border-emerald-700 text-emerald-200' : 'bg-rose-950/60 border-rose-700 text-rose-200'}`}>
          {msg.text}
        </div>
      )}
      {!prefs ? (
        <p className="text-sm text-slate-500 py-8 text-center">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-4">
            <div className={cardCls}>
              <div className="flex items-center gap-2 text-sm font-semibold text-white"><Mail className="w-4 h-4 text-emerald-400" /> Email</div>
              <Toggle
                checked={prefs.email_enabled}
                onChange={(v) => set('email_enabled', v)}
                title={`Email me at ${prefs.email || 'my account email'}`}
                body="Bookings, changes, cancellations and reminders."
              />
              {!prefs.email_available && (
                <p className="text-[11px] text-amber-300 flex items-start gap-1">
                  <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> Email sending isn't set up on this server yet, so emails are only logged.
                </p>
              )}
            </div>

            <div className={cardCls}>
              <div className="flex items-center gap-2 text-sm font-semibold text-white"><MessageSquare className="w-4 h-4 text-emerald-400" /> Text messages</div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Mobile number</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="(555) 555-0100" />
              </div>
              <Toggle
                checked={prefs.sms_enabled}
                onChange={(v) => set('sms_enabled', v)}
                disabled={!prefs.sms_available}
                title="Text me when it's urgent"
                body="Cancellations, removals, last-minute changes, 2-hour reminders and missed clock-ins. Nothing else."
              />
              {!prefs.sms_available && (
                <p className="text-[11px] text-slate-500">Texts aren't set up on this server yet.</p>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className={cardCls}>
              <div className="flex items-center gap-2 text-sm font-semibold text-white"><Bell className="w-4 h-4 text-emerald-400" /> What to send</div>
              <Toggle
                checked={prefs.reminders_enabled}
                onChange={(v) => set('reminders_enabled', v)}
                title="Shift reminders"
                body="The day before and 2 hours before each shift you're booked on."
              />
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">New shifts at venues I've worked</label>
                <select value={prefs.new_shift_alerts} onChange={(e) => set('new_shift_alerts', e.target.value)} className={inputCls}>
                  <option value="daily">Once a day (morning email)</option>
                  <option value="instant">Right away</option>
                  <option value="off">Don't tell me</option>
                </select>
              </div>
              {prefs.is_manager && (
                <Toggle
                  checked={prefs.manager_alerts_email}
                  onChange={(v) => set('manager_alerts_email', v)}
                  title="Manager alerts by email"
                  body="New requests, hand-offs waiting, people who haven't clocked in or read an update."
                />
              )}
            </div>

            <div className={cardCls}>
              <div className="flex items-center gap-2 text-sm font-semibold text-white"><Moon className="w-4 h-4 text-emerald-400" /> Quiet hours</div>
              <Toggle
                checked={quietOn}
                onChange={setQuietOn}
                title="Hold non-urgent email and texts overnight"
                body="Urgent ones (cancellations, last-minute changes) still come through."
              />
              {quietOn && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">From</label>
                    <select value={prefs.quiet_start ?? 22} onChange={(e) => set('quiet_start', Number(e.target.value))} className={inputCls}>
                      {HOURS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Until</label>
                    <select value={prefs.quiet_end ?? 7} onChange={(e) => set('quiet_end', Number(e.target.value))} className={inputCls}>
                      {HOURS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
                    </select>
                  </div>
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">My timezone</label>
                <select value={prefs.timezone} onChange={(e) => set('timezone', e.target.value)} className={inputCls}>
                  {TIMEZONE_OPTIONS.map((tz) => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                </select>
              </div>
            </div>

            {/* Phase 29.1: who can find me */}
            <div className={cardCls}>
              <div className="flex items-center gap-2 text-sm font-semibold text-white"><Eye className="w-4 h-4 text-emerald-400" /> Who can find me</div>
              <p className="text-xs text-slate-400">
                Lets venue managers find you by name or email to add you to their team. Venues you've worked for or
                requested shifts at can always see you, and anyone can add you if they type your exact email.
              </p>
              {[
                ['private', 'Only venues I work with', 'Nobody else can look you up by name.'],
                ['venues', 'Any venue on ShiftBoard', 'Managers can find you by name or email. Your email is partly hidden until you work together.'],
                ['everyone', 'Anyone on ShiftBoard', 'Venues, plus future features like finding coworkers.'],
              ].map(([value, title, body]) => (
                <label key={value} className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="discoverable"
                    checked={(prefs.discoverable || 'private') === value}
                    onChange={() => set('discoverable', value)}
                    className="mt-1 w-4 h-4 bg-slate-800 border-slate-700 text-emerald-500"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-white">{title}</span>
                    <span className="block text-xs text-slate-400">{body}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
