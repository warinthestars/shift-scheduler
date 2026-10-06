import React, { useCallback, useEffect, useState } from 'react';
import {
  CalendarRange, Lock, Unlock, Download, Check, AlertTriangle, Clock, Settings, ChevronRight, Timer, Building2,
} from 'lucide-react';
import api from '../../api/client';
import ModalShell from '../ModalShell';
import { downloadFile } from '../../utils/download';
import { fmtShortDate, fmtTime } from '../../utils/venueTime';

/**
 * Phase 35: Pay periods. The current period and the ones before it, with hours, overtime and pay per person.
 * After a period ends a manager approves it, which locks its times and pay rates until someone reopens it (with a reason).
 * Props: venueId, venueName, onClose(), onOpenSettings() (Venue settings → Time & pay periods), onChanged()
 */
const STATE_CHIP = {
  current: ['In progress', 'bg-sky-500/10 text-sky-300 border-sky-500/30'],
  ready: ['Ready to approve', 'bg-amber-500/15 text-amber-200 border-amber-500/40'],
  approved: ['Approved · locked', 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'],
  not_required: ['Ended', 'bg-slate-800 text-slate-300 border-slate-700'],
  empty: ['No hours', 'bg-slate-900 text-slate-500 border-slate-800'],
};
const PERIOD_TEXT = {
  weekly: 'Weekly', biweekly: 'Every two weeks', semimonthly: 'Twice a month', monthly: 'Monthly',
};
const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hrs = (n) => `${Number(n || 0).toFixed(2)} h`;
const btnGhost = 'px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40';

function StateChip({ state }) {
  const [label, cls] = STATE_CHIP[state] || STATE_CHIP.not_required;
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border inline-flex items-center gap-1 ${cls}`}>
      {state === 'approved' && <Lock className="w-3 h-3" />} {label}
    </span>
  );
}

export default function PayPeriodsModal({ venueId, venueName, onClose, onOpenSettings, onChanged }) {
  const [list, setList] = useState(null);
  const [selected, setSelected] = useState(null);     // start_date
  const [company, setCompany] = useState('');
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState('');
  const tz = list?.timezone;

  const loadList = useCallback(async (keepSelected) => {
    try {
      const res = await api.get(`/venues/${venueId}/pay-periods`, { params: { count: 8 } });
      setList(res.data);
      const periods = res.data.periods || [];
      if (!keepSelected) {
        // Open the most recent period that needs approving, else the last finished one, else the current one
        const pick = periods.find((p) => p.state === 'ready') || periods[1] || periods[0];
        setSelected(pick ? pick.start_date : null);
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not load pay periods.');
    }
  }, [venueId]);

  const loadDetail = useCallback(async () => {
    if (!selected) return;
    setLoadingDetail(true);
    try {
      const res = await api.get(`/venues/${venueId}/pay-periods/${selected}`, { params: company ? { company } : {} });
      setDetail(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not load that pay period.');
    } finally {
      setLoadingDetail(false);
    }
  }, [venueId, selected, company]);

  useEffect(() => { loadList(false); }, [loadList]);
  useEffect(() => {
    setConfirmApprove(false);
    setReopening(false);
    setReason('');
    loadDetail();
  }, [loadDetail]);

  const act = async (fn, okText) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(okText);
      setConfirmApprove(false);
      setReopening(false);
      setReason('');
      await Promise.all([loadList(true), loadDetail()]);
      onChanged && onChanged();
    } catch (err) {
      setError(err.response?.data?.detail || 'That did not save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const approve = () => act(() => api.post(`/venues/${venueId}/pay-periods/${selected}/approve`),
    'Approved and locked. Times and pay rates in this period can no longer be changed.');
  const reopen = () => {
    if (reason.trim().length < 3) return setError("Say why you're reopening it.");
    return act(() => api.post(`/venues/${venueId}/pay-periods/${selected}/reopen`, { reason: reason.trim() }),
      'Reopened. Fix the times, then approve it again.');
  };
  const download = async () => {
    if (!detail) return;
    try {
      const params = { start: detail.start_date, end: detail.end_date };
      if (company) params.company = company;
      const safe = company ? `-${company.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}` : '';
      await downloadFile(`/venues/${venueId}/payroll/export`, params, `hours-${detail.start_date}${safe}.csv`);
    } catch (err) {
      setError(err.response?.data?.detail || "Couldn't download the hours. Try again.");
    }
  };

  const periods = list?.periods || [];

  return (
    <ModalShell
      title="Pay periods"
      subtitle={list ? `${venueName || 'This venue'} · ${PERIOD_TEXT[list.pay_period] || list.pay_period} · ${list.overtime_text}` : venueName}
      icon={<CalendarRange className="w-5 h-5 text-brand-400" />}
      onClose={onClose}
      maxWidth="max-w-6xl"
      footer={(
        <>
          {onOpenSettings && (
            <button type="button" onClick={onOpenSettings} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm text-slate-300 mr-auto inline-flex items-center gap-1.5">
              <Settings className="w-4 h-4" /> Pay period & overtime settings
            </button>
          )}
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm text-slate-300">Done</button>
        </>
      )}
    >
      {error && <div className="mb-3 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">{error}</div>}
      {notice && <div className="mb-3 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-200 text-sm">{notice}</div>}
      {!list ? (
        <p className="text-sm text-slate-500 text-center py-10">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[18rem_1fr] gap-4">
          {/* Periods */}
          <div className="space-y-2">
            {!list.approval_on && (
              <p className="text-[11px] text-slate-400 p-2 rounded-lg border border-slate-800 bg-slate-950">
                Approving pay periods is off. Turn it on in Settings → Time & pay periods to lock finished periods.
              </p>
            )}
            {periods.map((p) => (
              <button key={p.start_date} type="button" onClick={() => { setSelected(p.start_date); setNotice(''); setError(''); }}
                className={`w-full text-left p-3 rounded-xl border transition ${selected === p.start_date ? 'border-brand-500/60 bg-brand-500/5' : 'border-slate-800 bg-slate-950 hover:border-slate-600'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-white">{p.label}</span>
                  <ChevronRight className="w-4 h-4 text-slate-500" />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <StateChip state={p.state} />
                  {p.open_entries > 0 && p.state !== 'approved' && (
                    <span className="text-[10px] text-amber-300 inline-flex items-center gap-0.5"><AlertTriangle className="w-3 h-3" /> {p.open_entries} open</span>
                  )}
                </div>
                <div className="mt-1 text-[11px] text-slate-400">
                  {p.people} {p.people === 1 ? 'person' : 'people'} · {hrs(p.total_hours)}
                  {p.overtime_hours > 0 && <span className="text-orange-300"> · OT {hrs(p.overtime_hours)}</span>}
                  {' · '}{money(p.total_pay)}
                  {p.total_tips > 0 && <span className="text-amber-300"> · tips {money(p.total_tips)}</span>}
                </div>
              </button>
            ))}
          </div>

          {/* One period */}
          <div className="min-w-0">
            {!detail ? (
              <p className="text-sm text-slate-500 text-center py-10">{loadingDetail ? 'Loading…' : 'Pick a pay period.'}</p>
            ) : (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-bold text-white">{detail.label}</h3>
                      <StateChip state={detail.state} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {list.companies.length > 0 && (
                        <select aria-label="Company" value={company} onChange={(e) => setCompany(e.target.value)}
                          className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white">
                          <option value="">Everyone</option>
                          {list.companies.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      )}
                      <button type="button" onClick={download} className={btnGhost}><Download className="w-3.5 h-3.5" /> Download</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {[
                      ['People', detail.people],
                      ['Hours', hrs(detail.total_hours)],
                      ['Overtime', hrs(detail.overtime_hours)],
                      ['Pay before tips', money(detail.total_pay)],
                      ['Tips', money(detail.total_tips)],                                // Phase 35.2
                    ].map(([k, v]) => (
                      <div key={k} className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{k}</div>
                        <div className={`text-base font-bold ${k === 'Overtime' && detail.overtime_hours > 0 ? 'text-orange-300' : 'text-white'}`}>{v}</div>
                      </div>
                    ))}
                  </div>
                  {company && <p className="text-[11px] text-sky-300">Showing only people who work through {company}.</p>}

                  {/* Approve / reopen */}
                  {detail.state === 'approved' ? (
                    <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 space-y-2">
                      <p className="text-xs text-emerald-100 flex items-start gap-1.5">
                        <Lock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                        <span>
                          Approved{detail.approved_by ? ` by ${detail.approved_by}` : ''}{detail.approved_at ? ` on ${fmtShortDate(detail.approved_at, tz)} at ${fmtTime(detail.approved_at, tz)}` : ''}.
                          Times and pay rates in this period are locked.
                        </span>
                      </p>
                      {!reopening ? (
                        <button type="button" onClick={() => setReopening(true)} className={btnGhost}><Unlock className="w-3.5 h-3.5" /> Reopen to fix something</button>
                      ) : (
                        <div className="space-y-2">
                          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus
                            placeholder="Why? e.g. Bo's Monday clock-out was wrong"
                            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white" />
                          <div className="flex gap-2">
                            <button type="button" onClick={reopen} disabled={busy}
                              className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50">
                              <Unlock className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Reopen'}
                            </button>
                            <button type="button" onClick={() => { setReopening(false); setReason(''); }} className={btnGhost}>Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : detail.state === 'ready' ? (
                    <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 space-y-2">
                      {detail.blocked_reason ? (
                        <p className="text-xs text-amber-100 flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {detail.blocked_reason}</p>
                      ) : !confirmApprove ? (
                        <div className="flex flex-wrap items-center gap-3">
                        <button type="button" onClick={() => setConfirmApprove(true)}
                          className="px-4 py-2 rounded-xl bg-brand-500 hover:bg-brand-400 text-slate-950 text-sm font-bold inline-flex items-center gap-1.5">
                          <Check className="w-4 h-4" /> Approve and lock
                        </button>
                        <span className="text-xs text-amber-100/80">Check the hours below first. After approving, times and pay rates in this period are locked.</span>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-amber-100 flex-1 min-w-[14rem]">
                            Lock {detail.label}? {hrs(detail.total_hours)} and {money(detail.total_pay)} are saved with the approval, and nobody can change
                            times or pay rates in it until it's reopened.
                          </span>
                          <button type="button" onClick={approve} disabled={busy}
                            className="px-3 py-1.5 rounded-lg bg-brand-500 hover:bg-brand-400 text-slate-950 text-xs font-bold disabled:opacity-50">
                            {busy ? 'Saving…' : 'Approve and lock'}
                          </button>
                          <button type="button" onClick={() => setConfirmApprove(false)} className={btnGhost}>Cancel</button>
                        </div>
                      )}
                      {company && !detail.blocked_reason && <p className="text-[11px] text-slate-400">Approving locks the whole period for everyone, not just {company}.</p>}
                    </div>
                  ) : detail.blocked_reason ? (
                    <p className="text-xs text-slate-400 flex items-start gap-1.5"><Clock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {detail.blocked_reason}</p>
                  ) : null}
                  {detail.last_reopened_at && (
                    <p className="text-[11px] text-slate-500">
                      Last reopened {fmtShortDate(detail.last_reopened_at, tz)}: “{detail.last_reopen_reason}”
                    </p>
                  )}
                </div>

                {/* People */}
                <div className="rounded-xl border border-slate-800 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-950 text-slate-400">
                      <tr>
                        <th className="text-left font-semibold px-3 py-2">Person</th>
                        <th className="text-right font-semibold px-2 py-2">Shifts</th>
                        <th className="text-right font-semibold px-2 py-2">Regular</th>
                        <th className="text-right font-semibold px-2 py-2">Overtime</th>
                        <th className="text-right font-semibold px-2 py-2">Total</th>
                        <th className="text-right font-semibold px-2 py-2">Pay</th>
                        <th className="text-right font-semibold px-3 py-2">Tips</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {detail.rows.length === 0 && (
                        <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">No ShiftUp clock-ins in this period.</td></tr>
                      )}
                      {detail.rows.map((r) => (
                        <tr key={r.worker_id} className="bg-slate-900/40">
                          <td className="px-3 py-2">
                            <div className="font-semibold text-white">{r.name}</div>
                            <div className="flex flex-wrap items-center gap-1 mt-0.5">
                              {r.works_through && (
                                <span className="px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/30 text-[9px] font-bold inline-flex items-center gap-0.5">
                                  <Building2 className="w-2.5 h-2.5" /> {r.works_through}
                                </span>
                              )}
                              {r.open_entries > 0 && <span className="text-[10px] text-amber-300">{r.open_entries} still open</span>}
                              {r.edited_entries > 0 && <span className="text-[10px] text-amber-200/80">{r.edited_entries} edited</span>}
                              {r.auto_closed > 0 && <span className="text-[10px] text-rose-300">{r.auto_closed} auto-closed</span>}
                              {r.outside_area > 0 && <span className="text-[10px] text-amber-300">{r.outside_area} outside the area</span>}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-right text-slate-300">{r.shifts}</td>
                          <td className="px-2 py-2 text-right text-slate-300">{r.regular_hours.toFixed(2)}</td>
                          <td className={`px-2 py-2 text-right ${r.overtime_hours > 0 ? 'text-orange-300 font-bold' : 'text-slate-500'}`}>{r.overtime_hours.toFixed(2)}</td>
                          <td className="px-2 py-2 text-right text-white font-semibold">{r.hours.toFixed(2)}</td>
                          <td className="px-2 py-2 text-right text-brand-400 font-semibold">{money(r.pay)}</td>
                          <td className={`px-3 py-2 text-right ${r.tips > 0 ? 'text-amber-300 font-semibold' : 'text-slate-600'}`}>{r.tips > 0 ? money(r.tips) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-slate-500">
                  Pay is hours × each person's rate, before tips. Overtime is flagged, not paid extra here: your payroll adds any premium.
                  Tips (own tips + tip-pool shares, entered on each event's time sheet) count on the day the shift starts.
                </p>

                {detail.payroll_rows.length > 0 && (
                  <div className="p-3 rounded-xl border border-violet-500/30 bg-violet-500/5 space-y-2">
                    <div className="text-xs font-bold text-violet-200 inline-flex items-center gap-1.5">
                      <Timer className="w-3.5 h-3.5" /> Tracked by your venue's payroll ({detail.payroll_shifts} shift{detail.payroll_shifts === 1 ? '' : 's'})
                    </div>
                    <p className="text-[11px] text-violet-100/70">These people clock in with your own system, so their hours aren't counted above. Scheduled hours are shown to check against it.</p>
                    <div className="divide-y divide-violet-500/20">
                      {detail.payroll_rows.map((r) => (
                        <div key={r.worker_id} className="py-1.5 flex items-center justify-between text-xs">
                          <span className="text-white font-semibold">{r.name}</span>
                          <span className="text-violet-200">
                            {r.shifts} shift{r.shifts === 1 ? '' : 's'} · {hrs(r.scheduled_hours)} scheduled
                            {r.tips > 0 && <span className="text-amber-300"> · tips {money(r.tips)}</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </ModalShell>
  );
}
