import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Wallet, Clock, CalendarCheck, Download, Info, Coins, AlertTriangle, Pencil, Timer, ChevronLeft, Building2,
} from 'lucide-react';
import api from '../api/client';
import { money, hoursText, dayText, PERIODS } from '../utils/earnings';
import { downloadFile } from '../utils/download';
import { fmtDate, fmtTime } from '../utils/venueTime';

function Tile({ icon: Icon, label, value, sub }) {
  return (
    <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
        <Icon className="w-3.5 h-3.5 text-emerald-400" /> {label}
      </div>
      <div className="mt-1 text-2xl font-black text-white">{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

/**
 * Phase 33.1: a worker's own hours & pay. GET /api/me/earnings?period=…  (weeks start on Monday)
 * Pay = hours from clock-in to clock-out × the rate for that shift, before tips and taxes.
 */
export default function EarningsPage() {
  const [period, setPeriod] = useState('week');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    api.get('/me/earnings', { params: { period } })
      .then((res) => { if (alive) setData(res.data); })
      .catch((err) => {
        if (!alive) return;
        setData(null);          // never show another period's numbers under this period's name
        setError(err.response?.data?.detail || "Couldn't load your hours. Check your connection and try again.");
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period]);

  // group shifts by day (in each venue's time)
  const days = useMemo(() => {
    const groups = [];
    for (const s of data?.shifts || []) {
      const label = fmtDate(s.clock_in_time, s.venue_timezone);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(s);
      else groups.push({ label, items: [s] });
    }
    return groups;
  }, [data]);

  const download = async () => {
    setDownloading(true);
    try {
      await downloadFile('/me/earnings.csv', { period }, 'my-hours.csv');
    } catch (err) {
      setError(err.response?.data?.detail || "Couldn't download your hours. Try again.");
    } finally {
      setDownloading(false);
    }
  };

  const up = data?.upcoming || {};
  return (
    <div className="w-full min-h-screen bg-slate-950 text-slate-100 pb-16">
      <section className="bg-slate-900 border-b border-slate-800 py-6 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto w-full">
          <Link to="/worker" className="text-xs text-slate-400 hover:text-white inline-flex items-center gap-1 mb-2">
            <ChevronLeft className="w-3.5 h-3.5" /> My shifts
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-bold text-white flex items-center gap-2"><Wallet className="w-6 h-6 text-emerald-400" /> Hours & pay</h1>
            <button type="button" onClick={download} disabled={downloading || !data}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5 disabled:opacity-50">
              <Download className="w-4 h-4 text-emerald-400" /> {downloading ? 'Downloading…' : 'Download (spreadsheet)'}
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {PERIODS.map((p) => (
              <button key={p.id} type="button" onClick={() => setPeriod(p.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                  period === p.id ? 'bg-emerald-500 text-slate-950' : 'bg-slate-950 text-slate-300 border border-slate-800 hover:border-slate-600'}`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <main className="max-w-4xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-6 space-y-5">
        {error && <div className="p-3 rounded-xl border border-rose-700 bg-rose-950/70 text-rose-200 text-sm">{error}</div>}
        {loading && !data && <p className="py-16 text-center text-sm text-slate-500">Loading your hours…</p>}

        {data && (
          <>
            <p className="text-xs text-slate-400">
              {data.label}: {dayText(data.start_date)} – {dayText(data.end_date)}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Tile icon={Clock} label="Hours" value={hoursText(data.total_hours)} sub={`${data.shifts_worked} shift${data.shifts_worked === 1 ? '' : 's'} worked`} />
              <Tile icon={Coins} label="Pay" value={money(data.total_pay)} sub="Before tips and taxes" />
              <Tile icon={CalendarCheck} label="Still coming" value={up.shifts ? money(up.est_pay) : '—'}
                sub={up.shifts ? `${up.shifts} booked shift${up.shifts === 1 ? '' : 's'} · about ${hoursText(up.hours)}` : 'Nothing else booked in this period'} />
            </div>

            {data.in_progress > 0 && (
              <div className="p-3 rounded-xl border border-emerald-700/60 bg-emerald-950/40 text-emerald-200 text-xs flex items-start gap-2">
                <Timer className="w-4 h-4 flex-shrink-0" /> You're clocked in now. That shift counts once you clock out.
              </div>
            )}

            {data.venues.length > 1 && (
              <section className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">By venue</h2>
                <div className="divide-y divide-slate-800">
                  {data.venues.map((v) => (
                    <div key={v.venue_id} className="py-2 flex items-center gap-3 text-sm">
                      <Building2 className="w-4 h-4 text-slate-500 flex-shrink-0" />
                      <span className="flex-1 min-w-0 truncate text-white">{v.name}</span>
                      <span className="text-slate-400">{hoursText(v.hours)}</span>
                      <span className="w-24 text-right font-bold text-emerald-400">{money(v.pay)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="space-y-4">
              {days.length === 0 && (
                <div className="py-12 text-center rounded-2xl border border-slate-800 bg-slate-900/40">
                  <Clock className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                  <p className="text-sm font-semibold text-slate-300">No clock-ins in this period</p>
                  <p className="text-xs text-slate-500 mt-1">Hours show up here after you clock in and out of a shift.</p>
                </div>
              )}
              {days.map((d) => (
                <div key={d.label}>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">{d.label}</h3>
                  <div className="space-y-2">
                    {d.items.map((s) => (
                      <div key={s.entry_id} className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold text-white truncate">{s.event_title}</div>
                          <div className="text-xs text-slate-400 truncate">{s.role_type} · {s.venue_name}</div>
                          <div className="text-xs text-slate-300 mt-1">
                            {fmtTime(s.clock_in_time, s.venue_timezone)} – {s.in_progress ? 'now' : fmtTime(s.clock_out_time, s.venue_timezone)}
                            {!s.in_progress && <span className="text-slate-500"> · {hoursText(s.hours)} × {money(s.rate)}/hr</span>}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {s.tips_eligible && <span className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px] font-semibold">Gets tips</span>}
                            {s.rate_custom && <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-[10px] font-semibold">Your rate for this shift</span>}
                            {s.edited && <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 text-[10px] font-semibold inline-flex items-center gap-0.5"><Pencil className="w-2.5 h-2.5" /> Time changed by a manager</span>}
                            {s.auto_closed && <span className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px] font-semibold inline-flex items-center gap-0.5"><AlertTriangle className="w-2.5 h-2.5" /> Clocked out automatically</span>}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-base font-black text-emerald-400">{s.in_progress ? '—' : money(s.pay)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </section>

            <p className="text-[11px] text-slate-500 flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>
                Worked out from your clock-in and clock-out times × your pay rate, before tips and taxes
                {data.any_tips ? ' (tips aren’t tracked here yet)' : ''}. Your venue’s payroll is the final word. If a time looks wrong, ask the
                manager to fix it on their time sheet. Weeks start on Monday.
              </span>
            </p>
          </>
        )}
      </main>
    </div>
  );
}
