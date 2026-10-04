import React, { useState } from 'react';
import { Users, Check, X, MessageSquare, Phone, Mail, UserPlus, Pencil, EyeOff, FileText, UserMinus, Ban, Lock, BookOpenCheck, AlertTriangle, MapPin, Send, Clock, RotateCcw, LogOut, LifeBuoy, ListOrdered } from 'lucide-react';
import api from '../api/client';
import ModalShell from './ModalShell';
import RatingBadge from './RatingBadge';
import RateWorker from './RateWorker';
import StaffPositionModal from './StaffPositionModal';
import ConfirmDialog from './ConfirmDialog';
import TipBadge from './TipBadge';
import ReliabilityBadge from './ReliabilityBadge';
import PayLabel from './PayLabel';
import { fmtDate, fmtTimeRange, fmtDateTime } from '../utils/venueTime';

const APPROVAL_LABEL = { venue_default: 'Venue setting', auto: 'Book instantly', manual: 'Needs approval' };
const SOURCE_LABEL = { manager_assign: 'Assigned by manager', offer: 'Accepted an offer', cover: 'Covering for a teammate' };   // Phase 29 / 34
const OFFER_CHIP = {
  pending: { label: 'Waiting', cls: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30' },
  accepted: { label: 'Accepted', cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' },
  declined: { label: 'Declined', cls: 'bg-rose-500/10 text-rose-300 border-rose-500/30' },
  filled: { label: 'Someone else took it', cls: 'bg-slate-700/40 text-slate-300 border-slate-600/40' },
  cancelled: { label: 'Withdrawn', cls: 'bg-slate-700/40 text-slate-400 border-slate-600/40' },
};
const RATEABLE = ['approved', 'confirmed', 'checked_in', 'completed'];

function assignedChip(person) {
  if (person.clocked_out || person.status === 'completed') return { label: 'Completed', cls: 'bg-slate-700/40 text-slate-300 border-slate-600/40' };
  if (person.clocked_in || person.status === 'checked_in') return { label: 'Clocked in', cls: 'bg-sky-500/10 text-sky-300 border-sky-500/30' };
  return { label: 'Confirmed', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' };
}

export default function EventRosterModal({
  event, onClose, reliabilityMap = {}, onApprove, onDeny, onOpenBoard, onEdit, onRemovePerson, onCancelPosition, actionLoading, timeZone,
  venueId, onChanged,
}) {
  const [staffPos, setStaffPos] = useState(null);     // Phase 29: position being filled (Assign / Offer)
  const [flash, setFlash] = useState(null);           // Phase 29: { type, text }
  const [withdrawing, setWithdrawing] = useState(null);
  const [bookBack, setBookBack] = useState(null);     // Phase 29.4: { person, pos }
  if (!event) return null;
  const ended = new Date(event.end_time).getTime() < Date.now();

  const withdrawOffer = async (offerId) => {
    setWithdrawing(offerId);
    try {
      await api.delete(`/offers/${offerId}`);
      setFlash({ type: 'success', text: 'Offer withdrawn.' });
      if (onChanged) onChanged();
    } catch (err) {
      setFlash({ type: 'error', text: err.response?.data?.detail || 'Could not withdraw the offer.' });
    } finally {
      setWithdrawing(null);
    }
  };

  const subtitle = (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>{fmtDate(event.start_time, timeZone)} • {fmtTimeRange(event.start_time, event.end_time, timeZone)}</span>
      {event.location_name && (
        <span className="inline-flex items-center gap-1 text-emerald-300"><MapPin className="w-3 h-3" />{event.location_name}</span>
      )}
      <span>Staffed <strong className="text-white">{event.total_assigned}/{event.total_capacity}</strong></span>
      {event.total_requested > 0 && (
        <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 font-semibold">
          {event.total_requested} awaiting review
        </span>
      )}
    </span>
  );

  const headerExtra = (event.description || event.staff_notes || (onEdit && event.event_id)) ? (
    <div className="flex flex-col sm:flex-row sm:items-start gap-3">
      {(event.description || event.staff_notes) && (
        <div className="flex-1 space-y-2">
          {event.description && (
            <div className="text-xs text-slate-300 bg-slate-950 border border-slate-800 rounded-xl p-2.5 whitespace-pre-line">
              <span className="text-slate-500 font-semibold inline-flex items-center gap-1 mr-1"><FileText className="w-3 h-3" /> Event notes:</span>
              {event.description}
            </div>
          )}
          {event.staff_notes && (
            <div className="text-xs text-indigo-100 bg-indigo-500/5 border border-indigo-500/40 rounded-xl p-2.5 whitespace-pre-line">
              <span className="text-indigo-300 font-semibold inline-flex items-center gap-1 mr-1"><Lock className="w-3 h-3" /> Confirmed staff only:</span>
              {event.staff_notes}
            </div>
          )}
        </div>
      )}
      {onEdit && event.event_id && (
        <button type="button" onClick={() => onEdit(event.event_id)}
          className="px-3 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500 text-amber-300 hover:text-slate-950 border border-amber-500/30 text-xs font-bold inline-flex items-center gap-1.5 self-start">
          <Pencil className="w-3.5 h-3.5" /> Edit this event
        </button>
      )}
    </div>
  ) : null;

  return (
    <ModalShell
      title={event.title}
      subtitle={subtitle}
      icon={<Users className="w-5 h-5 text-emerald-400" />}
      onClose={onClose}
      maxWidth="max-w-4xl"
      headerExtra={headerExtra}
    >
      <div className="space-y-5">
        {flash && (
          <div className={`p-3 rounded-xl text-sm border flex items-start justify-between gap-2 ${flash.type === 'success' ? 'bg-emerald-950/60 border-emerald-700 text-emerald-200' : 'bg-rose-950/60 border-rose-700 text-rose-200'}`}>
            <span>{flash.text}</span>
            <button type="button" onClick={() => setFlash(null)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
          </div>
        )}
        {event.status === 'draft' && (
          <div className="p-3 rounded-xl text-xs border border-dashed border-slate-500 bg-slate-800/50 text-slate-200">
            This is a <strong>draft</strong>. Workers can't see it, and you can't assign or offer spots until it's published.
          </div>
        )}
        {event.positions.map((pos) => {
          const isFull = pos.assigned.length >= pos.capacity;
          const isDraft = event.status === 'draft';   // Phase 29.3: publish before staffing
          const canStaff = venueId && !event.cancelled && !isDraft && pos.status !== 'CANCELLED' && !isFull && !ended;
          return (
            <div key={pos.shift_id} className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-slate-800/40 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[11px] font-bold uppercase">{pos.role_type}</span>
                  <PayLabel rate={pos.hourly_rate} rateMax={pos.hourly_rate_max} className="text-xs text-emerald-400 font-semibold" />
                  {pos.hide_rate && <span className="inline-flex items-center gap-1 text-[10px] text-slate-400"><EyeOff className="w-3 h-3" /> hidden from workers</span>}
                  <TipBadge shift={pos} />
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                    {APPROVAL_LABEL[pos.approval_mode] || 'Venue setting'}
                  </span>
                  <span className={`text-xs font-semibold ${isFull ? 'text-emerald-400' : 'text-slate-300'}`}>{pos.assigned.length} / {pos.capacity} filled</span>
                </div>
                {canStaff && (
                  <button type="button" onClick={() => setStaffPos(pos)}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600/15 hover:bg-emerald-600 text-emerald-300 hover:text-white text-xs font-bold border border-emerald-600/30 inline-flex items-center gap-1">
                    <UserPlus className="w-3 h-3" /> Assign / Offer
                  </button>
                )}
                {onCancelPosition && !event.cancelled && !isDraft && pos.status !== 'CANCELLED' && (
                  <button type="button" onClick={() => onCancelPosition(pos, event)}
                    className="px-2.5 py-1 rounded-lg bg-rose-600/10 hover:bg-rose-600/20 text-rose-300 text-xs border border-rose-600/30 inline-flex items-center gap-1">
                    <Ban className="w-3 h-3" /> Cancel shift
                  </button>
                )}
                {pos.status === 'CANCELLED' && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-300 border border-rose-500/30">Cancelled</span>
                )}
                {onOpenBoard && (
                  <button type="button" onClick={() => onOpenBoard({ id: pos.shift_id, title: event.title, role_type: pos.role_type })}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 hover:text-white text-xs border border-slate-700 inline-flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" /> Board
                  </button>
                )}
              </div>

              <div className="p-4 space-y-4">
                {pos.role_notes && (
                  <p className="text-xs text-slate-300 bg-slate-900 border border-slate-800 rounded-lg p-2 whitespace-pre-line">
                    <span className="text-slate-500 font-semibold">{pos.role_type} notes: </span>{pos.role_notes}
                  </p>
                )}
                {pos.staff_notes && (
                  <p className="text-xs text-indigo-100 bg-indigo-500/5 border border-indigo-500/40 rounded-lg p-2 whitespace-pre-line">
                    <span className="text-indigo-300 font-semibold inline-flex items-center gap-1"><Lock className="w-3 h-3" /> {pos.role_type} — confirmed staff only: </span>{pos.staff_notes}
                  </p>
                )}

                <div>
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Assigned ({pos.assigned.length})</div>
                  {pos.assigned.length === 0 ? (
                    <p className="text-xs text-slate-500 italic">No one assigned yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {pos.assigned.map((p) => {
                        const chip = assignedChip(p);
                        return (
                          <div key={p.request_id} className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <div className="text-sm font-semibold text-white">{p.first_name} {p.last_name}</div>
                              {SOURCE_LABEL[p.approval_source] && (
                                <div className="text-[10px] text-slate-500">{SOURCE_LABEL[p.approval_source]}</div>
                              )}
                              {p.previous_drop_at && (
                                <div className="text-[10px] text-rose-300 inline-flex items-center gap-1" title={p.rebook_reason || ''}>
                                  <RotateCcw className="w-3 h-3" /> Back after dropping on {fmtDate(p.previous_drop_at, timeZone)}
                                  {p.rebook_reason ? ` · “${p.rebook_reason}”` : ''}
                                </div>
                              )}
                              {/* Phase 31 + 32 */}
                              {(p.cert_issues || []).map((issue) => (
                                <div key={issue} className={`text-[10px] inline-flex items-center gap-1 mr-2 ${issue.includes('not verified') ? 'text-sky-300' : 'text-rose-300'}`}>
                                  <Lock className="w-3 h-3" /> {issue.includes('not verified') ? issue : `Missing: ${issue}`}
                                </div>
                              ))}
                              {p.cover && (
                                <div className="text-[10px] inline-flex items-center gap-1 text-amber-300 mr-2">
                                  <LifeBuoy className="w-3 h-3" /> {p.cover === 'pending_approval' ? 'Someone took their cover request · approve it in Hand-offs' : 'Asked for cover · still booked'}
                                </div>
                              )}
                              {p.time_off && (
                                <div className="text-[10px] inline-flex items-center gap-1 text-rose-300">
                                  <AlertTriangle className="w-3 h-3" /> Has time off during this shift{p.time_off_reason ? ` · “${p.time_off_reason}”` : ''}
                                </div>
                              )}
                              {/* Phase 35: time tracking + staffing company */}
                              {(p.time_tracking === 'payroll' || p.works_through) && (
                                <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                  {p.time_tracking === 'payroll' && (
                                    <span title="Their time is tracked by your venue's own payroll. They don't clock in here."
                                      className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-500/10 text-violet-300 border border-violet-500/30">Venue payroll</span>
                                  )}
                                  {p.works_through && (
                                    <span title="Works through this company" className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-500/10 text-sky-300 border border-sky-500/30">{p.works_through}</span>
                                  )}
                                </div>
                              )}
                              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 mt-0.5">
                                {p.phone && <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1 hover:text-emerald-400"><Phone className="w-3 h-3" />{p.phone}</a>}
                                {p.email && <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1 hover:text-emerald-400"><Mail className="w-3 h-3" />{p.email}</a>}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <RatingBadge rating={p.aggregate_rating} count={p.rating_count} />
                              <ReliabilityBadge data={reliabilityMap[p.worker_id]} />
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${chip.cls}`}>{chip.label}</span>
                              {p.info_seen === true && (
                                <span title="Has read the latest notes and changes" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                                  <BookOpenCheck className="w-3 h-3" /> Read
                                </span>
                              )}
                              {p.info_seen === false && (
                                <span title="Hasn't opened the latest notes or changes yet" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/40">
                                  <AlertTriangle className="w-3 h-3" /> Not read yet
                                </span>
                              )}
                              {onRemovePerson && ['approved', 'confirmed'].includes(p.status) && (
                                <button type="button" onClick={() => onRemovePerson(p, pos, event)} title="Remove from shift"
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10">
                                  <UserMinus className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                          {venueId && ended && RATEABLE.includes(p.status) && (
                            <RateWorker venueId={venueId} person={p} onSaved={() => onChanged && onChanged()} />
                          )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div>
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <UserPlus className="w-3.5 h-3.5 text-amber-400" /> Requested ({pos.requested.length})
                  </div>
                  {pos.requested.length === 0 ? (
                    <p className="text-xs text-slate-500 italic">No pending requests for this shift.</p>
                  ) : (
                    <div className="space-y-2">
                      {pos.requested.map((p) => {
                        const approving = actionLoading === `approve-${p.request_id}`;
                        const denying = actionLoading === `deny-${p.request_id}`;
                        return (
                          <div key={p.request_id} className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-amber-500/5 rounded-lg border border-amber-500/20">
                            <div>
                              <div className="text-sm font-semibold text-white">{p.first_name} {p.last_name}</div>
                              <div className="text-[11px] text-slate-400 mt-0.5">Requested {p.requested_at ? fmtDateTime(p.requested_at, timeZone) : ''}</div>
                              {p.previous_drop_at && (
                                <div className="text-[11px] text-rose-300 mt-0.5 inline-flex items-center gap-1">
                                  <RotateCcw className="w-3 h-3" /> Dropped this event on {fmtDate(p.previous_drop_at, timeZone)}, asking back
                                </div>
                              )}
                              {p.outside_department && (
                                <div className="text-[11px] text-amber-300 mt-0.5">Outside the departments they work</div>
                              )}
                              {p.note && (
                                <div className="text-[11px] text-slate-300 mt-1 italic whitespace-pre-line">“{p.note}”</div>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <RatingBadge rating={p.aggregate_rating} count={p.rating_count} />
                              <ReliabilityBadge data={reliabilityMap[p.worker_id]} />
                              {/* Phase 32.3: Deny left, Approve right, like the approval queue and Review */}
                              <button type="button" onClick={() => onDeny && onDeny(p.request_id)} disabled={approving || denying}
                                className="px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white text-xs font-bold border border-rose-600/30 inline-flex items-center gap-1 disabled:opacity-40">
                                <X className="w-3 h-3" /> {denying ? '…' : 'Deny'}
                              </button>
                              <button type="button" onClick={() => onApprove && onApprove(p.request_id)} disabled={isFull || approving || denying}
                                title={isFull ? 'Shift is full' : 'Approve'}
                                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-40">
                                <Check className="w-3 h-3" /> {approving ? '…' : 'Approve'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Phase 34: people waiting for a spot, in order */}
                {pos.waitlist && pos.waitlist.length > 0 && (
                  <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-1.5">
                    <ListOrdered className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="font-semibold text-slate-300">Waitlist ({pos.waitlist.length}):</span>
                    <span>{pos.waitlist.join(', ')}</span>
                    <span className="text-slate-500">· the next person gets a spot automatically if one opens</span>
                  </div>
                )}

                {pos.dropped && pos.dropped.length > 0 && (
                  <div>
                    <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <LogOut className="w-3.5 h-3.5 text-rose-400" /> Dropped ({pos.dropped.length})
                    </div>
                    <div className="space-y-2">
                      {pos.dropped.map((p) => (
                        <div key={p.request_id} className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                          <div>
                            <div className="text-sm font-semibold text-slate-200">{p.first_name} {p.last_name}</div>
                            <div className="text-[11px] text-slate-500">
                              Dropped {p.dropped_at ? fmtDateTime(p.dropped_at, timeZone) : ''}
                              {p.drop_reason ? ` · “${p.drop_reason}”` : ''}
                            </div>
                          </div>
                          {venueId && !event.cancelled && !ended && pos.status !== 'CANCELLED' && event.status !== 'draft' && (
                            <button type="button" onClick={() => setBookBack({ person: p, pos })}
                              disabled={pos.assigned.length >= pos.capacity}
                              title={pos.assigned.length >= pos.capacity ? 'Shift is full' : 'Book them back on this shift'}
                              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-slate-700 text-xs font-bold inline-flex items-center gap-1 disabled:opacity-40">
                              <RotateCcw className="w-3 h-3" /> Book back…
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {pos.offers && pos.offers.length > 0 && (
                  <div>
                    <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Send className="w-3.5 h-3.5 text-indigo-400" /> Offers ({pos.offers.filter((o) => o.status === 'pending').length} waiting)
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {pos.offers.map((o) => {
                        const oc = OFFER_CHIP[o.status] || OFFER_CHIP.pending;
                        return (
                          <span key={o.offer_id} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border ${oc.cls}`}>
                            {o.status === 'pending' && <Clock className="w-3 h-3" />}
                            <span className="font-semibold">{o.first_name} {o.last_name}</span>
                            <span className="opacity-80">· {oc.label}</span>
                            {o.status === 'pending' && (
                              <button type="button" onClick={() => withdrawOffer(o.offer_id)} disabled={withdrawing === o.offer_id}
                                title="Withdraw this offer" className="ml-0.5 hover:text-white disabled:opacity-40">
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {bookBack && (
        <ConfirmDialog
          title={`Book ${bookBack.person.first_name} back?`}
          message={`${bookBack.person.first_name} dropped ${bookBack.pos.role_type} on this event. Booking them back is logged with your reason, and they're told they're booked.`}
          confirmLabel="Book back"
          input={{ label: 'Reason (required)', placeholder: 'e.g. They sorted out their conflict', required: true }}
          onConfirm={async (reason) => {
            if (reason.length < 5) throw new Error('Add a slightly longer reason.');
            const res = await api.post(`/shifts/${bookBack.pos.shift_id}/assign`, { worker_id: bookBack.person.worker_id, reason });
            setFlash({ type: 'success', text: res.data.message });
            if (onChanged) onChanged();
          }}
          onClose={() => setBookBack(null)}
        />
      )}
      {staffPos && (
        <StaffPositionModal
          event={event}
          position={staffPos}
          onClose={() => setStaffPos(null)}
          onDone={(message) => {
            setStaffPos(null);
            setFlash({ type: 'success', text: message });
            if (onChanged) onChanged();
          }}
        />
      )}
    </ModalShell>
  );
}
