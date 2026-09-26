import React, { useEffect, useMemo, useState } from 'react';
import {
  Users, UserPlus, Link2, Copy, Download, RefreshCw, Mail, Phone, Upload, ShieldCheck, Trash2, Ban,
  RotateCcw, Pencil, Search, Check, X, KeyRound, Send, UserCog,
} from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import RatingBadge from './RatingBadge';
import ReliabilityBadge from './ReliabilityBadge';
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
// Members tab
// ---------------------------------------------------------------------------------------------
function MemberCard({ m, venueId, positionOptions, onUpdated, onMessage }) {
  const [editing, setEditing] = useState(false);
  const [positions, setPositions] = useState(m.positions || []);
  const [notes, setNotes] = useState(m.notes || '');
  const [confirm, setConfirm] = useState(null); // 'blocked' | 'removed'
  const [busy, setBusy] = useState(false);
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
    } catch (err) {
      onMessage({ type: 'error', text: err.response?.data?.detail || 'Could not save.' });
    } finally {
      setBusy(false);
    }
  };

  const here = m.venue_rating_count > 0
    ? `Here: ★ ${Number(m.venue_rating).toFixed(1)} (${m.venue_rating_count})`
    : null;
  const again = m.would_book_again_yes + m.would_book_again_no > 0
    ? `Would book again ${m.would_book_again_yes}/${m.would_book_again_yes + m.would_book_again_no}`
    : null;

  return (
    <div className={cardCls}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-white">{name}</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${STATUS_CHIP[m.status] || STATUS_CHIP.active}`}>
              {m.status === 'active' ? 'On team' : m.status === 'removed' ? 'Removed' : 'Blocked'}
            </span>
            <RatingBadge rating={m.aggregate_rating} count={m.rating_count} />
            <ReliabilityBadge data={m.reliability} />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 mt-1">
            {m.phone && <a href={`tel:${m.phone}`} className="inline-flex items-center gap-1 hover:text-emerald-400"><Phone className="w-3 h-3" />{m.phone}</a>}
            {m.email && <a href={`mailto:${m.email}`} className="inline-flex items-center gap-1 hover:text-emerald-400"><Mail className="w-3 h-3" />{m.email}</a>}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            {m.shifts_worked} shift{m.shifts_worked === 1 ? '' : 's'} here
            {m.last_worked && ` · last ${fmtShortDate(m.last_worked)}`}
            {m.upcoming > 0 && ` · ${m.upcoming} upcoming`}
            {here && ` · ${here}`}
            {again && ` · ${again}`}
            {` · ${SOURCE_LABEL[m.source] || ''}`}
          </div>
          {m.positions?.length > 0 && !editing && (
            <div className="flex flex-wrap gap-1 mt-2">
              {m.positions.map((p) => (
                <span key={p} className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] font-bold uppercase">{p}</span>
              ))}
            </div>
          )}
          {m.notes && !editing && (
            <p className="text-xs text-slate-300 mt-2 whitespace-pre-line bg-slate-900 border border-slate-800 rounded-lg p-2">
              <span className="text-slate-500 font-semibold">Private note: </span>{m.notes}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {!editing && (
            <button type="button" className={btnGhost} onClick={() => setEditing(true)}>
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
          )}
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
      </div>

      {confirm && (
        <div className="mt-3 p-3 rounded-xl border border-rose-600/40 bg-rose-500/5 text-xs text-rose-100 flex flex-wrap items-center gap-2">
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
        <div className="mt-3 space-y-3 border-t border-slate-800 pt-3">
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
    </div>
  );
}

function AddPeoplePanel({ venueId, positionOptions, onAdded, onMessage, onGoInvite }) {
  const [mode, setMode] = useState('create'); // 'create' | 'existing'
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '', positions: [] });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'existing') {
        await api.post(`/venues/${venueId}/team`, { email: form.email, positions: form.positions });
        onMessage({ type: 'success', text: `${form.email} added to the team.` });
        setForm({ first_name: '', last_name: '', email: '', phone: '', positions: [] });
      } else {
        const res = await api.post(`/venues/${venueId}/team/accounts`, form);
        setResult(res.data);
      }
      onAdded();
    } catch (err) {
      onMessage({ type: 'error', text: err.response?.data?.detail || 'Could not add them.' });
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <TempPassword
        result={result}
        onDone={() => {
          setResult(null);
          setForm({ first_name: '', last_name: '', email: '', phone: '', positions: [] });
        }}
      />
    );
  }

  return (
    <form onSubmit={submit} className={`${cardCls} space-y-3`}>
      <div className="flex flex-wrap gap-2">
        {[
          ['create', 'Create an account for them'],
          ['existing', 'They already have an account'],
        ].map(([id, label]) => (
          <button key={id} type="button" onClick={() => setMode(id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${mode === id ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
            {label}
          </button>
        ))}
        <button type="button" onClick={onGoInvite} className="px-3 py-1.5 rounded-lg text-xs font-semibold border bg-slate-800 text-slate-400 border-slate-700">
          Send an invite instead
        </button>
      </div>
      {mode === 'create' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input className={inputCls} placeholder="First name" value={form.first_name} onChange={(e) => set('first_name', e.target.value)} required />
          <input className={inputCls} placeholder="Last name" value={form.last_name} onChange={(e) => set('last_name', e.target.value)} />
          <input className={inputCls} placeholder="Mobile (optional)" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          <input className={inputCls} type="email" placeholder="Email" value={form.email} onChange={(e) => set('email', e.target.value)} required />
        </div>
      )}
      {mode === 'existing' && (
        <input className={inputCls} type="email" placeholder="Their ShiftBoard email" value={form.email} onChange={(e) => set('email', e.target.value)} required />
      )}
      <div>
        <label className="block text-xs font-semibold text-slate-300 mb-1">Positions</label>
        <PositionPicker options={positionOptions} value={form.positions} onChange={(v) => set('positions', v)} />
      </div>
      <p className="text-[11px] text-slate-500">
        {mode === 'create'
          ? 'Creates a worker account with a temporary password you give them. If the email already has an account, they are just added to your team.'
          : 'Adds an existing worker account to your team.'}
      </p>
      <button type="submit" className={btnPrimary} disabled={busy}>
        <UserPlus className="w-4 h-4" /> {busy ? 'Saving…' : mode === 'create' ? 'Create account' : 'Add to team'}
      </button>
    </form>
  );
}

function MembersTab({ venueId, positionOptions, onChanged, onMessage, onGoInvite }) {
  const [members, setMembers] = useState([]);
  const [filter, setFilter] = useState('active');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
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
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, phone, position" className={`${inputCls} pl-9`} />
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className={`${inputCls} w-auto`}>
          <option value="active">On team</option>
          <option value="removed">Removed</option>
          <option value="blocked">Blocked</option>
          <option value="all">Everyone</option>
        </select>
        <button type="button" className={btnPrimary} onClick={() => setAdding((a) => !a)}>
          <UserPlus className="w-4 h-4" /> {adding ? 'Close' : 'Add people'}
        </button>
      </div>

      {adding && (
        <AddPeoplePanel
          venueId={venueId}
          positionOptions={positionOptions}
          onAdded={() => { setTick((t) => t + 1); onChanged(); }}
          onMessage={onMessage}
          onGoInvite={onGoInvite}
        />
      )}

      {loading ? (
        <p className="text-sm text-slate-500 py-8 text-center">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-slate-500 py-8 text-center">
          {filter === 'active' ? 'No one on the team yet. Add people or share your team link.' : 'No one here.'}
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-slate-500">{shown.length} {shown.length === 1 ? 'person' : 'people'}</p>
          {shown.map((m) => (
            <MemberCard key={m.worker_id} m={m} venueId={venueId} positionOptions={positionOptions} onUpdated={updated} onMessage={onMessage} />
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
 * Props: venue ({id, name}), positions (venue positions [{name}]), onClose, onChanged
 */
export default function TeamModal({ venue, positions = [], onClose, onChanged }) {
  const [tab, setTab] = useState('members');
  const [msg, setMsg] = useState(null);
  const positionOptions = useMemo(() => (positions || []).map((p) => p.name).filter(Boolean), [positions]);
  const changed = () => onChanged && onChanged();

  const tabs = [
    ['members', 'Team', Users],
    ['invite', 'Invite', Send],
    ['managers', 'Managers', ShieldCheck],
  ];

  const headerExtra = (
    <div className="flex flex-wrap gap-2">
      {tabs.map(([id, label, Icon]) => (
        <button key={id} type="button" onClick={() => { setTab(id); setMsg(null); }}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold border inline-flex items-center gap-1.5 ${
            tab === id ? 'bg-emerald-500 text-slate-950 border-emerald-500' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
          }`}>
          <Icon className="w-3.5 h-3.5" /> {label}
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
        <MembersTab venueId={venue.id} positionOptions={positionOptions} onChanged={changed} onMessage={setMsg} onGoInvite={() => setTab('invite')} />
      )}
      {tab === 'invite' && (
        <InviteTab venueId={venue.id} venueName={venue.name} positionOptions={positionOptions} onMessage={setMsg} />
      )}
      {tab === 'managers' && <ManagersTab venueId={venue.id} onMessage={setMsg} />}
    </ModalShell>
  );
}
