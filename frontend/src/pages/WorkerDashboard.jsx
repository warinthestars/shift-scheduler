import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import {
  Calendar, Clock, DollarSign, MapPin, CheckCircle2, AlertCircle,
  Star, Briefcase, Zap, ShieldCheck, Check, Search, Filter
} from 'lucide-react';

export default function WorkerDashboard() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('find'); // 'find' | 'schedule'
  const [availableShifts, setAvailableShifts] = useState([]);
  const [myShifts, setMyShifts] = useState([]);
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [requestingId, setRequestingId] = useState(null);
  const [notification, setNotification] = useState(null);

  const fetchWorkerData = async () => {
    try {
      setLoading(true);
      const [openRes, myRes] = await Promise.all([
        api.get('/shifts/open'),
        api.get('/users/me/shifts'),
      ]);
      setAvailableShifts(openRes.data || []);
      setMyShifts(myRes.data || []);
    } catch (err) {
      console.error('Error loading worker dashboard data:', err);
      setNotification({
        type: 'error',
        message: 'Failed to load shifts from backend server.',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkerData();
  }, []);

  const handleRequestShift = async (shiftId) => {
    try {
      setRequestingId(shiftId);
      setNotification(null);

      const res = await api.post(`/shifts/${shiftId}/request`);
      const newRequest = res.data;

      if (newRequest.status === 'APPROVED') {
        // Auto-confirmed: move shift to My Schedule
        setMyShifts((prev) => [newRequest, ...prev]);
        setAvailableShifts((prev) => prev.filter((s) => s.id !== shiftId));
        setNotification({
          type: 'success',
          message: `🎉 Shift Auto-Confirmed! Added directly to "My Schedule" via ${
            newRequest.approval_source ? newRequest.approval_source.replace(/_/g, ' ') : 'Auto-Confirm Engine'
          }.`,
        });
      } else {
        // Manual approval pending: update request in state
        setMyShifts((prev) => [newRequest, ...prev]);
        setNotification({
          type: 'info',
          message: '📋 Application Submitted! Shift status is Pending Venue Manager review.',
        });
      }
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to request shift.',
      });
    } finally {
      setRequestingId(null);
    }
  };

  // Set of shift IDs currently requested
  const requestedMap = new Map();
  myShifts.forEach((req) => {
    requestedMap.set(req.shift_id, req.status);
  });

  const filteredAvailable = availableShifts.filter((shift) => {
    if (roleFilter === 'ALL') return true;
    const roleName = shift.role_type || shift.role_required || '';
    return roleName.toLowerCase().includes(roleFilter.toLowerCase());
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-16">
      {/* Header Profile Section */}
      <section className="bg-slate-900 border-b border-slate-800 py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-center space-x-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 font-black text-xl shadow-lg shadow-emerald-500/20">
              {user?.first_name?.[0] || 'W'}{user?.last_name?.[0] || 'K'}
            </div>
            <div>
              <div className="flex items-center space-x-2.5">
                <h1 className="text-2xl font-bold text-white">
                  {user?.first_name} {user?.last_name || 'Worker'}
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Worker
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {user?.bio || 'Ready for shifts across verified hospitality venues.'}
              </p>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="flex items-center space-x-3 bg-slate-950/80 px-4 py-2.5 rounded-2xl border border-slate-800">
            <div className="flex items-center space-x-1.5 text-amber-400 text-sm font-bold">
              <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
              <span>{Number(user?.aggregate_rating || user?.rating_average || 5.0).toFixed(1)}</span>
            </div>
            <span className="text-slate-700">•</span>
            <div className="text-xs text-slate-300">
              <span className="font-bold text-white">{myShifts.filter((s) => s.status === 'APPROVED').length}</span> scheduled
            </div>
            <span className="text-slate-700">•</span>
            <div className="text-xs text-slate-300">
              <span className="font-bold text-white">{availableShifts.length}</span> open
            </div>
          </div>
        </div>
      </section>

      {/* Main Two-Tab Dashboard */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8">
        {notification && (
          <div
            className={`mb-6 p-4 rounded-xl border flex items-center justify-between transition ${
              notification.type === 'success'
                ? 'bg-emerald-950/80 border-emerald-700 text-emerald-200'
                : notification.type === 'error'
                ? 'bg-rose-950/80 border-rose-700 text-rose-200'
                : 'bg-indigo-950/80 border-indigo-700 text-indigo-200'
            }`}
          >
            <div className="flex items-center space-x-2.5">
              {notification.type === 'success' ? (
                <Check className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-indigo-400 flex-shrink-0" />
              )}
              <span className="text-sm font-medium">{notification.message}</span>
            </div>
            <button onClick={() => setNotification(null)} className="text-xs underline hover:opacity-80">
              Dismiss
            </button>
          </div>
        )}

        {/* Tab Selection */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-4 gap-4">
          <div className="flex space-x-3">
            <button
              onClick={() => setActiveTab('find')}
              className={`px-5 py-2.5 rounded-xl text-xs font-bold transition ${
                activeTab === 'find'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              Find Shifts ({availableShifts.length})
            </button>
            <button
              onClick={() => setActiveTab('schedule')}
              className={`px-5 py-2.5 rounded-xl text-xs font-bold transition ${
                activeTab === 'schedule'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              My Schedule ({myShifts.length})
            </button>
          </div>

          {activeTab === 'find' && (
            <div className="flex items-center space-x-2">
              <span className="text-xs text-slate-400 flex items-center space-x-1">
                <Filter className="w-3.5 h-3.5" />
                <span>Role:</span>
              </span>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs font-medium text-slate-200 focus:outline-none focus:border-emerald-500"
              >
                <option value="ALL">All Roles</option>
                <option value="Bartender">Bartender</option>
                <option value="Server">Server</option>
                <option value="Dishwasher">Dishwasher</option>
                <option value="Barback">Barback</option>
                <option value="AV Tech">AV Tech</option>
              </select>
            </div>
          )}
        </div>

        {/* TAB 1: Find Shifts */}
        {activeTab === 'find' && (
          <div className="mt-6">
            {loading ? (
              <div className="py-20 text-center text-slate-500 text-xs">Loading open shifts from server...</div>
            ) : filteredAvailable.length === 0 ? (
              <div className="text-center py-20 bg-slate-900/40 rounded-2xl border border-slate-800">
                <Briefcase className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <h3 className="text-sm font-semibold text-slate-300">No shifts open right now</h3>
                <p className="text-xs text-slate-500 mt-1">Check back soon as venue managers post new shifts.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredAvailable.map((shift) => {
                  const existingStatus = requestedMap.get(shift.id);
                  const isSubmitting = requestingId === shift.id;
                  const isAutoConfirm = shift.is_shift_auto_confirm || shift.auto_confirm_anyone;

                  return (
                    <div
                      key={shift.id}
                      className="bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 transition flex flex-col justify-between shadow-xl"
                    >
                      <div>
                        <div className="flex justify-between items-start mb-3">
                          <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-800 text-slate-200 border border-slate-700 uppercase tracking-wide">
                            {shift.role_type || shift.role_required}
                          </span>
                          <div className="text-right">
                            <span className="text-lg font-black text-emerald-400">
                              ${Number(shift.hourly_rate).toFixed(2)}
                            </span>
                            <span className="text-xs text-slate-400">/hr</span>
                          </div>
                        </div>

                        <h3 className="text-base font-bold text-white mb-1">{shift.title}</h3>
                        <p className="text-xs font-semibold text-slate-300 mb-1">
                          {shift.venue?.name || 'Hospitality Venue'}
                        </p>
                        <p className="text-xs text-slate-400 flex items-center space-x-1 mb-4">
                          <MapPin className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                          <span className="truncate">{shift.venue?.address}</span>
                        </p>

                        <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/60 space-y-1.5 text-xs text-slate-300 mb-4">
                          <div className="flex items-center space-x-2">
                            <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                            <span>
                              {new Date(shift.start_time).toLocaleDateString(undefined, {
                                weekday: 'short',
                                month: 'short',
                                day: 'numeric',
                              })}
                            </span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Clock className="w-3.5 h-3.5 text-emerald-400" />
                            <span>
                              {new Date(shift.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              {' - '}
                              {new Date(shift.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>

                        <div className="mb-4">
                          {isAutoConfirm ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                              <Zap className="w-3 h-3 mr-1" /> Instant Auto-Confirm
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                              <ShieldCheck className="w-3 h-3 mr-1" /> Auto-Confirm Engine Eligible
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
                        <span className="text-xs text-slate-400">
                          {(shift.capacity ?? shift.spots_needed ?? 1) - (shift.spots_filled ?? 0)} spot(s) remaining
                        </span>

                        {existingStatus === 'PENDING' ? (
                          <span className="px-3.5 py-1.5 rounded-xl bg-amber-500/10 text-amber-400 text-xs font-bold border border-amber-500/20">
                            Pending
                          </span>
                        ) : existingStatus === 'APPROVED' ? (
                          <span className="px-3.5 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-400 text-xs font-bold border border-emerald-500/20">
                            Confirmed ✓
                          </span>
                        ) : (
                          <button
                            onClick={() => handleRequestShift(shift.id)}
                            disabled={isSubmitting}
                            className="px-4 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition disabled:opacity-50 shadow-md shadow-emerald-500/20"
                          >
                            {isSubmitting ? 'Evaluating...' : 'Request Shift'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: My Schedule */}
        {activeTab === 'schedule' && (
          <div className="mt-6 space-y-4">
            {myShifts.length === 0 ? (
              <div className="text-center py-20 bg-slate-900/40 rounded-2xl border border-slate-800">
                <Calendar className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <h3 className="text-sm font-semibold text-slate-300">No shifts on your schedule</h3>
                <p className="text-xs text-slate-500 mt-1">Browse "Find Shifts" to apply for upcoming opportunities.</p>
              </div>
            ) : (
              myShifts.map((req) => {
                const shift = req.shift;
                const isApproved = req.status === 'APPROVED';
                const isPending = req.status === 'PENDING';
                const isRejected = req.status === 'REJECTED';

                return (
                  <div
                    key={req.id}
                    className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase ${
                            isApproved
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : isPending
                              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                              : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                          }`}
                        >
                          {req.status}
                        </span>

                        {req.approval_source && (
                          <span className="text-xs text-slate-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                            Via: {req.approval_source.replace(/_/g, ' ')}
                          </span>
                        )}
                      </div>

                      <h3 className="text-base font-bold text-white mt-1">{shift?.title}</h3>
                      <p className="text-xs text-slate-400 flex items-center space-x-2">
                        <span className="text-slate-300 font-medium">{shift?.venue?.name}</span>
                        <span>•</span>
                        <span>{shift?.role_type || shift?.role_required}</span>
                        <span>•</span>
                        <span>${shift?.hourly_rate}/hr</span>
                      </p>
                      <p className="text-xs text-slate-500">
                        {new Date(shift?.start_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                      </p>
                    </div>

                    <div className="flex items-center space-x-3 w-full md:w-auto justify-end">
                      {isApproved && (
                        <span className="px-3.5 py-2 rounded-xl bg-emerald-950 text-emerald-400 border border-emerald-800 text-xs font-bold">
                          Ready for Shift ✓
                        </span>
                      )}
                      {isPending && (
                        <span className="text-xs text-amber-400 bg-amber-950/40 border border-amber-800/40 px-3.5 py-2 rounded-xl font-medium">
                          Awaiting Venue Manager Review
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </main>
    </div>
  );
}
