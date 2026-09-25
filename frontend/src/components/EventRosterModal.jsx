import React from 'react';
import { X, Users, Clock, Check, MessageSquare, Phone, Mail, UserPlus } from 'lucide-react';
import TipBadge from './TipBadge';
import ReliabilityBadge from './ReliabilityBadge';
import { fmtDate, fmtTimeRange, fmtDateTime } from '../utils/venueTime';

const STATUS_LABEL = {
  approved: 'Confirmed',
  confirmed: 'Confirmed',
  checked_in: 'Clocked in',
  completed: 'Completed',
};

function assignedChip(person) {
  if (person.clocked_out || person.status === 'completed') {
    return { label: 'Completed', cls: 'bg-slate-700/40 text-slate-300 border-slate-600/40' };
  }
  if (person.clocked_in || person.status === 'checked_in') {
    return { label: 'Clocked in', cls: 'bg-sky-500/10 text-sky-300 border-sky-500/30' };
  }
  return { label: STATUS_LABEL[person.status] || 'Confirmed', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' };
}

export default function EventRosterModal({
  event,
  onClose,
  reliabilityMap = {},
  onApprove,
  onDeny,
  onOpenBoard,
  actionLoading,
  timeZone,
}) {
  if (!event) return null;

  const dateStr = fmtDate(event.start_time, timeZone);
  const timeStr = fmtTimeRange(event.start_time, event.end_time, timeZone);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full p-6 shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-start pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center space-x-2 mb-1">
              <Users className="w-5 h-5 text-emerald-400" />
              <h3 className="text-lg font-bold text-white">{event.title}</h3>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
              <span className="flex items-center space-x-1">
                <Clock className="w-3.5 h-3.5 text-slate-500" />
                <span>{dateStr} • {timeStr}</span>
              </span>
              <span>
                Staffed: <strong className="text-white">{event.total_assigned} / {event.total_capacity}</strong>
              </span>
              {event.total_requested > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 font-semibold">
                  {event.total_requested} awaiting review
                </span>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 pt-4 space-y-5 pr-1">
          {event.positions.map((pos) => {
            const isFull = pos.assigned.length >= pos.capacity;
            return (
              <div key={pos.shift_id} className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-slate-800/40 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[11px] font-bold uppercase">{pos.role_type}</span>
                    <span className="text-xs text-emerald-400 font-semibold">${Number(pos.hourly_rate).toFixed(2)}/hr</span>
                    <TipBadge shift={pos} />
                    <span className={`text-xs font-semibold ${isFull ? 'text-emerald-400' : 'text-slate-300'}`}>
                      {pos.assigned.length} / {pos.capacity} filled
                    </span>
                  </div>
                  {onOpenBoard && (
                    <button
                      type="button"
                      onClick={() => onOpenBoard({ id: pos.shift_id, title: event.title, role_type: pos.role_type })}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 hover:text-white text-xs border border-slate-700 transition inline-flex items-center space-x-1"
                    >
                      <MessageSquare className="w-3 h-3" />
                      <span>Board</span>
                    </button>
                  )}
                </div>

                <div className="p-4 space-y-4">
                  <div>
                    <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                      Assigned ({pos.assigned.length})
                    </div>
                    {pos.assigned.length === 0 ? (
                      <p className="text-xs text-slate-500 italic">No one assigned yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {pos.assigned.map((p) => {
                          const chip = assignedChip(p);
                          return (
                            <div key={p.request_id} className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                              <div>
                                <div className="text-sm font-semibold text-white">{p.first_name} {p.last_name}</div>
                                <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 mt-0.5">
                                  {p.phone && (
                                    <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1 hover:text-emerald-400">
                                      <Phone className="w-3 h-3" />{p.phone}
                                    </a>
                                  )}
                                  {p.email && (
                                    <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1 hover:text-emerald-400">
                                      <Mail className="w-3 h-3" />{p.email}
                                    </a>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-amber-400 text-xs font-bold">★ {Number(p.aggregate_rating).toFixed(1)}</span>
                                <ReliabilityBadge data={reliabilityMap[p.worker_id]} />
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${chip.cls}`}>{chip.label}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <UserPlus className="w-3.5 h-3.5 text-amber-400" />
                      <span>Requested ({pos.requested.length})</span>
                    </div>
                    {pos.requested.length === 0 ? (
                      <p className="text-xs text-slate-500 italic">No pending requests for this position.</p>
                    ) : (
                      <div className="space-y-2">
                        {pos.requested.map((p) => {
                          const approving = actionLoading === `approve-${p.request_id}`;
                          const denying = actionLoading === `deny-${p.request_id}`;
                          return (
                            <div key={p.request_id} className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-amber-500/5 rounded-lg border border-amber-500/20">
                              <div>
                                <div className="text-sm font-semibold text-white">{p.first_name} {p.last_name}</div>
                                <div className="text-[11px] text-slate-400 mt-0.5">
                                  Requested {fmtDateTime(p.requested_at, timeZone)}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-amber-400 text-xs font-bold">★ {Number(p.aggregate_rating).toFixed(1)}</span>
                                <ReliabilityBadge data={reliabilityMap[p.worker_id]} />
                                <button
                                  type="button"
                                  onClick={() => onApprove && onApprove(p.request_id)}
                                  disabled={isFull || approving || denying}
                                  title={isFull ? 'Position is full' : 'Approve'}
                                  className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition inline-flex items-center gap-1 disabled:opacity-40"
                                >
                                  <Check className="w-3 h-3" />
                                  <span>{approving ? '…' : 'Approve'}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onDeny && onDeny(p.request_id)}
                                  disabled={approving || denying}
                                  className="px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white text-xs font-bold border border-rose-600/30 transition inline-flex items-center gap-1 disabled:opacity-40"
                                >
                                  <X className="w-3 h-3" />
                                  <span>{denying ? '…' : 'Deny'}</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
