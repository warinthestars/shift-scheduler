import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import {
  Calendar, Clock, DollarSign, MapPin, CheckCircle2, AlertCircle,
  Star, Briefcase, Zap, ShieldCheck, Navigation, ArrowRight, RefreshCw, Check
} from 'lucide-react';

export default function WorkerDashboard() {
  const { user, refreshProfile } = useAuth();
  const [activeTab, setActiveTab] = useState('callboard'); // 'callboard' | 'myshifts'
  const [stats, setStats] = useState({
    available_shifts_count: 0,
    upcoming_shifts_count: 0,
    pending_requests_count: 0,
    completed_shifts_count: 0,
    rating_average: 5.0,
    rating_count: 0,
  });
  const [availableShifts, setAvailableShifts] = useState([]);
  const [myShifts, setMyShifts] = useState([]);
  const [selectedRole, setSelectedRole] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [notification, setNotification] = useState(null);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const [statsRes, shiftsRes, myShiftsRes] = await Promise.all([
        api.get('/shifts/stats/worker'),
        api.get('/shifts?status_filter=open'),
        api.get('/shifts/my-shifts'),
      ]);
      setStats(statsRes.data);
      setAvailableShifts(shiftsRes.data);
      setMyShifts(myShiftsRes.data);
    } catch (err) {
      console.error('Error loading dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const handleRequestShift = async (shiftId) => {
    try {
      setActionLoading(shiftId);
      setNotification(null);
      const res = await api.post(`/shifts/${shiftId}/request`);
      const newReq = res.data;

      let msg = '';
      if (newReq.status === 'approved') {
        const sourceLabel = {
          shift_auto_confirm: 'Shift Auto-Confirm Rule',
          venue_whitelist: 'Venue Trusted Whitelist',
          rating_threshold: '5-Star Rating Threshold Match',
        }[newReq.approval_source] || 'Auto-Approval Engine';
        msg = `🎉 Instant Approval! You were auto-confirmed via: ${sourceLabel}.`;
      } else {
        msg = '📝 Application Submitted! Pending review by the Venue Manager.';
      }

      setNotification({
        type: newReq.status === 'approved' ? 'success' : 'info',
        message: msg,
      });

      // Refresh stats & shifts
      await fetchDashboardData();
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to request shift',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleCheckIn = async (shiftId) => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      return;
    }

    setActionLoading(`checkin-${shiftId}`);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const res = await api.post(`/shifts/${shiftId}/check-in`, {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
          const verified = res.data.check_in_verified;
          setNotification({
            type: verified ? 'success' : 'warning',
            message: verified
              ? '📍 GPS Verified: Successfully checked in inside the venue geofence!'
              : '⚠️ Checked in, but GPS coordinates were outside the venue geofence.',
          });
          await fetchDashboardData();
        } catch (err) {
          setNotification({
            type: 'error',
            message: err.response?.data?.detail || 'Check-in failed.',
          });
        } finally {
          setActionLoading(null);
        }
      },
      (err) => {
        setActionLoading(null);
        alert(`Location access denied or unavailable: ${err.message}`);
      }
    );
  };

  const handleCheckOut = async (shiftId) => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      return;
    }

    setActionLoading(`checkout-${shiftId}`);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          await api.post(`/shifts/${shiftId}/check-out`, {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
          setNotification({
            type: 'success',
            message: '🏁 Shift completed! Thank you for your work.',
          });
          await fetchDashboardData();
          if (refreshProfile) refreshProfile();
        } catch (err) {
          setNotification({
            type: 'error',
            message: err.response?.data?.detail || 'Check-out failed.',
          });
        } finally {
          setActionLoading(null);
        }
      },
      (err) => {
        setActionLoading(null);
        alert(`Location access error: ${err.message}`);
      }
    );
  };

  // Helper to determine auto-approval eligibility for display
  const getEligibilityBadge = (shift) => {
    if (shift.auto_confirm_anyone) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
          <Zap className="w-3 h-3 mr-1" /> Instant Auto-Confirm
        </span>
      );
    }
    const threshold = shift.min_rating_override || shift.venue?.global_auto_approve_min_rating;
    if (threshold && Number(user?.rating_average || 0) >= Number(threshold)) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
          <ShieldCheck className="w-3 h-3 mr-1" /> Rating Eligible (≥ {threshold}★)
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
        <Clock className="w-3 h-3 mr-1" /> Requires Manager Approval
      </span>
    );
  };

  const requestedShiftIds = new Set(myShifts.map((s) => s.shift_id));

  const filteredShifts = availableShifts.filter((s) => {
    if (selectedRole === 'ALL') return true;
    return s.role_required.toLowerCase().includes(selectedRole.toLowerCase());
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-16">
      {/* Top Banner / Worker Profile Header */}
      <section className="bg-slate-900 border-b border-slate-800 pt-8 pb-10 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="flex items-center space-x-5">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 font-black text-2xl shadow-xl shadow-emerald-500/20">
                {user?.first_name?.[0] || 'W'}{user?.last_name?.[0] || ''}
              </div>
              <div>
                <div className="flex items-center space-x-3">
                  <h1 className="text-2xl font-bold tracking-tight text-white">
                    {user?.first_name} {user?.last_name}
                  </h1>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-medium capitalize">
                    {user?.role?.replace('_', ' ')}
                  </span>
                </div>
                <p className="text-sm text-slate-400 mt-1 max-w-xl">
                  {user?.bio || 'Hospitality professional ready for shifts across registered venues.'}
                </p>

                {/* Skills tags */}
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {user?.skills?.map((skill, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 text-xs font-medium border border-slate-700/60"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Quick rating and stats showcase */}
            <div className="flex items-center space-x-4 bg-slate-950/60 p-4 rounded-2xl border border-slate-800/80">
              <div className="text-center px-3">
                <div className="flex items-center justify-center space-x-1 text-amber-400 font-bold text-2xl">
                  <Star className="w-6 h-6 fill-amber-400 text-amber-400" />
                  <span>{Number(user?.rating_average || 5.0).toFixed(1)}</span>
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {user?.rating_count || 0} reviews
                </div>
              </div>
              <div className="h-10 w-px bg-slate-800"></div>
              <div className="text-center px-3">
                <div className="text-2xl font-bold text-emerald-400">
                  {stats.completed_shifts_count}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">Shifts Done</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8">
        {/* Dynamic Metric Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Open On Board</p>
                <h3 className="text-2xl font-bold text-white mt-1">{stats.available_shifts_count}</h3>
              </div>
              <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400">
                <Briefcase className="w-5 h-5" />
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-3">Ready for instant or pending booking</p>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">My Upcoming</p>
                <h3 className="text-2xl font-bold text-emerald-400 mt-1">{stats.upcoming_shifts_count}</h3>
              </div>
              <div className="p-2.5 rounded-xl bg-teal-500/10 text-teal-400">
                <Calendar className="w-5 h-5" />
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-3">Confirmed shifts scheduled</p>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Pending Review</p>
                <h3 className="text-2xl font-bold text-amber-400 mt-1">{stats.pending_requests_count}</h3>
              </div>
              <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400">
                <Clock className="w-5 h-5" />
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-3">Awaiting venue manager approval</p>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Total Completed</p>
                <h3 className="text-2xl font-bold text-indigo-400 mt-1">{stats.completed_shifts_count}</h3>
              </div>
              <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400">
                <CheckCircle2 className="w-5 h-5" />
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-3">Verified work shifts</p>
          </div>
        </div>

        {/* Notifications / Toast */}
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
            <div className="flex items-center space-x-3">
              {notification.type === 'success' ? (
                <Check className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-indigo-400 flex-shrink-0" />
              )}
              <span className="text-sm font-medium">{notification.message}</span>
            </div>
            <button
              onClick={() => setNotification(null)}
              className="text-xs underline hover:opacity-80"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Navigation Tabs & Refresh */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-slate-800 pb-4 gap-4">
          <div className="flex space-x-3">
            <button
              onClick={() => setActiveTab('callboard')}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${
                activeTab === 'callboard'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              Available Call-Board ({availableShifts.length})
            </button>
            <button
              onClick={() => setActiveTab('myshifts')}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${
                activeTab === 'myshifts'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              My Shifts & Schedule ({myShifts.length})
            </button>
          </div>

          <div className="flex items-center space-x-3 w-full sm:w-auto">
            {activeTab === 'callboard' && (
              <div className="flex items-center space-x-2">
                <span className="text-xs text-slate-400">Filter:</span>
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value)}
                  className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs font-medium text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="ALL">All Roles</option>
                  <option value="Bartender">Bartender</option>
                  <option value="Server">Server</option>
                  <option value="Dishwasher">Dishwasher</option>
                  <option value="Barback">Barback</option>
                </select>
              </div>
            )}
            <button
              onClick={fetchDashboardData}
              title="Refresh shifts"
              className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* TAB 1: Available Shifts Call-Board */}
        {activeTab === 'callboard' && (
          <div className="mt-6">
            {filteredShifts.length === 0 ? (
              <div className="text-center py-16 bg-slate-900/40 rounded-2xl border border-slate-800/80">
                <Briefcase className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <h4 className="text-base font-semibold text-slate-300">No shifts available right now</h4>
                <p className="text-xs text-slate-500 mt-1">Check back soon or ask a venue manager to post shifts.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredShifts.map((shift) => {
                  const isRequested = requestedShiftIds.has(shift.id);
                  const isSubmitting = actionLoading === shift.id;

                  return (
                    <div
                      key={shift.id}
                      className="bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 transition flex flex-col justify-between shadow-xl"
                    >
                      <div>
                        {/* Header: Role & Rate */}
                        <div className="flex justify-between items-start mb-3">
                          <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-800 text-slate-200 border border-slate-700 uppercase tracking-wide">
                            {shift.role_required}
                          </span>
                          <div className="text-right">
                            <span className="text-lg font-black text-emerald-400">
                              ${Number(shift.hourly_rate).toFixed(2)}
                            </span>
                            <span className="text-xs text-slate-400">/hr</span>
                          </div>
                        </div>

                        {/* Title & Venue */}
                        <h3 className="text-base font-bold text-white mb-1">{shift.title}</h3>
                        <p className="text-sm font-medium text-slate-300 flex items-center space-x-1.5 mb-2">
                          <span>{shift.venue?.name || 'Local Venue'}</span>
                        </p>
                        <p className="text-xs text-slate-400 flex items-center space-x-1 mb-4">
                          <MapPin className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                          <span className="truncate">{shift.venue?.address}</span>
                        </p>

                        {/* Time & Schedule */}
                        <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/60 space-y-1.5 text-xs text-slate-300 mb-4">
                          <div className="flex items-center space-x-2">
                            <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                            <span>{new Date(shift.start_time).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
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

                        {/* Eligibility & Auto-Confirm Badge */}
                        <div className="mb-4">
                          {getEligibilityBadge(shift)}
                        </div>
                      </div>

                      {/* Footer & Request Action */}
                      <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between">
                        <span className="text-xs text-slate-400">
                          {shift.spots_needed - shift.spots_filled} of {shift.spots_needed} spot(s) open
                        </span>

                        {isRequested ? (
                          <span className="px-3 py-1.5 rounded-xl bg-slate-800 text-slate-400 text-xs font-semibold border border-slate-700">
                            Requested
                          </span>
                        ) : (
                          <button
                            onClick={() => handleRequestShift(shift.id)}
                            disabled={isSubmitting}
                            className="px-4 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition flex items-center space-x-1 disabled:opacity-50 shadow-md shadow-emerald-500/20"
                          >
                            <span>{isSubmitting ? 'Evaluating...' : 'Request Shift'}</span>
                            <ArrowRight className="w-3.5 h-3.5" />
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

        {/* TAB 2: My Shifts & Schedule */}
        {activeTab === 'myshifts' && (
          <div className="mt-6 space-y-4">
            {myShifts.length === 0 ? (
              <div className="text-center py-16 bg-slate-900/40 rounded-2xl border border-slate-800/80">
                <Calendar className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <h4 className="text-base font-semibold text-slate-300">No shift applications yet</h4>
                <p className="text-xs text-slate-500 mt-1">Visit the Call-Board to request available shifts.</p>
              </div>
            ) : (
              myShifts.map((req) => {
                const shift = req.shift;
                const isApproved = req.status === 'approved';
                const isCompleted = req.status === 'completed';
                const isPending = req.status === 'pending';

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
                              : 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30'
                          }`}
                        >
                          {req.status}
                        </span>

                        {req.approval_source && (
                          <span className="text-xs text-slate-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                            Source: {req.approval_source.replace(/_/g, ' ')}
                          </span>
                        )}
                      </div>

                      <h3 className="text-base font-bold text-white mt-1">{shift?.title}</h3>
                      <p className="text-xs text-slate-400 flex items-center space-x-2">
                        <span className="text-slate-300 font-medium">{shift?.venue?.name}</span>
                        <span>•</span>
                        <span>{shift?.role_required}</span>
                        <span>•</span>
                        <span>${shift?.hourly_rate}/hr</span>
                      </p>
                      <p className="text-xs text-slate-500">
                        {new Date(shift?.start_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                      </p>
                    </div>

                    {/* Geofenced Check-In/Out Actions */}
                    <div className="flex items-center space-x-3 w-full md:w-auto justify-end">
                      {isApproved && (
                        <>
                          <button
                            onClick={() => handleCheckIn(shift.id)}
                            disabled={actionLoading === `checkin-${shift.id}` || req.check_in_verified}
                            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition ${
                              req.check_in_verified
                                ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                            }`}
                          >
                            <Navigation className="w-3.5 h-3.5" />
                            <span>{req.check_in_verified ? 'Checked In ✓' : 'Check-In (GPS)'}</span>
                          </button>

                          <button
                            onClick={() => handleCheckOut(shift.id)}
                            disabled={actionLoading === `checkout-${shift.id}`}
                            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition flex items-center space-x-1.5"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Check-Out (GPS)</span>
                          </button>
                        </>
                      )}

                      {isCompleted && (
                        <span className="px-3.5 py-2 rounded-xl bg-indigo-950/60 text-indigo-300 border border-indigo-800/60 text-xs font-semibold flex items-center space-x-1.5">
                          <Check className="w-3.5 h-3.5" />
                          <span>Shift Completed & Recorded</span>
                        </span>
                      )}

                      {isPending && (
                        <span className="text-xs text-amber-400 bg-amber-950/40 border border-amber-800/40 px-3 py-1.5 rounded-xl">
                          Awaiting Venue Approval
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
