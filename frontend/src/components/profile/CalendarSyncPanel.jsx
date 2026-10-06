import React, { useRef, useState } from 'react';
import {
  CalendarPlus, CalendarCheck, Copy, Check, RefreshCw, PowerOff, ExternalLink, Smartphone, Info, AlertTriangle, Lock,
  Briefcase, Building2, Network, Shield, ClipboardCheck, ChevronDown,
} from 'lucide-react';
import api from '../../api/client';
import ConfirmDialog from '../ConfirmDialog';

const KIND = {
  worker: { label: 'Worker calendar', icon: Briefcase, tone: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' },
  manager: { label: 'Manager calendar', icon: Building2, tone: 'text-teal-300 bg-teal-500/10 border-teal-500/30' },
  venue: { label: 'Venue calendar', icon: Building2, tone: 'text-sky-300 bg-sky-500/10 border-sky-500/30' },
  organization: { label: 'Organization calendar', icon: Network, tone: 'text-violet-300 bg-violet-500/10 border-violet-500/30' },
  admin: { label: 'Admin calendar', icon: Shield, tone: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/30' },
};
const OPTION_TEXT = {
  include_requested: ['Shifts I asked for', '[REQUESTED]'],
  include_waitlist: ['Shifts I am waitlisted for', '[WAITLIST]'],
  include_offers: ["Offers I haven't answered", '[OFFERED]'],
  include_time_off: ['My time off', null],
  include_drafts: ['Draft events', '[DRAFT]'],
};
const TAGS = [
  ['[Confirmed]', 'You are booked.', 'text-emerald-200 border-emerald-500/40 bg-emerald-500/10'],
  ['[REQUESTED]', 'You asked; the venue has not answered.', 'text-amber-200 border-amber-500/40 bg-amber-500/10'],
  ['[WAITLIST]', 'You are in line for a full position.', 'text-slate-200 border-slate-600 bg-slate-800'],
  ['[OFFERED]', 'Offered to you; answer in ShiftBoard.', 'text-sky-200 border-sky-500/40 bg-sky-500/10'],
];
const MANY_VENUES = 4;   // more venue calendars than this (admins) -> a picker instead of a long list

function agoText(value) {
  if (!value) return null;
  const mins = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

const btn = 'px-3 py-2 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 transition';
const addBtn = `${btn} bg-slate-800 border border-slate-700 text-slate-100 hover:bg-slate-700`;

function CalendarCard({ cal, busy, onTurnOn, onOption, onAskReset, onAskOff }) {
  const [copied, setCopied] = useState('');   // '' | 'yes' | 'manual' (couldn't copy: the link is selected instead)
  const [help, setHelp] = useState(false);
  const input = useRef(null);
  const meta = cal.shift_lead ? { ...KIND.venue, label: 'Venue calendar · shift lead', icon: ClipboardCheck } : (KIND[cal.kind] || KIND.venue);
  const Icon = meta.icon;
  const on = !!cal.id;

  const copy = async () => {
    let done = false;
    try {
      await navigator.clipboard.writeText(cal.url);
      done = true;
    } catch (err) {
      input.current?.select();
      try { done = document.execCommand('copy'); } catch (e) { done = false; }
    }
    if (!done) input.current?.select();        // leave it selected so they can copy it themselves
    setCopied(done ? 'yes' : 'manual');
    setTimeout(() => setCopied(''), 4000);
  };

  // They turned this calendar on, then lost access to it (the link now shows an empty calendar).
  if (cal.available === false) {
    return (
      <div className="p-4 rounded-2xl border bg-slate-900 border-amber-500/30" data-calendar={cal.scope_key}>
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl border flex items-center justify-center flex-shrink-0 text-amber-300 bg-amber-500/10 border-amber-500/30">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-bold text-white break-words">{cal.name}</h3>
                <span className="px-2 py-0.5 rounded-full border text-[10px] font-bold text-amber-300 bg-amber-500/10 border-amber-500/30">No longer available</span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">{cal.description}</p>
            </div>
          </div>
          <button type="button" disabled={busy} onClick={() => onAskOff(cal)}
            className={`${btn} bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 disabled:opacity-50 flex-shrink-0`}>
            <PowerOff className="w-3.5 h-3.5" /> Turn off
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`p-4 rounded-2xl border ${on ? 'bg-slate-900 border-emerald-700/50' : 'bg-slate-900 border-slate-800'}`} data-calendar={cal.scope_key}>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className={`w-10 h-10 rounded-xl border flex items-center justify-center flex-shrink-0 ${meta.tone}`}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold text-white break-words">{cal.name}</h3>
              <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${meta.tone}`}>{meta.label}</span>
              {on && <span className="px-2 py-0.5 rounded-full bg-emerald-500 text-slate-950 text-[10px] font-black">ON</span>}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">{cal.description}</p>
          </div>
        </div>
        {!on && (
          <button type="button" disabled={busy} onClick={() => onTurnOn(cal)}
            className={`${btn} bg-emerald-500 hover:bg-emerald-400 text-slate-950 disabled:opacity-50 flex-shrink-0`}>
            <CalendarPlus className="w-4 h-4" /> Turn on
          </button>
        )}
      </div>

      {on && (
        <div className="mt-4 space-y-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Add it to your calendar</p>
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
              <a href={cal.google_url} target="_blank" rel="noopener noreferrer" className={addBtn}><ExternalLink className="w-3.5 h-3.5" /> Google Calendar</a>
              <a href={cal.webcal_url} className={addBtn}><Smartphone className="w-3.5 h-3.5" /> Apple / iPhone</a>
              <a href={cal.outlook_url} target="_blank" rel="noopener noreferrer" className={addBtn}><ExternalLink className="w-3.5 h-3.5" /> Outlook.com</a>
              <a href={cal.office_url} target="_blank" rel="noopener noreferrer" className={addBtn}><ExternalLink className="w-3.5 h-3.5" /> Microsoft 365</a>
            </div>
          </div>

          <div>
            <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500" htmlFor={`cal-url-${cal.id}`}>Or copy the private link (any calendar app)</label>
            <div className="mt-1.5 flex gap-2">
              <input id={`cal-url-${cal.id}`} ref={input} readOnly value={cal.url} onFocus={(e) => e.target.select()}
                className="flex-1 min-w-0 px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-300 font-mono" />
              <button type="button" onClick={copy} className={`${btn} ${copied === 'yes' ? 'bg-emerald-600 text-white' : 'bg-slate-800 border border-slate-700 text-slate-100 hover:bg-slate-700'} flex-shrink-0`}>
                {copied === 'yes' ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
              </button>
            </div>
            <p className="sr-only" role="status" aria-live="polite">{copied === 'yes' ? 'Link copied.' : ''}</p>
            {copied === 'manual' && (
              <p className="mt-1.5 text-[11px] text-amber-200" role="status">Your browser didn't allow copying. The link is selected: copy it with your keyboard or the menu.</p>
            )}
            <button type="button" onClick={() => setHelp((v) => !v)} aria-expanded={help}
              className="mt-1.5 text-[11px] text-slate-400 hover:text-white inline-flex items-center gap-1">
              <ChevronDown className={`w-3 h-3 transition ${help ? 'rotate-180' : ''}`} /> Where do I paste it?
            </button>
            {help && (
              <ul className="mt-1.5 text-[11px] text-slate-400 space-y-1 list-disc pl-4">
                <li><b className="text-slate-300">Google Calendar</b> (on a computer): Other calendars → + → From URL.</li>
                <li><b className="text-slate-300">iPhone / iPad</b>: Settings → Apps → Calendar → Calendar Accounts → Add Account → Other → Add Subscribed Calendar.</li>
                <li><b className="text-slate-300">Mac Calendar</b>: File → New Calendar Subscription.</li>
                <li><b className="text-slate-300">Outlook</b>: Add calendar → Subscribe from web.</li>
              </ul>
            )}
          </div>

          {cal.options.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">
                {cal.kind === 'worker' ? 'Also show (confirmed shifts are always shown)' : 'Also show'}
              </p>
              <div className="grid sm:grid-cols-2 gap-1.5">
                {cal.options.map((name) => (
                  <label key={name} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-950/60 border border-slate-800 text-xs text-slate-200 cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 accent-emerald-500" checked={!!cal[name]}
                      onChange={(e) => onOption(cal, name, e.target.checked)} />
                    <span>{OPTION_TEXT[name]?.[0] || name}</span>
                    {OPTION_TEXT[name]?.[1] && <span className="ml-auto font-mono text-[10px] text-slate-500">{OPTION_TEXT[name][1]}</span>}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-3 border-t border-slate-800">
            <p className="text-[11px] text-slate-400 inline-flex items-center gap-1.5">
              <CalendarCheck className="w-3.5 h-3.5 text-slate-500" />
              {cal.last_fetched_at ? `A calendar app last read this ${agoText(cal.last_fetched_at)}.` : "No calendar app has read this yet. Add it with one of the buttons above."}
            </p>
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => onAskReset(cal)} className={`${btn} bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-50`}>
                <RefreshCw className="w-3.5 h-3.5" /> Reset link
              </button>
              <button type="button" disabled={busy} onClick={() => onAskOff(cal)} className={`${btn} bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 disabled:opacity-50`}>
                <PowerOff className="w-3.5 h-3.5" /> Turn off
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Phase 36.1: Profile -> Calendar sync. Every account type.
 * Each calendar the person may have (the server decides, by role) can be turned on. That makes a private link
 * (an iCalendar feed) that Google, Apple, Outlook or any calendar app subscribes to. One-way, and never any pay.
 * Props: data ({ enabled, public_address_ok, calendars }), onData(next), onSaved(message), onError(message)
 */
export default function CalendarSyncPanel({ data, onData, onSaved, onError }) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [pick, setPick] = useState('');
  const calendars = data?.calendars || [];

  const replace = (next) => onData({ ...data, calendars: calendars.map((c) => (c.scope_key === next.scope_key ? next : c)) });
  // quiet = the confirm dialog shows the error itself
  const run = async (fn, okText, quiet = false) => {
    setBusy(true);
    try {
      const next = await fn();
      if (next) replace(next);
      if (okText) onSaved?.(okText);
    } catch (err) {
      if (!quiet) onError?.(err.response?.data?.detail || 'Could not save that. Try again.');
      throw err;
    } finally {
      setBusy(false);
    }
  };
  const remove = (cal) => onData({ ...data, calendars: calendars.filter((c) => c.scope_key !== cal.scope_key) });

  const turnOn = (cal) => run(async () => (await api.post('/me/calendar-links', {
    kind: cal.kind, venue_id: cal.venue_id, organization_id: cal.organization_id,
  })).data, `${cal.name} is on. Add it to your calendar with one of the buttons.`).catch(() => {});
  const setOption = (cal, name, value) => {
    replace({ ...cal, [name]: value });          // tick the box right away; put it back if the save fails
    return run(async () => (await api.put(`/me/calendar-links/${cal.id}`, { [name]: value })).data,
      'Saved. Your calendar app picks it up the next time it checks.').catch(() => replace(cal));
  };
  const askReset = (cal) => setConfirm({
    title: 'Reset this link?',
    message: `"${cal.name}" gets a new private link. The old one stops working right away, so the calendar will stop updating wherever you added it until you add the new link. Do this if the link was shared by mistake.`,
    confirmLabel: 'Reset link',
    danger: true,
    onConfirm: () => run(async () => (await api.post(`/me/calendar-links/${cal.id}/reset`)).data, 'New link made. Add it to your calendar again.', true),
  });
  const askOff = (cal) => setConfirm({
    title: 'Turn this calendar off?',
    message: `"${cal.name}" stops updating everywhere you added it. Remove it from your calendar app too, or the old entries may stay there.`,
    confirmLabel: 'Turn off',
    danger: true,
    onConfirm: () => run(async () => {
      await api.delete(`/me/calendar-links/${cal.id}`);
      if (cal.available === false) {
        remove(cal);          // it can't be turned on again, so it leaves the list
        return null;
      }
      return {
        ...cal, id: null, url: null, webcal_url: null, google_url: null, outlook_url: null, office_url: null, last_fetched_at: null,
      };
    }, `${cal.name} is off.`, true),
  });

  if (!data) {
    return <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 text-center text-sm text-slate-500">Loading your calendars…</div>;
  }
  if (!data.enabled) {
    return (
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 text-center text-sm text-slate-400">
        Calendar sync is turned off on this site.
      </div>
    );
  }

  const isVenueOff = (c) => c.kind === 'venue' && !c.id && c.available !== false;
  const offVenues = calendars.filter(isVenueOff);
  const usePicker = offVenues.length > MANY_VENUES;
  const shown = usePicker ? calendars.filter((c) => !isVenueOff(c)) : calendars;
  const hasWorker = calendars.some((c) => c.kind === 'worker');
  const picked = offVenues.find((c) => c.scope_key === pick);

  return (
    <div className="space-y-4">
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
            <CalendarPlus className="w-5 h-5 text-emerald-300" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Calendar sync</h2>
            <p className="text-sm text-slate-300">
              See your {hasWorker ? 'shifts' : 'events'} in Google Calendar, Apple Calendar, Outlook or any other calendar app. Turn a calendar on, add it once, and it keeps itself up to date.
            </p>
          </div>
        </div>
        {hasWorker && (
          <div className="grid sm:grid-cols-2 gap-1.5">
            {TAGS.map(([tag, text, tone]) => (
              <div key={tag} className="flex items-center gap-2 text-xs text-slate-300">
                <span className={`px-2 py-0.5 rounded-md border font-mono text-[11px] font-bold ${tone}`}>{tag}</span> {text}
              </div>
            ))}
          </div>
        )}
        <ul className="text-xs text-slate-400 space-y-1.5">
          <li className="flex items-start gap-2"><Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-slate-500" />
            It works one way. Changing or deleting an entry in your calendar app does not change anything in ShiftBoard.</li>
          <li className="flex items-start gap-2"><Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-slate-500" />
            Your calendar app decides how often it checks: usually every few hours, and Google can take up to a day. For last-minute changes rely on ShiftBoard notifications.</li>
          <li className="flex items-start gap-2"><Lock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-slate-500" />
            Pay is never put in a calendar. Each link is private: anyone who has it can see that calendar, so don't share it. If it gets out, use Reset link.</li>
        </ul>
      </div>

      {!data.public_address_ok && (
        <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/30 text-xs text-amber-100 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-400" />
          <span>This site is on a local or non-secure address. Google and Outlook read calendars from their own servers and can't reach it, so the buttons only work once the site has a public https address.</span>
        </div>
      )}

      {calendars.length === 0 && (
        <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 text-center text-sm text-slate-400">
          There's no calendar for your account yet. Once you manage a venue, its calendar shows up here.
        </div>
      )}

      {shown.map((cal) => (
        <CalendarCard key={cal.scope_key} cal={cal} busy={busy} onTurnOn={turnOn} onOption={setOption} onAskReset={askReset} onAskOff={askOff} />
      ))}

      {usePicker && (
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <label htmlFor="calendar-venue-pick" className="text-sm font-bold text-white">A calendar for one venue</label>
          <p className="text-xs text-slate-400 mt-0.5">Every event at that venue, with who is booked.</p>
          <div className="mt-2 flex flex-col sm:flex-row gap-2">
            <select id="calendar-venue-pick" value={pick} onChange={(e) => setPick(e.target.value)}
              className="flex-1 min-w-0 px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500">
              <option value="">Pick a venue…</option>
              {offVenues.map((c) => <option key={c.scope_key} value={c.scope_key}>{c.name}</option>)}
            </select>
            <button type="button" disabled={busy || !picked} onClick={() => { turnOn(picked); setPick(''); }}
              className={`${btn} bg-emerald-500 hover:bg-emerald-400 text-slate-950 disabled:opacity-50`}>
              <CalendarPlus className="w-4 h-4" /> Turn on
            </button>
          </div>
        </div>
      )}

      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}
