import React from 'react';
import { X, Star, Phone, Mail, User, Clock, Users } from 'lucide-react';

export default function ShiftRosterModal({ selectedShift, onClose, setSelectedShift }) {
  if (!selectedShift) return null;

  const handleClose = () => {
    if (onClose) onClose();
    if (setSelectedShift) setSelectedShift(null);
  };

  const shiftTitle = selectedShift.title || selectedShift.name || 'Shift Details';
  const shiftDate = selectedShift.start_time
    ? new Date(selectedShift.start_time).toLocaleDateString([], {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '';
  const shiftTime = selectedShift.start_time && selectedShift.end_time
    ? `${new Date(selectedShift.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${new Date(selectedShift.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : '';

  const assignedWorkers = selectedShift.assigned_workers || [];

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-6 max-h-[90vh] flex flex-col">
        {/* Modal Header: Displays Shift Name and Date */}
        <div className="flex justify-between items-start pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center space-x-2 mb-1">
              <Users className="w-5 h-5 text-emerald-400" />
              <h3 className="text-lg font-bold text-white">{shiftTitle}</h3>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
              <span className="flex items-center space-x-1">
                <Clock className="w-3.5 h-3.5 text-slate-500" />
                <span>{shiftDate} {shiftTime && `• ${shiftTime}`}</span>
              </span>
              {selectedShift.role_type && (
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-semibold uppercase text-[11px]">
                  {selectedShift.role_type}
                </span>
              )}
              {selectedShift.hourly_rate && (
                <span className="text-emerald-400 font-bold">
                  ${Number(selectedShift.hourly_rate).toFixed(2)}/hr
                </span>
              )}
              <span className="text-slate-400">
                Staff: <strong className="text-white">{assignedWorkers.length} / {selectedShift.capacity || 1}</strong>
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body: Iterates over selectedShift.assigned_workers */}
        <div className="overflow-y-auto space-y-3 flex-1 pr-1">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Assigned Staff Roster ({assignedWorkers.length})
          </div>

          {assignedWorkers.length === 0 ? (
            <div className="text-center py-10 bg-slate-950/60 rounded-xl border border-slate-800">
              <User className="w-10 h-10 text-slate-600 mx-auto mb-2" />
              <p className="text-sm font-medium text-slate-300">No Workers Assigned Yet</p>
              <p className="text-xs text-slate-500 mt-1">
                Approved shift requests and accepted transfers will appear here.
              </p>
            </div>
          ) : (
            assignedWorkers.map((worker) => {
              const fullName = `${worker.first_name || ''} ${worker.last_name || ''}`.trim() || 'Assigned Worker';
              const rating = Number(worker.aggregate_rating || 5.0).toFixed(1);

              return (
                <div
                  key={worker.id}
                  className="p-4 bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition"
                >
                  <div className="flex items-center space-x-3">
                    {worker.avatar_url ? (
                      <img
                        src={worker.avatar_url}
                        alt={fullName}
                        className="w-11 h-11 rounded-full object-cover border border-slate-700"
                      />
                    ) : (
                      <div className="w-11 h-11 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center font-bold text-sm">
                        {worker.first_name ? worker.first_name[0].toUpperCase() : 'W'}
                      </div>
                    )}
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-bold text-white">{fullName}</span>
                        <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-xs font-semibold border border-amber-500/20">
                          <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                          <span>{rating}</span>
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5 flex flex-wrap items-center gap-3">
                        {worker.email && (
                          <a
                            href={`mailto:${worker.email}`}
                            className="flex items-center space-x-1 hover:text-emerald-400 transition"
                          >
                            <Mail className="w-3 h-3 text-slate-500" />
                            <span>{worker.email}</span>
                          </a>
                        )}
                        {worker.phone && (
                          <a
                            href={`tel:${worker.phone}`}
                            className="flex items-center space-x-1 text-emerald-400 hover:text-emerald-300 font-medium transition"
                          >
                            <Phone className="w-3 h-3 text-emerald-500" />
                            <span>{worker.phone}</span>
                          </a>
                        )}
                      </div>
                    </div>
                  </div>

                  {worker.phone && (
                    <a
                      href={`tel:${worker.phone}`}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white text-xs font-semibold border border-emerald-600/30 flex items-center space-x-1.5 transition self-end sm:self-center"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span>Call Worker</span>
                    </a>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer: Close button */}
        <div className="flex justify-end pt-4 border-t border-slate-800">
          <button
            type="button"
            onClick={handleClose}
            className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
