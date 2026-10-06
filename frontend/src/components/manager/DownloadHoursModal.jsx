import React, { useEffect, useState } from 'react';
import { Download, CalendarRange } from 'lucide-react';
import api from '../../api/client';
import ModalShell from '../ModalShell';
import { downloadFile, rangePresets } from '../../utils/download';
import { dayText } from '../../utils/earnings';

/**
 * Phase 33.1: "Download hours" for managers. Pick a range, get a spreadsheet (.csv) of every clock-in with
 * hours and pay before tips. Times and dates are in the venue's own time zone.
 * Props: venueId, venueName, onClose(), onDone(message), onError(message)
 * Phase 35: optional staffing-company filter; the file also has Regular hours, Overtime hours and Works through.
 */
export default function DownloadHoursModal({ venueId, venueName, onClose, onDone, onError }) {
  const presets = rangePresets();
  const [pick, setPick] = useState('last_week');
  const [custom, setCustom] = useState({ start: presets[1].start, end: presets[1].end });
  const [busy, setBusy] = useState(false);
  const [companies, setCompanies] = useState([]);   // Phase 35
  const [company, setCompany] = useState('');

  useEffect(() => {
    let active = true;
    api.get(`/venues/${venueId}/pay-periods`, { params: { count: 1 } })
      .then((res) => active && setCompanies(res.data?.companies || []))
      .catch(() => active && setCompanies([]));
    return () => { active = false; };
  }, [venueId]);

  const range = pick === 'custom' ? custom : presets.find((p) => p.id === pick);
  const invalid = pick === 'custom' && (!custom.start || !custom.end || custom.end < custom.start);

  const download = async () => {
    setBusy(true);
    try {
      const params = {};
      if (range.start) params.start = range.start;
      if (range.end) params.end = range.end;
      if (company) params.company = company;                                       // Phase 35
      const safe = company ? `-${company.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}` : '';
      await downloadFile(`/venues/${venueId}/payroll/export`, params, `hours-and-pay${safe}.csv`);
      onDone('Hours downloaded. Open it in Excel, Numbers or Google Sheets.');
      onClose();
    } catch (err) {
      onError(err.response?.data?.detail || "Couldn't download the hours. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const chip = (on) => `px-3 py-2 rounded-xl text-xs font-bold border transition ${
    on ? 'bg-brand-500 text-slate-950 border-brand-500' : 'bg-slate-950 text-slate-300 border-slate-700 hover:border-slate-500'}`;

  return (
    <ModalShell
      title="Download hours"
      subtitle={`${venueName || 'This venue'}: every clock-in with hours and pay before tips, as a spreadsheet.`}
      icon={<Download className="w-5 h-5 text-brand-400" />}
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={(
        <>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm text-slate-300 mr-auto">Close</button>
          <button type="button" onClick={download} disabled={busy || invalid}
            className="px-5 py-2 rounded-xl bg-brand-500 hover:bg-brand-400 text-slate-950 text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
            <Download className="w-4 h-4" /> {busy ? 'Downloading…' : 'Download'}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <button key={p.id} type="button" onClick={() => setPick(p.id)} className={chip(pick === p.id)}>{p.label}</button>
          ))}
          <button type="button" onClick={() => setPick('custom')} className={chip(pick === 'custom')}>
            <span className="inline-flex items-center gap-1"><CalendarRange className="w-3.5 h-3.5" /> Pick dates</span>
          </button>
        </div>
        {pick === 'custom' && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-semibold text-slate-300">From
              <input type="date" value={custom.start} onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value }))}
                className="mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white" />
            </label>
            <label className="block text-xs font-semibold text-slate-300">To
              <input type="date" value={custom.end} onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value }))}
                className="mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white" />
            </label>
          </div>
        )}
        {invalid && <p className="text-xs text-rose-300">Pick an end date on or after the start date.</p>}
        {companies.length > 0 && (
          <label className="block text-xs font-semibold text-slate-300">Who
            <select value={company} onChange={(e) => setCompany(e.target.value)}
              className="mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white">
              <option value="">Everyone</option>
              {companies.map((c) => <option key={c} value={c}>Only people who work through {c}</option>)}
            </select>
          </label>
        )}
        <p className="text-xs text-slate-400">
          {range.start ? `${dayText(range.start)} – ${dayText(range.end)}` : 'All clock-ins at this venue'}. Weeks start on Monday. Times are in
          the venue's time zone. Overtime follows your Time & pay settings. Tips are in the last three columns (on each shift's
          first clock-in). People your venue's own payroll tracks don't clock in here, so they only appear on a "tips only"
          row when they got tips.
        </p>
      </div>
    </ModalShell>
  );
}
