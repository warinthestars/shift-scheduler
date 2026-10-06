import React, { useEffect, useState } from 'react';
import { Phone, Mail, Star, ThumbsUp, ThumbsDown, Clock, Building2, StickyNote, HeartPulse, CalendarDays, CalendarOff, Award, FileText, BadgeCheck, XCircle } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import ConfirmDialog from './ConfirmDialog';
import { availabilitySummary, fmtDay } from '../utils/availability';
import { openProtectedFile } from '../utils/files';
import { DeptChip } from '../utils/departments';
import RatingBadge from './RatingBadge';
import ReliabilityBadge from './ReliabilityBadge';
import { fmtDate, fmtTimeRange } from '../utils/venueTime';

const STATUS_CHIP = {
  active: ['On team', 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'],
  removed: ['Removed from team', 'bg-slate-700/40 text-slate-300 border-slate-600/40'],
  blocked: ['Blocked', 'bg-rose-500/10 text-rose-300 border-rose-500/30'],
  none: ['Not on team', 'bg-slate-800 text-slate-400 border-slate-700'],
};

const HISTORY_LABEL = {
  pending: ['Waiting', 'text-amber-300'],
  pending_manager_approval: ['Waiting', 'text-amber-300'],
  approved: ['Booked', 'text-emerald-300'],
  confirmed: ['Booked', 'text-emerald-300'],
  checked_in: ['Clocked in', 'text-sky-300'],
  completed: ['Worked', 'text-slate-200'],
  dropped: ['Dropped', 'text-rose-300'],
  no_show: ['No-show', 'text-rose-300'],
  removed: ['Removed', 'text-rose-300'],
  rejected: ['Not selected', 'text-slate-500'],
  withdrawn: ['Withdrew', 'text-slate-500'],
  cancelled: ['Cancelled', 'text-slate-500'],
  transferred: ['Handed off', 'text-slate-400'],
};

export function initials(first, last, email) {
  const a = (first || '').trim()[0] || (email || '?')[0];
  const b = (last || '').trim()[0] || '';
  return `${a}${b}`.toUpperCase();
}

export function Avatar({ person, size = 'w-10 h-10 text-sm' }) {
  const [broken, setBroken] = useState(false);
  if (person?.avatar_url && !broken) {
    return (
      <img src={person.avatar_url} alt="" onError={() => setBroken(true)}
        className={`${size} rounded-full object-cover border border-slate-700 flex-shrink-0`} />
    );
  }
  return (
    <div className={`${size} rounded-full bg-brand-500/15 text-brand-300 border border-brand-500/30 flex items-center justify-center font-bold flex-shrink-0`}>
      {initials(person?.first_name, person?.last_name, person?.email)}
    </div>
  );
}

function Stat({ label, children }) {
  return (
    <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
      <div className="text-sm text-white font-semibold mt-0.5">{children}</div>
    </div>
  );
}

/**
 * Phase 29.1: Who is this person, for this venue.
 * GET /venues/{venueId}/people/{workerId}: team status, contact, ratings, reliability, positions,
 * private note and their history HERE. Used by the queue Review, the activity log and the Team page.
 * Props: venueId, workerId, timeZone, compact (hide the header), refreshKey
 */
export default function WorkerProfilePanel({ venueId, workerId, timeZone, compact = false, refreshKey = 0 }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);   // Phase 32: after a certificate review
  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
    let active = true;
    setError('');
    api
      .get(`/venues/${venueId}/people/${workerId}`)
      .then((res) => active && setData(res.data))
      .catch((err) => active && setError(err.response?.data?.detail || 'Could not load this person.'));
    return () => {
      active = false;
    };
  }, [venueId, workerId, refreshKey, reloadTick]);

  if (error) return <p className="text-sm text-rose-300">{error}</p>;
  if (!data) return <p className="text-sm text-slate-500 py-6 text-center">Loading…</p>;

  const m = data.member;
  const [statusLabel, statusCls] = STATUS_CHIP[m.status] || STATUS_CHIP.none;
  const rel = m.reliability;
  const againTotal = m.would_book_again_yes + m.would_book_again_no;

  return (
    <div className="space-y-4">
      {!compact && (
        <div className="flex items-start gap-3">
          <Avatar person={{ ...m, avatar_url: data.avatar_url || m.avatar_url }} size="w-12 h-12 text-base" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-bold text-white">{`${m.first_name} ${m.last_name}`.trim() || m.email}</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusCls}`}>{statusLabel}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 mt-1">
              {m.phone && <a href={`tel:${m.phone}`} className="inline-flex items-center gap-1 hover:text-brand-400"><Phone className="w-3 h-3" />{m.phone}</a>}
              {m.email && (
                m.email.includes('*')
                  ? <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3" />{m.email}</span>
                  : <a href={`mailto:${m.email}`} className="inline-flex items-center gap-1 hover:text-brand-400"><Mail className="w-3 h-3" />{m.email}</a>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Rating">
          <RatingBadge rating={m.aggregate_rating} count={m.rating_count} />
        </Stat>
        <Stat label="Reliability">
          <ReliabilityBadge data={rel} />
        </Stat>
        <Stat label="Shifts here">
          {m.shifts_worked}
          {m.upcoming > 0 && <span className="text-xs text-slate-400 font-normal"> · {m.upcoming} upcoming</span>}
        </Stat>
        <Stat label="Your rating">
          {m.venue_rating_count > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
              {Number(m.venue_rating).toFixed(1)}
              <span className="text-xs text-slate-400 font-normal">({m.venue_rating_count})</span>
            </span>
          ) : (
            <span className="text-slate-500 font-normal text-xs">Not rated yet</span>
          )}
        </Stat>
      </div>

      {(rel?.commitments > 0 || againTotal > 0 || data.other_venues > 0) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
          {rel?.commitments > 0 && (
            <span>
              Everywhere: {rel.completed} worked · {rel.late} late · {rel.no_show} no-show · {rel.late_drop} late drop
            </span>
          )}
          {againTotal > 0 && (
            <span className="inline-flex items-center gap-1">
              <ThumbsUp className="w-3 h-3 text-emerald-400" /> {m.would_book_again_yes}
              <ThumbsDown className="w-3 h-3 text-rose-400 ml-1" /> {m.would_book_again_no} would book again
            </span>
          )}
          {data.other_venues > 0 && (
            <span className="inline-flex items-center gap-1">
              <Building2 className="w-3 h-3" /> Worked at {data.other_venues} other venue{data.other_venues === 1 ? '' : 's'}
            </span>
          )}
        </div>
      )}

      {m.positions?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {m.positions.map((p) => (
            <span key={p} className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] font-bold uppercase">{p}</span>
          ))}
        </div>
      )}

      {/* Phase 32: their own profile */}
      {(data.bio || data.skills?.length > 0 || data.departments?.length > 0) && (
        <div className="text-xs text-slate-300 space-y-1">
          {data.departments?.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-slate-400 mr-1">Departments:</span>
              {data.departments.map((k) => <DeptChip key={k} dept={k} />)}
            </div>
          )}
          {data.bio && <p className="whitespace-pre-line">{data.bio}</p>}
          {data.skills?.length > 0 && <p className="text-slate-400">Works as: <span className="text-slate-200">{data.skills.join(', ')}</span></p>}
        </div>
      )}

      {m.notes && (
        <p className="text-xs text-slate-200 whitespace-pre-line bg-amber-500/5 border border-amber-500/30 rounded-xl p-2.5">
          <span className="text-amber-300 font-semibold inline-flex items-center gap-1 mr-1"><StickyNote className="w-3 h-3" /> Private note:</span>
          {m.notes}
        </p>
      )}

      <ProfileExtras data={data} venueId={venueId} workerId={workerId} onReviewed={() => setReloadTick((t) => t + 1)} setConfirm={setConfirm} />

      <div>
        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">History here</div>
        {data.history.length === 0 ? (
          <p className="text-xs text-slate-500">Nothing at this venue yet.</p>
        ) : (
          <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl overflow-hidden">
            {data.history.map((h) => {
              const [label, cls] = HISTORY_LABEL[h.status] || [h.status, 'text-slate-300'];
              return (
                <div key={h.request_id} className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs bg-slate-950">
                  <span className="text-slate-400 w-24 flex-shrink-0">{fmtDate(h.start_time, timeZone)}</span>
                  <span className="text-slate-100 flex-1 min-w-[10rem]">
                    <span className="font-semibold">{h.role_type}</span> · {h.title}
                    <span className="text-slate-500"> · {fmtTimeRange(h.start_time, h.end_time, timeZone)}</span>
                  </span>
                  <span className={`font-semibold ${cls}`}>{label}</span>
                  {h.late_minutes > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-amber-300"><Clock className="w-3 h-3" /> {h.late_minutes} min late</span>
                  )}
                  {h.my_rating && (
                    <span className="inline-flex items-center gap-0.5 text-amber-400"><Star className="w-3 h-3 fill-amber-400" /> {h.my_rating}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}

const CERT_TONE = {
  verified: ['Verified', 'text-emerald-300', BadgeCheck],
  unverified: ['Not verified yet', 'text-sky-300', null],
  rejected: ['Not accepted', 'text-rose-300', XCircle],
};

/** Phase 31 + 32: certificates (verify / not accepted), availability, time off, emergency contact. */
function ProfileExtras({ data, venueId, workerId, onReviewed, setConfirm }) {
  const [busy, setBusy] = useState(null);
  const review = async (c, status, note = null) => {
    setBusy(c.id);
    try {
      await api.post(`/venues/${venueId}/people/${workerId}/certifications/${c.id}/review`, { status, note });
      onReviewed();
    } finally {
      setBusy(null);
    }
  };
  const askReject = (c) => setConfirm({
    title: `Don't accept this ${c.label.toLowerCase()}?`,
    message: 'They’ll be told what’s wrong so they can fix it. Shifts that need it stay locked for them until it’s fixed.',
    confirmLabel: 'Not accepted',
    danger: true,
    input: { label: 'What’s wrong?', placeholder: 'e.g. The photo is blurry, or the name doesn’t match', required: true },
    onConfirm: (note) => review(c, 'rejected', note),
  });
  const summary = availabilitySummary(data.availability);
  const sectionTitle = 'text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1';

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="sm:col-span-2">
        <div className={sectionTitle}><Award className="w-3.5 h-3.5" /> Certificates</div>
        {data.certifications?.length ? (
          <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl overflow-hidden">
            {data.certifications.map((c) => {
              const [label, tone, Icon] = CERT_TONE[c.status] || CERT_TONE.unverified;
              return (
                <div key={c.id} className="px-3 py-2 bg-slate-950 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="font-semibold text-slate-100">{c.label}</span>
                  <span className={`inline-flex items-center gap-0.5 font-semibold ${c.expired ? 'text-rose-300' : tone}`}>
                    {Icon && <Icon className="w-3 h-3" />} {c.expired ? 'Expired' : label}
                  </span>
                  {c.expires_on && <span className="text-slate-400">exp. {fmtDay(c.expires_on)}</span>}
                  {c.number && <span className="text-slate-500">No. {c.number}</span>}
                  {c.status === 'verified' && c.verified_venue_name && <span className="text-slate-500">by {c.verified_venue_name}</span>}
                  <span className="ml-auto flex items-center gap-1.5">
                    {c.file_id && (
                      <button type="button" onClick={() => openProtectedFile(c.file_id).catch(() => {})}
                        className="px-2 py-1 rounded-md border border-slate-700 text-slate-300 hover:text-white inline-flex items-center gap-1">
                        <FileText className="w-3 h-3" /> View
                      </button>
                    )}
                    {c.status !== 'verified' && (
                      <button type="button" disabled={busy === c.id} onClick={() => review(c, 'verified')}
                        className="px-2 py-1 rounded-md bg-brand-500 hover:bg-brand-400 text-slate-950 font-bold disabled:opacity-50">
                        Verify
                      </button>
                    )}
                    {c.status !== 'rejected' && (
                      <button type="button" disabled={busy === c.id} onClick={() => askReject(c)}
                        className="px-2 py-1 rounded-md border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 disabled:opacity-50">
                        Not accepted
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-slate-500">None added.</p>
        )}
      </div>

      <div>
        <div className={sectionTitle}><CalendarDays className="w-3.5 h-3.5" /> Usually available</div>
        {summary.length ? (
          <ul className="text-xs text-slate-300 space-y-0.5">
            {summary.map((d) => <li key={d.day}><span className="text-slate-500 w-9 inline-block">{d.day}</span> {d.ranges.join(', ')}</li>)}
          </ul>
        ) : (
          <p className="text-xs text-slate-500">Not set.</p>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <div className={sectionTitle}><CalendarOff className="w-3.5 h-3.5" /> Time off</div>
          {data.time_off?.length ? (
            <ul className="text-xs space-y-0.5">
              {data.time_off.map((t) => (
                <li key={t.id} className="text-slate-200">
                  {t.summary}
                  {t.reason && <span className="text-slate-400"> · {t.reason}</span>}
                  {t.conflicts?.length > 0 && <span className="block text-amber-300">Booked here then: {t.conflicts.join('; ')}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">Nothing coming up.</p>
          )}
        </div>
        {(data.emergency_contact_name || data.emergency_contact_phone) && (
          <div>
            <div className={sectionTitle}><HeartPulse className="w-3.5 h-3.5" /> Emergency contact</div>
            <p className="text-xs text-slate-200">
              {data.emergency_contact_name}
              {data.emergency_contact_phone && (
                <a href={`tel:${data.emergency_contact_phone}`} className="ml-2 text-brand-300 hover:underline">{data.emergency_contact_phone}</a>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** A modal that only shows the profile (activity log, Team page). */
export function WorkerProfileModal({ venueId, workerId, timeZone, onClose }) {
  return (
    <ModalShell title="Worker profile" onClose={onClose} maxWidth="max-w-2xl">
      <WorkerProfilePanel venueId={venueId} workerId={workerId} timeZone={timeZone} />
    </ModalShell>
  );
}
