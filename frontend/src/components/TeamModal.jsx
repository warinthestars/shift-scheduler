import React, { useEffect, useMemo, useState } from 'react';
import {
  Users, UserPlus, Link2, Copy, Download, RefreshCw, Mail, Phone, Upload, ShieldCheck, Trash2, Ban,
  RotateCcw, Pencil, Search, Check, X, KeyRound, Send, UserCog, ChevronDown, ChevronRight, AlertTriangle, Plus,
} from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import RatingBadge from './RatingBadge';
import ReliabilityBadge from './ReliabilityBadge';
import WorkerProfilePanel, { Avatar } from './WorkerProfilePanel';
import { fmtShortDate } from '../utils/venueTime';

const inputCls =
  'w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500';
const cardCls = 'p-4 rounded-xl bg-slate-950 border border-slate-800';
const btnGhost =
  'px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40';
const btnPrimary =
  'px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-40';

const STATUS_CHIP = {
  active: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  removed: 'bg-slate-700/40 text-slate-300 border-slate-600/40',
  blocked: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
};
const SOURCE_LABEL = {
  manager: 'Added by a manager',
  invite: 'Joined by invite',
  import: 'Imported',
  admin: 'Added by an admin',
  worked: 'Worked here',
};
const INVITE_CHIP = {
  pending: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30',
  accepted: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  expired: 'bg-slate-700/40 text-slate-300 border-slate-600/40',
  revoked: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
};

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    return false;
  }
}

/** Minimal CSV parser (quotes, commas, CRLF). Returns an array of rows (arrays of strings). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const HEADER_KEYS = {
  first_name: ['first_name', 'first name', 'firstname', 'first', 'given name'],
  last_name: ['last_name', 'last name', 'lastname', 'last', 'surname', 'family name'],
  name: ['name', 'full name', 'fullname'],
  email: ['email', 'e-mail', 'email address'],
  phone: ['phone', 'mobile', 'cell', 'phone number', 'mobile number'],
  positions: ['positions', 'position', 'roles', 'role'],
};

/** CSV text -> invite rows. The first row must be a header (name, email, phone, positions ...). */
export function csvToInviteRows(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { rows: [], error: 'The file needs a header row and at least one person.' };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = {};
  Object.entries(HEADER_KEYS).forEach(([key, names]) => {
    const idx = header.findIndex((h) => names.includes(h));
    if (idx >= 0) col[key] = idx;
  });
  if (col.email === undefined && col.phone === undefined) {
    return { rows: [], error: 'Add an "email" or "phone" column (first row = column names).' };
  }
  const out = rows.slice(1).map((r) => {
    const get = (k) => (col[k] !== undefined ? (r[col[k]] || '').trim() : '');
    let first = get('first_name');
    let last = get('last_name');
    if (!first && get('name')) {
      const parts = get('name').split(/\s+/);
      first = parts[0] || '';
      last = parts.slice(1).join(' ');
    }
    return {
      first_name: first,
      last_name: last,
      email: get('email') || null,
      phone: get('phone') || null,
      positions: get('positions') ? get('positions').split(/[;|/]/).map((p) => p.trim()).filter(Boolean) : [],
    };
  });
  return { rows: out, error: out.length > 200 ? 'Up to 200 people per file.' : '' };
}

function TempPassword({ result, onDone }) {
  const [copied, setCopied] = useState(false);
  if (!result) return null;
  return (
    <div className="p-4 rounded-xl border border-amber-500/40 bg-amber-500/5 space-y-2">
      <p className="text-sm text-amber-100">{result.message}</p>
      {result.temporary_password && (
        <div className="flex flex-wrap items-center gap-2">
          <KeyRound className="w-4 h-4 text-amber-300" />
          <code className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-base font-mono text-white tracking-wider select-all">
            {result.temporary_password}
          </code>
          <button type="button" className={btnGhost} onClick={async () => setCopied(await copyText(result.temporary_password))}>
            <Copy className="w-3.5 h-3.5" /> {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
      {result.temporary_password && (
        <p className="text-[11px] text-amber-200/80">
          They sign in on the ShiftBoard login page with their email and this password. Share it privately (text or in person).
        </p>
      )}
      <button type="button" className={btnGhost} onClick={onDone}>Done</button>
    </div>
  );
}

function PositionPicker({ options, value, onChange }) {
  if (!options.length) return <p className="text-[11px] text-slate-500">Add positions in Venue Settings to tag people.</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((name) => {
        const on = value.some((v) => v.toLowerCase() === name.toLowerCase());
        return (
          <button
            key={name}
            type="button"
            onClick={() => onChange(on ? value.filter((v) => v.toLowerCase() !== name.toLowerCase()) : [...value, name])}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${
              on ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
          >
            {on && <Check className="w-3 h-3 inline mr-0.5" />}
            {name}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Members tab (Phase 29.1: compact rows that expand into the full profile)
// ---------------------------------------------------------------------------------------------
const FILTERS = [
  ['active', 'On team'],
  ['removed', 'Removed'],
  ['blocked', 'Blocked'],
  ['all', 'Everyone'],
];

function MemberRow({ m, venueId, timeZone, positionOptions, open, onToggle, onUpdated, onMessage }) {
  const [editing, setEditing] = useState(false);
  const [positions, setPositions] = useState(m.positions || []);
  const [notes, setNotes] = useState(m.notes || '');
  const [confirm, setConfirm] = useState(null); // 'blocked' | 'removed'
  const [busy, setBusy] = useState(false);
  const [profileKey, setProfileKey] = useState(0);
  const name = `${m.first_name} ${m.last_name}`.trim() || m.email;
  const allOptions = useMemo(() => {
    const names = positionOptions.slice();
    (m.positions || []).forEach((p) => {
      if (!names.some((n) => n.toLowerCase() === p.toLowerCase())) names.push(p);
    });
    return names;
  }, [positionOptions, m.positions]);

  const patch = async (body) => {
    setBusy(true);
    try {
      const res = await api.patch(`/venues/${venueId}/team/${m.worker_id}`, body);
      onUpdated(res.data.member);
      onMessage({ type: 'success', text: `${name}: ${res.data.message}` });
      setEditing(false);
      setConfirm(null);
      setProfileKey((k) => k + 1);
    } catch (err) {
      onMessage({ type: 'error', text: err.response?.data?.detail || 'Could not save.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`rounded-xl border ${open ? 'border-emerald-500/40 bg-slate-950' : 'border-slate-800 bg-slate-950 hover:border-slate-700'}`}>
      <button type="button" onClick={onToggle} className="w-full text-left px-3 py-2.5 flex items-center gap-3">
        <Avatar person={m} size="w-9 h-9 text-xs" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-bold text-white truncate">{name}</span>
            {m.status !== 'active' && (
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${STATUS_CHIP[m.status] || STATUS_CHIP.removed}`}>
                {m.status === 'removed' ? 'Removed' : 'Blocked'}
              </span>
            )}
            {(m.positions || []).slice(0, 3).map((p) => (
              <span key={p} className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[9px] font-bold uppercase">{p}</span>
            ))}
            {m.notes && <span title={m.notes} className="text-[10px] text-amber-300">• note</span>}
          </div>
          <div className="text-[11px] text-slate-500 truncate">
            {m.shifts_worked} shift{m.shifts_worked === 1 ? '' : 's'} here
            {m.last_worked && ` · last ${fmtShortDate(m.last_worked, timeZone)}`}
            {m.upcoming > 0 && ` · ${m.upcoming} upcoming`}
            {m.phone ? ` · ${m.phone}` : m.email ? ` · ${m.email}` : ''}
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-1.5">
          <RatingBadge rating={m.aggregate_rating} count={m.rating_count} showCount={false} />
          <ReliabilityBadge data={m.reliability} />
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-slate-800 pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {m.phone && <a href={`tel:${m.phone}`} className={btnGhost}><Phone className="w-3.5 h-3.5" /> Call</a>}
            {m.email && <a href={`mailto:${m.email}`} className={btnGhost}><Mail className="w-3.5 h-3.5" /> Email</a>}
            {!editing && (
              <button type="button" className={btnGhost} onClick={() => setEditing(true)}>
                <Pencil className="w-3.5 h-3.5" /> Positions & note
              </button>
            )}
            <span className="flex-1" />
            {m.status === 'active' && (
              <>
                <button type="button" className={btnGhost} disabled={busy} onClick={() => setConfirm('removed')}>
                  <Trash2 className="w-3.5 h-3.5" /> Remove
                </button>
                <button type="button" className={btnGhost} disabled={busy} onClick={() => setConfirm('blocked')}>
                  <Ban className="w-3.5 h-3.5 text-rose-400" /> Block
                </button>
              </>
            )}
            {m.status === 'removed' && (
              <button type="button" className={btnGhost} disabled={busy} onClick={() => patch({ status: 'active' })}>
                <RotateCcw className="w-3.5 h-3.5" /> Add back
              </button>
            )}
            {m.status === 'blocked' && (
              <button type="button" className={btnGhost} disabled={busy} onClick={() => patch({ status: 'active' })}>
                <RotateCcw className="w-3.5 h-3.5" /> Unblock
              </button>
            )}
          </div>

          {confirm && (
            <div className="p-3 rounded-xl border border-rose-600/40 bg-rose-500/5 text-xs text-rose-100 flex flex-wrap items-center gap-2">
              <span className="flex-1 min-w-[12rem]">
                {confirm === 'blocked'
                  ? `Block ${name}? They won't see or be able to request your shifts, and their waiting requests are declined. Existing bookings stay until you remove them.`
                  : `Remove ${name} from the team? They lose team perks (instant booking, new-shift alerts) but can still request open shifts.`}
              </span>
              <button type="button" className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold disabled:opacity-40"
                disabled={busy} onClick={() => patch({ status: confirm })}>
                {confirm === 'blocked' ? 'Block' : 'Remove'}
              </button>
              <button type="button" className={btnGhost} onClick={() => setConfirm(null)}>Cancel</button>
            </div>
          )}

          {editing && (
            <div className="space-y-3 p-3 rounded-xl border border-slate-800 bg-slate-900">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Positions they work here</label>
                <PositionPicker options={allOptions} value={positions} onChange={setPositions} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Private note (managers only)</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} className={inputCls}
                  placeholder="e.g. Great with VIP tables. Prefers weekends." />
              </div>
              <div className="flex gap-2">
                <button type="button" className={btnPrimary} disabled={busy} onClick={() => patch({ positions, notes })}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className={btnGhost} onClick={() => { setEditing(false); setPositions(m.positions || []); setNotes(m.notes || ''); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          <WorkerProfilePanel venueId={venueId} workerId={m.worker_id} timeZone={timeZone} compact refreshKey={profileKey} />
        </div>
      )}
    </div>
  );
}

const RELATION_LABEL = {
  active: ['On your team', 'text-emerald-300'],
  removed: ['Removed', 'text-slate-400'],
  blocked: ['Blocked', 'text-rose-300'],
  worked: ['On your team (worked here)', 'text-emerald-300'],
  requested: ['Requested here', 'text-amber-300'],
  none: ['', ''],
};
const looksLikeEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((v || '').trim());

function CreateAccountForm({ venueId, positionOptions, initialEmail, onDone, onMessage }) {
  const [form, setForm] = useState({ first_name: '', last_name: '', email: initialEmail || '', phone: '', positions: [] });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.post(`/venues/${venueId}/team/accounts`, form);
      setResult(res.data);
      onDone(false);
    } catch (err) {
      onMessage({ type: 'error', text: err.response?.data?.detail || 'Could not create the account.' });
    } finally {
      setBusy(false);
    }
  };

  if (result) return <TempPassword result={result} onDone={() => onDone(true)} />;
  return (
    <form onSubmit={submit} className={`${cardCls} space-y-3`}>
      <div className="text-sm font-bold text-white flex items-center gap-2"><KeyRound className="w-4 h-4 text-amber-400" /> Create an account for them</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input className={inputCls} placeholder="First name" value={form.first_name} onChange={(e) => set('first_name', e.target.value)} required />
        <input className={inputCls} placeholder="Last name" value={form.last_name} onChange={(e) => set('last_name', e.target.value)} />
        <input className={inputCls} type="email" placeholder="Email" value={form.email} onChange={(e) => set('email', e.target.value)} required />
        <input className={inputCls} placeholder="Mobile (optional)" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
      </div>
      <PositionPicker options={positionOptions} value={form.positions} onChange={(v) => set('positions', v)} />
      <p className="text-[11px] text-slate-500">They get a temporary password (shown once) to sign in with. If the email already has a worker account, they're just added to your team.</p>
      <div className="flex gap-2">
        <button type="submit" className={btnPrimary} disabled={busy}><UserPlus className="w-4 h-4" /> {busy ? 'Saving…' : 'Create account'}</button>
        <button type="button" className={btnGhost} onClick={() => onDone(true)}>Cancel</button>
      </div>
    </form>
  );
}

/**
 * Phase 29.1: Add people = search first. Finds people who worked or requested here, anyone who
 * lets venues find them, and any account by its exact email. Falls back to invite / create account.
 */
function AddPeoplePanel({ venueId, positionOptions, onAdded, onMessage, onGoInvite, onClose }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState(null);
  const [positions, setPositions] = useState([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (debounced.length < 2) {
      setResults([]);
      return undefined;
    }
    let active = true;
    setSearching(true);
    api
      .get(`/venues/${venueId}/people`, { params: { q: debounced } })
      .then((res) => active && setResults(res.data || []))
      .catch(() => active && setResults([]))
      .finally(() => active && setSearching(false));
    return () => {
      active = false;
    };
  }, [venueId, debounced]);

  const add = async (p) => {
    setAddingId(p.worker_id);
    try {
      await api.post(`/venues/${venueId}/team`, { worker_id: p.worker_id, positions });
      onMessage({ type: 'success', text: `${p.first_name} ${p.last_name} added to the team. They've been notified.` });
      setResults((rs) => rs.map((r) => (r.worker_id === p.worker_id ? { ...r, relation: 'active', can_add: false } : r)));
      onAdded();
    } catch (err) {
      onMessage({ type: 'error', text: err.response?.data?.detail || 'Could not add them.' });
    } finally {
      setAddingId(null);
    }
  };

  if (creating) {
    return (
      <CreateAccountForm
        venueId={venueId}
        positionOptions={positionOptions}
        initialEmail={looksLikeEmail(q) ? q.trim() : ''}
        onMessage={onMessage}
        onDone={(close) => {
          onAdded();
          if (close) setCreating(false);
        }}
      />
    );
  }

  const exactEmail = looksLikeEmail(debounced);
  return (
    <div className={`${cardCls} space-y-3`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-bold text-white flex items-center gap-2"><UserPlus className="w-4 h-4 text-emerald-400" /> Add people</div>
        <button type="button" onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800" aria-label="Close"><X className="w-4 h-4" /></button>
      </div>
      <div className="relative">
        <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} className={`${inputCls} pl-9`}
          placeholder="Search by name, email or phone" />
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-slate-400 mb-1">Tag them as (optional)</label>
        <PositionPicker options={positionOptions} value={positions} onChange={setPositions} />
      </div>

      {debounced.length >= 2 && (
        <div className="space-y-1.5">
          {searching && results.length === 0 ? (
            <p className="text-xs text-slate-500">Searching…</p>
          ) : results.length === 0 ? (
            <div className="p-3 rounded-xl border border-slate-800 text-xs text-slate-400 space-y-2">
              <p>
                No one found. People only show up if they've worked or requested here, or let venues find them in their settings.
                {exactEmail ? ' No account uses that email yet.' : ' An exact email address always works.'}
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btnGhost} onClick={onGoInvite}><Send className="w-3.5 h-3.5" /> Invite {exactEmail ? debounced : 'them'}</button>
                <button type="button" className={btnGhost} onClick={() => setCreating(true)}><KeyRound className="w-3.5 h-3.5" /> Create an account</button>
              </div>
            </div>
          ) : (
            results.map((p) => {
              const [relLabel, relCls] = RELATION_LABEL[p.relation] || RELATION_LABEL.none;
              return (
                <div key={p.worker_id} className="p-2.5 rounded-xl border border-slate-800 bg-slate-900 flex items-center gap-3">
                  <Avatar person={p} size="w-8 h-8 text-[11px]" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-semibold text-white">{`${p.first_name} ${p.last_name}`.trim()}</span>
                      <RatingBadge rating={p.aggregate_rating} count={p.rating_count} showCount={false} />
                      {relLabel && <span className={`text-[10px] font-semibold ${relCls}`}>{relLabel}</span>}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {[p.email, p.phone].filter(Boolean).join(' · ')}
                      {p.reliability_score !== null && p.reliability_score !== undefined && ` · ${Math.round(p.reliability_score)}% reliable`}
                    </div>
                  </div>
                  {p.can_add ? (
                    <button type="button" className={btnGhost} disabled={addingId === p.worker_id} onClick={() => add(p)}>
                      <Plus className="w-3.5 h-3.5" /> {addingId === p.worker_id ? 'Adding…' : 'Add'}
                    </button>
                  ) : (
                    <span className="text-[11px] text-slate-500">{p.relation === 'blocked' ? 'Unblock them in the list' : 'Already on your team'}</span>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-800">
        <span className="text-[11px] text-slate-500 mr-auto pt-2">Not on ShiftBoard yet?</span>
        <button type="button" className={`${btnGhost} mt-2`} onClick={onGoInvite}><Send className="w-3.5 h-3.5" /> Invite by email, text or QR</button>
        <button type="button" className={`${btnGhost} mt-2`} onClick={() => setCreating(true)}><KeyRound className="w-3.5 h-3.5" /> Create an account</button>
      </div>
    </div>
  );
}

function MembersTab({ venueId, timeZone, positionOptions, onChanged, onMessage, onGoInvite }) {
  const [members, setMembers] = useState([]);
  const [filter, setFilter] = useState('active');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get(`/venues/${venueId}/team`, { params: { status: filter } })
      .then((res) => active && setMembers(res.data || []))
      .catch((err) => active && onMessage({ type: 'error', text: err.response?.data?.detail || 'Could not load the team.' }))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId, filter, tick]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return members;
    return members.filter((m) =>
      `${m.first_name} ${m.last_name} ${m.email || ''} ${m.phone || ''} ${(m.positions || []).join(' ')}`.toLowerCase().includes(term)
    );
  }, [members, q]);

  const updated = (member) => {
    setMembers((prev) =>
      prev
        .map((m) => (m.worker_id === member.worker_id ? member : m))
        .filter((m) => filter === 'all' || m.status === filter)
    );
    onChanged();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter your team by name, phone or position" className={`${inputCls} pl-9`} />
        </div>
        <div className="flex bg-slate-800 border border-slate-700 rounded-xl p-0.5 overflow-x-auto">
          {FILTERS.map(([id, label]) => (
            <button key={id} type="button" onClick={() => setFilter(id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap ${filter === id ? 'bg-emerald-500 text-slate-950' : 'text-slate-300 hover:text-white'}`}>
              {label}
            </button>
          ))}
        </div>
        {!adding && (
          <button type="button" className={`${btnPrimary} justify-center`} onClick={() => setAdding(true)}>
            <UserPlus className="w-4 h-4" /> Add people
          </button>
        )}
      </div>

      {adding && (
        <AddPeoplePanel
          venueId={venueId}
          positionOptions={positionOptions}
          onAdded={() => { setTick((t) => t + 1); onChanged(); }}
          onMessage={onMessage}
          onGoInvite={onGoInvite}
          onClose={() => setAdding(false)}
        />
      )}

      {loading && members.length === 0 ? (
        <p className="text-sm text-slate-500 py-8 text-center">Loading…</p>
      ) : shown.length === 0 ? (
        <div className="text-center py-10 space-y-3">
          <Users className="w-8 h-8 text-slate-600 mx-auto" />
          <p className="text-sm text-slate-400">
            {filter === 'active' ? 'No one on the team yet.' : q ? 'No one matches.' : 'No one here.'}
          </p>
          {filter === 'active' && !q && (
            <div className="flex justify-center gap-2">
              <button type="button" className={btnGhost} onClick={() => setAdding(true)}><UserPlus className="w-3.5 h-3.5" /> Add people</button>
              <button type="button" className={btnGhost} onClick={onGoInvite}><Link2 className="w-3.5 h-3.5" /> Share your team link</button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-slate-500">{shown.length} {shown.length === 1 ? 'person' : 'people'} · tap someone for their history and actions</p>
          {shown.map((m) => (
            <MemberRow
              key={m.worker_id}
              m={m}
              venueId={venueId}
              timeZone={timeZone}
              positionOptions={positionOptions}
              open={openId === m.worker_id}
              onToggle={() => setOpenId(openId === m.worker_id ? null : m.worker_id)}
              onUpdated={updated}
              onMessage={onMessage}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Invite tab
// ---------------------------------------------------------------------------------------------
function TeamLinkCard({ venueId, venueName, onMessage }) {
  const [link, setLink] = useState(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api
      .get(`/venues/${venueId}/invites/link`)
      .then((res) => setLink(res.data))
      .catch((err) => onMessage({ type: 'error', text: err.response?.data?.detail || 'Could not load the team link.' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId]);

  const regenerate = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/venues/${venueId}/invites/link/regenerate`);
      setLink(res.data);
      setConfirmNew(false);
      onMessage({ type: 'success', text: 'New team link made. The old link and QR code no longer work.' });
    } catch (err) {
      onMessage({ type: 'error', text: err.response?.data?.detail || 'Could not make a new link.' });
    } finally {
      setBusy(false);
    }
  };

  if (!link) return <div className={cardCls}><p className="text-sm text-slate-500">Loading team link…</p></div>;
  const qrSrc = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(link.qr_svg)}`;
  const safeName = (venueName || 'team').replace(/[^a-z0-9]+/gi, '-').toLowerCase();

  return (
    <div className={`${cardCls} flex flex-col sm:flex-row gap-4`}>
      <img src={qrSrc} alt="Team invite QR code" className="w-40 h-40 rounded-xl bg-white p-1 self-center sm:self-start" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="text-sm font-bold text-white flex items-center gap-2"><Link2 className="w-4 h-4 text-emerald-400" /> Team link</div>
        <p className="text-xs text-slate-400">
          Anyone with this link or QR code can join your team: post it in the staff group chat or print it for the back office.
          New people create an account; existing ones just sign in.
        </p>
        {/localhost|127\.0\.0\.1/.test(link.url) && !/localhost|127\.0\.0\.1/.test(window.location.hostname) && (
          <p className="text-[11px] text-amber-200 bg-amber-500/10 border border-amber-500/40 rounded-lg p-2 flex gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            This link points at localhost, so it won't open on anyone's phone. Set APP_BASE_URL in the server's secrets file to your site address.
          </p>
        )}
        <div className="flex gap-2">
          <input readOnly value={link.url} className={`${inputCls} font-mono text-xs`} onFocus={(e) => e.target.select()} />
          <button type="button" className={btnGhost} onClick={async () => setCopied(await copyText(link.url))}>
            <Copy className="w-3.5 h-3.5" /> {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          <span>Joined with it: {link.uses}</span>
          <span>· Works until {fmtShortDate(link.expires_at)}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={qrSrc} download={`${safeName}-team-qr.svg`} className={btnGhost}>
            <Download className="w-3.5 h-3.5" /> Download QR
          </a>
          {!confirmNew ? (
            <button type="button" className={btnGhost} onClick={() => setConfirmNew(true)}>
              <RefreshCw className="w-3.5 h-3.5" /> New link
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 text-xs text-amber-200">
              The current link and QR stop working.
              <button type="button" className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold" disabled={busy} onClick={regenerate}>
                Make new link
              </button>
              <button type="button" className={btnGhost} onClick={() => setConfirmNew(false)}>Cancel</button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultsTable({ result }) {
  if (!result) return null;
  const chip = {
    invited: 'text-emerald-300',
    already_member: 'text-slate-400',
    already_invited: 'text-indigo-300',
    invalid: 'text-rose-300',
  };
  return (
    <div className={`${cardCls} space-y-2`}>
      <p className="text-sm text-white">
        <strong>{result.invited}</strong> invited, <strong>{result.skipped}</strong> skipped.
        {result.emailed > 0 && ` ${result.emailed} emailed${result.email_available ? '' : ' (email isn’t set up on this server, so they were only logged; copy the links instead)'}.`}
        {result.texted > 0 && ` ${result.texted} texted.`}
      </p>
      <div className="max-h-64 overflow-y-auto divide-y divide-slate-800 text-xs">
        {result.results.map((r) => (
          <div key={r.row} className="py-1.5 flex flex-wrap items-center gap-2">
            <span className="text-slate-500 w-10">#{r.row}</span>
            <span className="text-slate-200 min-w-[8rem]">{r.name || r.email || '—'}</span>
            <span className={`font-semibold ${chip[r.result] || ''}`}>{r.message}</span>
            {r.url && (
              <button type="button" className="text-slate-400 hover:text-white inline-flex items-center gap-1" onClick={() => copyText(r.url)}>
                <Copy className="w-3 h-3" /> link
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function InviteTab({ venueId, venueName, positionOptions, onMessage }) {
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '', positions: [] });
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [csvRows, setCsvRows] = useState(null);
  const [csvName, setCsvName] = useState('');
  const [invites, setInvites] = useState([]);
  const [tick, setTick] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    api.get(`/venues/${venueId}/invites`).then((res) => setInvites(res.data || [])).catch(() => setInvites([]));
  }, [venueId, tick]);

  const send = async (rows, source) => {
    setSending(true);
    setResult(null);
    try {
      const res = await api.post(`/venues/${venueId}/invites`, { rows, send: true, source });
      setResult(res.data);
      setTick((t) => t + 1);
      return true;
    } catch (err) {
      onMessage({ type: 'error', text: err.response?.data?.detail || 'Could not send the invites.' });
      return false;
    } finally {
      setSending(false);
    }
  };

  const sendOne = async (e) => {
    e.preventDefault();
    if (!form.email && !form.phone) {
      onMessage({ type: 'error', text: 'Add an email or a mobile number.' });
      return;
    }
    if (await send([{ ...form, email: form.email || null, phone: form.phone || null }], 'manual')) {
      setForm({ first_name: '', last_name: '', email: '', phone: '', positions: [] });
    }
  };

  const onFile = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const { rows, error } = csvToInviteRows(String(reader.result || ''));
      if (error) {
        onMessage({ type: 'error', text: error });
        setCsvRows(null);
        return;
      }
      setCsvName(file.name);
      setCsvRows(rows);
    };
    reader.readAsText(file);
  };

  const act = async (inv, action) => {
    setBusyId(inv.id);
    try {
      if (action === 'resend') {
        await api.post(`/venues/${venueId}/invites/${inv.id}/resend`);
        onMessage({ type: 'success', text: 'Invite sent again.' });
      } else {
        await api.delete(`/venues/${venueId}/invites/${inv.id}`);
        onMessage({ type: 'success', text: 'Invite turned off.' });
      }
      setTick((t) => t + 1);
    } catch (err) {
      onMessage({ type: 'error', text: err.response?.data?.detail || 'Could not update the invite.' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <TeamLinkCard venueId={venueId} venueName={venueName} onMessage={onMessage} />

      <form onSubmit={sendOne} className={`${cardCls} space-y-3`}>
        <div className="text-sm font-bold text-white flex items-center gap-2"><Send className="w-4 h-4 text-emerald-400" /> Invite someone</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input className={inputCls} placeholder="First name" value={form.first_name} onChange={(e) => set('first_name', e.target.value)} />
          <input className={inputCls} placeholder="Last name" value={form.last_name} onChange={(e) => set('last_name', e.target.value)} />
          <input className={inputCls} type="email" placeholder="Email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          <input className={inputCls} placeholder="Mobile (texted if texts are set up)" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </div>
        <PositionPicker options={positionOptions} value={form.positions} onChange={(v) => set('positions', v)} />
        <button type="submit" className={btnPrimary} disabled={sending}>
          <Send className="w-4 h-4" /> {sending ? 'Sending…' : 'Send invite'}
        </button>
      </form>

      <div className={`${cardCls} space-y-3`}>
        <div className="text-sm font-bold text-white flex items-center gap-2"><Upload className="w-4 h-4 text-emerald-400" /> Import a list (CSV)</div>
        <p className="text-xs text-slate-400">
          First row = column names: <code className="text-slate-200">name</code> (or <code className="text-slate-200">first_name</code>, <code className="text-slate-200">last_name</code>),{' '}
          <code className="text-slate-200">email</code>, <code className="text-slate-200">phone</code>, <code className="text-slate-200">positions</code> (separate several with ;).
          Everyone gets their own invite. Up to 200 people.
        </p>
        <label className={`${btnGhost} cursor-pointer w-fit`}>
          <Upload className="w-3.5 h-3.5" /> Choose file
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
        </label>
        {csvRows && (
          <div className="space-y-2">
            <p className="text-xs text-slate-300">{csvName}: {csvRows.length} {csvRows.length === 1 ? 'person' : 'people'}. First few:</p>
            <div className="text-xs divide-y divide-slate-800 border border-slate-800 rounded-lg">
              {csvRows.slice(0, 5).map((r, i) => (
                <div key={i} className="px-2 py-1 flex flex-wrap gap-3 text-slate-300">
                  <span className="font-semibold text-white">{`${r.first_name} ${r.last_name}`.trim() || '—'}</span>
                  <span>{r.email || ''}</span>
                  <span>{r.phone || ''}</span>
                  <span className="text-slate-500">{r.positions.join(', ')}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button type="button" className={btnPrimary} disabled={sending || csvRows.length > 200}
                onClick={async () => { if (await send(csvRows, 'import')) setCsvRows(null); }}>
                <Send className="w-4 h-4" /> {sending ? 'Sending…' : `Send ${csvRows.length} invites`}
              </button>
              <button type="button" className={btnGhost} onClick={() => setCsvRows(null)}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <ResultsTable result={result} />

      <div className={`${cardCls} space-y-2`}>
        <div className="text-sm font-bold text-white">Sent invites</div>
        {invites.length === 0 ? (
          <p className="text-xs text-slate-500">None yet.</p>
        ) : (
          <div className="divide-y divide-slate-800">
            {invites.map((inv) => (
              <div key={inv.id} className="py-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-100 font-semibold min-w-[8rem]">{`${inv.first_name || ''} ${inv.last_name || ''}`.trim() || inv.email || inv.phone}</span>
                <span className="text-slate-400">{inv.email || inv.phone}</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${INVITE_CHIP[inv.status]}`}>
                  {inv.status === 'accepted' ? `Joined${inv.accepted_by_name ? ` (${inv.accepted_by_name})` : ''}` : inv.status[0].toUpperCase() + inv.status.slice(1)}
                </span>
                <span className="text-slate-500">
                  {inv.last_sent_at ? `sent ${fmtShortDate(inv.last_sent_at)}` : `created ${fmtShortDate(inv.created_at)}`}
                </span>
                <span className="ml-auto flex gap-1.5">
                  {inv.status !== 'accepted' && inv.status !== 'revoked' && (
                    <>
                      <button type="button" className={btnGhost} onClick={() => copyText(inv.url).then((ok) => ok && onMessage({ type: 'success', text: 'Invite link copied.' }))}>
                        <Copy className="w-3 h-3" /> Link
                      </button>
                      <button type="button" className={btnGhost} disabled={busyId === inv.id} onClick={() => act(inv, 'resend')}>
                        <RefreshCw className="w-3 h-3" /> Resend
                      </button>
                      <button type="button" className={btnGhost} disabled={busyId === inv.id} onClick={() => act(inv, 'revoke')}>
                        <X className="w-3 h-3" /> Turn off
                      </button>
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Managers tab
// ---------------------------------------------------------------------------------------------
function ManagersTab({ venueId, onMessage }) {
  const [managers, setManagers] = useState([]);
  const [form, setForm] = useState({ email: '', first_name: '', last_name: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [tick, setTick] = useState(0);
  const [confirmId, setConfirmId] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    api.get(`/venues/${venueId}/managers`).then((res) => setManagers(res.data || [])).catch(() => setManagers([]));
  }, [venueId, tick]);

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.post(`/venues/${venueId}/managers`, form);
      setResult(res.data);
      setForm({ email: '', first_name: '', last_name: '', phone: '' });
      setTick((t) => t + 1);
    } catch (err) {
      onMessage({ type: 'error', text: err.response?.data?.detail || 'Could not add the manager.' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (userId) => {
    setBusy(true);
    try {
      await api.delete(`/venues/${venueId}/managers/${userId}`);
      setConfirmId(null);
      setTick((t) => t + 1);
      onMessage({ type: 'success', text: 'Manager removed from this venue.' });
    } catch (err) {
      onMessage({ type: 'error', text: err.response?.data?.detail || 'Could not remove the manager.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className={`${cardCls} space-y-2`}>
        <div className="text-sm font-bold text-white flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-amber-400" /> Managers of this venue</div>
        {managers.length === 0 && (
          <p className="text-xs text-slate-500">No managers yet. Only platform admins can run this venue until you add one below.</p>
        )}
        <div className="divide-y divide-slate-800">
          {managers.map((m) => (
            <div key={m.user_id} className="py-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-white">{`${m.first_name} ${m.last_name}`.trim() || m.email}</span>
              {m.is_you && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">You</span>}
              {m.is_primary && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30">Primary</span>}
              <span className="text-xs text-slate-400">{m.email}</span>
              {!m.is_you && (
                <span className="ml-auto">
                  {confirmId === m.user_id ? (
                    <span className="inline-flex items-center gap-2 text-xs text-rose-200">
                      Remove their access?
                      <button type="button" className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold" disabled={busy} onClick={() => remove(m.user_id)}>Remove</button>
                      <button type="button" className={btnGhost} onClick={() => setConfirmId(null)}>Cancel</button>
                    </span>
                  ) : (
                    <button type="button" className={btnGhost} onClick={() => setConfirmId(m.user_id)}>
                      <Trash2 className="w-3.5 h-3.5" /> Remove
                    </button>
                  )}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {result ? (
        <TempPassword result={result} onDone={() => setResult(null)} />
      ) : (
        <form onSubmit={add} className={`${cardCls} space-y-3`}>
          <div className="text-sm font-bold text-white flex items-center gap-2"><UserCog className="w-4 h-4 text-amber-400" /> Add a co-manager</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input className={inputCls} type="email" placeholder="Email" value={form.email} onChange={(e) => set('email', e.target.value)} required />
            <input className={inputCls} placeholder="Mobile (optional)" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            <input className={inputCls} placeholder="First name (for a new account)" value={form.first_name} onChange={(e) => set('first_name', e.target.value)} />
            <input className={inputCls} placeholder="Last name" value={form.last_name} onChange={(e) => set('last_name', e.target.value)} />
          </div>
          <p className="text-[11px] text-slate-500">
            If they already have a manager account, they're added to this venue. Otherwise a manager account is created with a temporary password.
            Worker accounts can't be made managers here (ask a platform admin).
          </p>
          <button type="submit" className={btnPrimary} disabled={busy}>
            <UserCog className="w-4 h-4" /> {busy ? 'Saving…' : 'Add co-manager'}
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * Phase 29: Team page (modal) for a venue: members, invites (link / QR / CSV), co-managers.
 * Phase 29.1: counts on the tabs, search-first "Add people", rows that expand into the profile.
 * Props: venue ({id, name}), positions (venue positions [{name}]), timeZone, onClose, onChanged
 */
export default function TeamModal({ venue, positions = [], timeZone, onClose, onChanged }) {
  const [tab, setTab] = useState('members');
  const [msg, setMsg] = useState(null);
  const [summary, setSummary] = useState(null);
  const [summaryTick, setSummaryTick] = useState(0);
  const positionOptions = useMemo(() => (positions || []).map((p) => p.name).filter(Boolean), [positions]);
  const changed = () => {
    setSummaryTick((t) => t + 1);
    if (onChanged) onChanged();
  };

  useEffect(() => {
    api.get(`/venues/${venue.id}/team/summary`).then((res) => setSummary(res.data)).catch(() => setSummary(null));
  }, [venue.id, summaryTick, tab]);

  const tabs = [
    ['members', 'Team', Users, summary?.active],
    ['invite', 'Invite', Send, summary?.invites_pending],
    ['managers', 'Managers', ShieldCheck, summary?.managers],
  ];

  const headerExtra = (
    <div className="flex flex-wrap gap-2">
      {tabs.map(([id, label, Icon, count]) => (
        <button key={id} type="button" onClick={() => { setTab(id); setMsg(null); }}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold border inline-flex items-center gap-1.5 ${
            tab === id ? 'bg-emerald-500 text-slate-950 border-emerald-500' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
          }`}>
          <Icon className="w-3.5 h-3.5" /> {label}
          {count > 0 && (
            <span className={`px-1.5 rounded-full text-[10px] ${tab === id ? 'bg-slate-950/20' : 'bg-slate-700 text-slate-200'}`}>
              {id === 'invite' ? `${count} pending` : count}
            </span>
          )}
        </button>
      ))}
    </div>
  );

  return (
    <ModalShell
      title={`${venue?.name || 'Venue'} team`}
      subtitle="Who's on your team, how to bring new people in, and who else manages this venue."
      icon={<Users className="w-5 h-5 text-emerald-400" />}
      onClose={onClose}
      maxWidth="max-w-5xl"
      headerExtra={headerExtra}
    >
      {msg && (
        <div className={`mb-4 p-3 rounded-xl text-sm border flex items-start justify-between gap-2 ${msg.type === 'success' ? 'bg-emerald-950/60 border-emerald-700 text-emerald-200' : 'bg-rose-950/60 border-rose-700 text-rose-200'}`}>
          <span>{msg.text}</span>
          <button type="button" onClick={() => setMsg(null)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
      )}
      {tab === 'members' && (
        <MembersTab venueId={venue.id} timeZone={timeZone} positionOptions={positionOptions} onChanged={changed} onMessage={setMsg} onGoInvite={() => setTab('invite')} />
      )}
      {tab === 'invite' && (
        <InviteTab venueId={venue.id} venueName={venue.name} positionOptions={positionOptions} onMessage={setMsg} />
      )}
      {tab === 'managers' && <ManagersTab venueId={venue.id} onMessage={(m) => { setMsg(m); changed(); }} />}
    </ModalShell>
  );
}
