import React, { useState } from 'react';
import { LifeBuoy, Users, Globe, Info } from 'lucide-react';
import api from '../../api/client';
import ModalShell from '../ModalShell';
import PayLabel from '../PayLabel';
import { fmtDateTime } from '../../utils/venueTime';

/**
 * Phase 34: Ask for cover on one of my booked shifts.
 * The worker picks who can see it: their team at this venue, or the team AND the public shift board
 * (only when the venue allows it). They stay booked until someone takes it.
 * Props: req (ShiftRequestResponse), onClose, onPosted(message)
 */
export default function CoverDialog({ req, onClose, onPosted }) {
  const shift = req.shift || {};
  const venue = shift.venue || {};
  const publicAllowed = venue.allow_public_cover !== false;
  const [audience, setAudience] = useState('team');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/cover', { request_id: req.id, audience, note: note.trim() || null });
      onPosted(res.data?.message || 'Cover request posted.');
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not post your cover request.');
    } finally {
      setBusy(false);
    }
  };

  const option = (id, Icon, title, text, disabled = false) => (
    <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${
      disabled ? 'opacity-50 cursor-not-allowed border-slate-800'
        : audience === id ? 'border-brand-500 bg-brand-500/10' : 'border-slate-700 hover:border-slate-500'}`}>
      <input type="radio" name="cover-audience" value={id} checked={audience === id} disabled={disabled}
        onChange={() => setAudience(id)} className="mt-1 accent-brand-500" />
      <Icon className="w-4 h-4 mt-0.5 text-brand-300 flex-shrink-0" />
      <span className="text-xs">
        <span className="block font-bold text-white text-sm">{title}</span>
        <span className="text-slate-400">{text}</span>
      </span>
    </label>
  );

  return (
    <ModalShell
      title="Ask for cover"
      icon={<LifeBuoy className="w-5 h-5 text-brand-400" />}
      onClose={onClose}
      maxWidth="max-w-md"
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 rounded-xl bg-slate-800 text-sm text-slate-300 hover:bg-slate-700">
            Close
          </button>
          <button type="button" onClick={submit} disabled={busy}
            className="px-5 py-2 rounded-xl bg-brand-500 hover:bg-brand-400 text-slate-950 text-sm font-bold disabled:opacity-50">
            {busy ? 'Posting…' : 'Post cover request'}
          </button>
        </>
      )}
    >
      <div className="space-y-3">
        {error && <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-sm">{error}</div>}
        <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs space-y-1">
          <p className="font-bold text-white">{shift.title}</p>
          <p className="text-slate-400">
            {venue.name} · {shift.role_type} · <PayLabel rate={shift.hourly_rate} rateMax={shift.hourly_rate_max} />
          </p>
          <p className="text-slate-500">{fmtDateTime(shift.start_time, venue.timezone)}</p>
        </div>
        <div className="space-y-2" role="radiogroup" aria-label="Who can see it">
          <p className="text-xs font-semibold text-slate-300">Who can see it</p>
          {option('team', Users, `My team at ${venue.name || 'this venue'}`,
            'People on the venue team get a notification if it fits their departments.')}
          {option('public', Globe, 'My team + everyone on the ShiftBoard',
            publicAllowed
              ? 'Also listed on the ShiftBoard for anyone. People outside the team need the manager to approve.'
              : `${venue.name || 'This venue'} only allows asking the team.`,
            !publicAllowed)}
        </div>
        <label className="block text-xs font-semibold text-slate-300">
          Note (optional)
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 300))}
            rows={2}
            placeholder="e.g. Family thing came up. Happy to swap for a Sunday."
            className="mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500"
          />
        </label>
        <p className="text-[11px] text-slate-400 bg-slate-950 border border-slate-800 rounded-xl p-2.5 flex gap-2">
          <Info className="w-4 h-4 text-slate-500 flex-shrink-0" />
          <span>
            You stay booked until someone takes it. If nobody does, we'll remind you 12 hours and 3 hours before
            the start. Asking for cover never counts against your reliability.
          </span>
        </p>
      </div>
    </ModalShell>
  );
}
