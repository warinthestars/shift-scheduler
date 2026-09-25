import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import {
  Calendar as CalendarIcon, Clock, DollarSign, Users, Plus, Trash2, Check, X,
  Building2, Star, AlertCircle, ShieldCheck, Zap, ArrowRight,
  Download, ArrowRightLeft, MessageSquare, FileText, List as ListIcon, Settings
} from 'lucide-react';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { enUS } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import ShiftBoard from '../components/ShiftBoard';
import ShiftRosterModal from '../components/ShiftRosterModal';
import TipBadge from '../components/TipBadge';
import ReliabilityBadge from '../components/ReliabilityBadge';
import PostedShiftsBoard from '../components/PostedShiftsBoard';
import VenueSettingsModal from '../components/VenueSettingsModal';
import ShiftEventFormModal from '../components/ShiftEventFormModal';
import ShiftBoardModal from '../components/ShiftBoardModal';
import ReasonDialog from '../components/ReasonDialog';
import DuplicateEventModal from '../components/DuplicateEventModal';
import TimesheetModal from '../components/TimesheetModal';
import PayLabel from '../components/PayLabel';
import { zonedLocalToUtcIso, fmtShortDate } from '../utils/venueTime';

const locales = {
  'en-US': enUS,
};

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales,
});

export default function VenueManagerDashboard() {
  const { user } = useAuth();
  const isPlatformAdmin = ['platform_admin', 'super_admin'].includes((user?.role || '').toLowerCase());
  const initialVenue = isPlatformAdmin
    ? (localStorage.getItem('shiftboard_admin_venue_id') || user?.venue_id || null)
    : (user?.venue_id || null);

  const [venueShifts, setVenueShifts] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [pendingTransfers, setPendingTransfers] = useState([]);
  const [currentVenueId, setCurrentVenueId] = useState(initialVenue);
  const [venueDetails, setVenueDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [exportingCSV, setExportingCSV] = useState(false);
  const [activeDiscussionShift, setActiveDiscussionShift] = useState(null);
  const [notification, setNotification] = useState(null);

  // Phase 16: Roster & Calendar Views state
  const [viewMode, setViewMode] = useState("calendar"); // Toggles between "list" and "calendar".
  const [roster, setRoster] = useState([]); // Holds the data from `/api/venues/{venue_id}/roster`.
  const [selectedShift, setSelectedShift] = useState(null); // Triggers the drill-down modal.

  const [reliabilityMap, setReliabilityMap] = useState({});
  const [managedVenues, setManagedVenues] = useState([]);
  const [boardRefreshKey, setBoardRefreshKey] = useState(0);
  const [venuePositions, setVenuePositions] = useState([]);
  const [showVenueSettings, setShowVenueSettings] = useState(false);
  const [eventForm, setEventForm] = useState(null); // { mode: 'create' } | { mode: 'edit', eventId }
  const [reasonDialog, setReasonDialog] = useState(null);
  const [dupEvent, setDupEvent] = useState(null);
  const [timesheetEventId, setTimesheetEventId] = useState(null);

  const fetchVenueData = async (venueId) => {
    try {
      setLoading(true);
      let activeId = venueId;
      if (!activeId && isPlatformAdmin) {
        activeId = localStorage.getItem('shiftboard_admin_venue_id');
      }
      const mvRes = await api.get('/venues/managed').catch(() => ({ data: [] }));
      const mine = mvRes.data || [];
      setManagedVenues(mine);
      if (!isPlatformAdmin && activeId && !mine.some((v) => String(v.id) === String(activeId))) {
        activeId = null;
      }
      if (!activeId && mine.length > 0) {
        activeId = mine[0].id;
      }
      setCurrentVenueId(activeId || null);

      if (!activeId) {
        setLoading(false);
        return;
      }

      const [shiftsRes, requestsRes, venueRes, transfersRes, rosterRes, reliabilityRes] = await Promise.all([
        api.get(`/venues/${activeId}/shifts`),
        api.get(`/venues/${activeId}/requests/pending`),
        api.get(`/venues/${activeId}`),
        api.get(`/transfers/venue/${activeId}/pending`).catch(() => ({ data: [] })),
        api.get(`/venues/${activeId}/roster`).catch(() => ({ data: [] })),
        api.get(`/venues/${activeId}/reliability`).catch(() => ({ data: {} })),
      ]);

      setVenueShifts(shiftsRes.data || []);
      setPendingRequests(requestsRes.data || []);
      setVenueDetails(venueRes.data || null);
      setPendingTransfers(transfersRes.data || []);
      setRoster(rosterRes.data || []);
      setReliabilityMap(reliabilityRes.data || {});
      setBoardRefreshKey((k) => k + 1);
    } catch (err) {
      console.error('Failed to load venue manager data:', err);
      setNotification({
        type: 'error',
        message: 'Could not load venue shifts, approval queue, or transfers from backend.',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVenueData(currentVenueId || user?.venue_id);
  }, [user?.venue_id]);

  // Listen to Super Admin venue switcher from Navbar
  useEffect(() => {
    const handleAdminVenueSwitch = (e) => {
      const newVenueId = e.detail;
      if (newVenueId) {
        setCurrentVenueId(newVenueId);
        fetchVenueData(newVenueId);
      }
    };
    window.addEventListener('admin_venue_changed', handleAdminVenueSwitch);
    return () => window.removeEventListener('admin_venue_changed', handleAdminVenueSwitch);
  }, []);

  const loadVenuePositions = async (venueId) => {
    if (!venueId) {
      setVenuePositions([]);
      return;
    }
    try {
      const res = await api.get(`/venues/${venueId}/positions`);
      setVenuePositions(res.data || []);
    } catch (err) {
      setVenuePositions([]);
    }
  };

  useEffect(() => {
    loadVenuePositions(currentVenueId);
  }, [currentVenueId]);

  // Phase 16: Fetch roster data when currentVenueId changes
  useEffect(() => {
    if (!currentVenueId) return;
    const fetchRoster = async () => {
      try {
        const res = await api.get(`/venues/${currentVenueId}/roster`);
        setRoster(res.data || []);
      } catch (err) {
        console.error('Error fetching venue roster:', err);
      }
    };
    fetchRoster();
  }, [currentVenueId]);

  // Transform roster into react-big-calendar events
  const calendarEvents = useMemo(() => {
    return (roster || []).map((shift) => ({
      id: shift.id,
      title: shift.name || shift.title,
      start: new Date(shift.start_time),
      end: new Date(shift.end_time),
      resource: shift,
    }));
  }, [roster]);

  // Group roster shifts by Date for List view
  const shiftsByDate = useMemo(() => {
    return (roster || []).reduce((acc, shift) => {
      const dateKey = shift.start_time
        ? new Date(shift.start_time).toLocaleDateString([], {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })
        : 'Unscheduled';
      if (!acc[dateKey]) acc[dateKey] = [];
      acc[dateKey].push(shift);
      return acc;
    }, {});
  }, [roster]);

  // Approval queue actions
  const handleApprove = async (requestId) => {
    try {
      setActionLoading(`approve-${requestId}`);
      await api.post(`/requests/${requestId}/approve`);
      setPendingRequests((prev) => prev.filter((r) => r.id !== requestId));
      setNotification({
        type: 'success',
        message: 'Worker request approved and confirmed for shift!',
      });
      fetchVenueData(currentVenueId);
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to approve request.',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeny = async (requestId) => {
    try {
      setActionLoading(`deny-${requestId}`);
      await api.post(`/requests/${requestId}/deny`);
      setPendingRequests((prev) => prev.filter((r) => r.id !== requestId));
      setNotification({
        type: 'info',
        message: 'Shift application declined.',
      });
      fetchVenueData(currentVenueId);
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to deny request.',
      });
    } finally {
      setActionLoading(null);
    }
  };

  // Shift Transfer Approval actions (Phase 20)
  const handleApproveTransfer = async (transferId) => {
    try {
      setActionLoading(`transfer-approve-${transferId}`);
      await api.post(`/transfers/${transferId}/manager-review`, { action: 'approve' });
      setPendingTransfers((prev) => prev.filter((t) => t.id !== transferId));
      setNotification({
        type: 'success',
        message: 'Shift transfer approved! Spot reassigned to new worker.',
      });
      fetchVenueData(currentVenueId);
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to approve shift transfer.',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDenyTransfer = async (transferId) => {
    try {
      setActionLoading(`transfer-deny-${transferId}`);
      await api.post(`/transfers/${transferId}/manager-review`, { action: 'deny' });
      setPendingTransfers((prev) => prev.filter((t) => t.id !== transferId));
      setNotification({
        type: 'info',
        message: 'Shift transfer request rejected.',
      });
      fetchVenueData(currentVenueId);
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to deny transfer.',
      });
    } finally {
      setActionLoading(null);
    }
  };

  // Phase 19: Hour Tracking & Payroll CSV Export
  const exportPayroll = async () => {
    if (!currentVenueId) return;
    try {
      setExportingCSV(true);
      const response = await api.get(`/venues/${currentVenueId}/payroll/export`, {
        responseType: 'blob',
      });
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'payroll.csv');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setNotification({
        type: 'success',
        message: '📊 Payroll CSV downloaded successfully!',
      });
    } catch (err) {
      console.error('Error exporting payroll CSV:', err);
      setNotification({
        type: 'error',
        message: 'Failed to download payroll CSV.',
      });
    } finally {
      setExportingCSV(false);
    }
  };


  const handleManagerVenueChange = (e) => {
    const newId = e.target.value;
    setCurrentVenueId(newId);
    fetchVenueData(newId);
  };

  const afterChange = (message) => {
    setNotification({ type: 'success', message });
    fetchVenueData(currentVenueId);
  };

  const askCancelEvent = (ev) =>
    setReasonDialog({
      title: 'Cancel this event?',
      message: `Everyone booked or waiting on "${ev.title}" will see it as cancelled, with your reason.`,
      confirmLabel: 'Cancel event',
      danger: true,
      onConfirm: async (reason) => {
        await api.post(`/events/${ev.event_id}/cancel`, { reason });
        afterChange('Event cancelled.');
      },
    });

  const askCancelPosition = (pos, ev) =>
    setReasonDialog({
      title: `Cancel ${pos.role_type}?`,
      message: `Everyone booked or waiting for ${pos.role_type} on "${ev.title}" will see it as cancelled.`,
      confirmLabel: 'Cancel position',
      danger: true,
      onConfirm: async (reason) => {
        await api.post(`/events/${ev.event_id}/positions/${pos.shift_id}/cancel`, { reason });
        afterChange(`${pos.role_type} cancelled.`);
      },
    });

  const askRemovePerson = (person, pos) =>
    setReasonDialog({
      title: `Remove ${person.first_name}?`,
      message: `${person.first_name} ${person.last_name} will be taken off ${pos.role_type} and the spot reopens.`,
      confirmLabel: 'Remove',
      danger: true,
      onConfirm: async (reason) => {
        await api.post(`/requests/${person.request_id}/remove`, { reason });
        afterChange(`${person.first_name} removed.`);
      },
    });

  if (!loading && !currentVenueId) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md text-center bg-slate-900 border border-slate-800 rounded-2xl p-8">
          <Building2 className="w-10 h-10 text-amber-400 mx-auto mb-3" />
          <h1 className="text-lg font-bold text-white mb-1">No venue assigned yet</h1>
          <p className="text-sm text-slate-400">
            Your account is a Venue Manager but isn't linked to a venue. Ask a platform admin to assign you one in the Admin Panel.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-16">
      {/* Header Banner */}
      <section className="bg-slate-900 border-b border-slate-800 py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-center space-x-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-400 flex items-center justify-center text-slate-950 font-black text-xl shadow-lg shadow-amber-500/20">
              <Building2 className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center space-x-2.5">
                <h1 className="text-2xl font-bold text-white">
                  {venueDetails?.name || 'Venue Management'}
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  Venue Manager
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {venueDetails?.address || 'Review applicant queue, approve workers, and publish shifts.'}
              </p>
              {!isPlatformAdmin && managedVenues.length > 1 && (
                <select
                  value={currentVenueId || ''}
                  onChange={handleManagerVenueChange}
                  className="mt-2 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-amber-500"
                >
                  {managedVenues.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setShowVenueSettings(true)}
              disabled={!venueDetails}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition flex items-center space-x-1.5 shadow-sm disabled:opacity-50"
            >
              <Settings className="w-4 h-4 text-amber-400" />
              <span>Venue Settings</span>
            </button>

            {currentVenueId && (
              <Link
                to={`/venues/${currentVenueId}`}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition flex items-center space-x-1.5 shadow-sm"
              >
                <Users className="w-4 h-4 text-emerald-400" />
                <span>Public page</span>
              </Link>
            )}

            {/* Download Payroll CSV Button */}
            <button
              type="button"
              onClick={exportPayroll}
              disabled={exportingCSV || !currentVenueId}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition flex items-center space-x-1.5 shadow-sm disabled:opacity-50"
            >
              <Download className="w-4 h-4 text-emerald-400" />
              <span>{exportingCSV ? 'Downloading...' : 'Download Payroll CSV'}</span>
            </button>

            {/* Create New Shift Button */}
            <button
              type="button"
              onClick={() => setEventForm({ mode: 'create' })}
              className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition flex items-center space-x-1.5 shadow-md shadow-emerald-500/20"
            >
              <Plus className="w-4 h-4" />
              <span>Post a Shift</span>
            </button>
          </div>
        </div>
      </section>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8 space-y-8">
        {notification && (
          <div
            className={`p-4 rounded-xl border flex items-center justify-between transition ${
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

        {/* Section 1: Pending Transfers */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <ArrowRightLeft className="w-5 h-5 text-amber-400" />
              <h2 className="text-base font-bold text-white">
                Pending Transfers ({pendingTransfers.length})
              </h2>
            </div>
            <span className="text-xs text-slate-400">
              Worker-to-worker shift swaps awaiting manager approval
            </span>
          </div>

          {pendingTransfers.length === 0 ? (
            <div className="text-center py-8 bg-slate-950/50 rounded-xl border border-slate-800">
              <Check className="w-6 h-6 text-emerald-500/60 mx-auto mb-1.5" />
              <p className="text-xs text-slate-400">No shift transfer requests waiting for approval.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pendingTransfers.map((transfer) => {
                const shift = transfer.shift;
                const fromWorker = transfer.from_worker;
                const toWorker = transfer.to_worker;
                const isActionLoading = actionLoading?.includes(transfer.id);

                return (
                  <div
                    key={transfer.id}
                    className="p-4 bg-slate-950 border border-slate-800 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 text-xs font-semibold border border-amber-500/30">
                          Transfer Proposal
                        </span>
                      </div>
                      <p className="text-sm font-medium text-white">
                        <span className="font-bold text-slate-100">{fromWorker?.first_name} {fromWorker?.last_name || ''}</span>
                        {' wants to transfer '}
                        <span className="font-bold text-emerald-400">[{shift?.title || 'Shift'}]</span>
                        {' to '}
                        <span className="font-bold text-slate-100">{toWorker?.first_name} {toWorker?.last_name || ''}</span>.
                      </p>

                      <div className="text-xs text-slate-400 mt-1 flex items-center space-x-2">
                        <span className="text-emerald-400 font-semibold">{shift?.title}</span>
                        <span>•</span>
                        <span>{shift?.role_type}</span>
                        <span>•</span>
                        <span className="inline-flex items-center gap-1.5">
                          <PayLabel rate={shift?.hourly_rate} rateMax={shift?.hourly_rate_max} />
                          <TipBadge shift={shift} />
                        </span>
                        <span>•</span>
                        <span>{fmtShortDate(shift?.start_time, venueDetails?.timezone)}</span>
                      </div>
                      {transfer.notes && (
                        <p className="text-xs text-amber-300/90 mt-1.5 italic bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/20">
                          Notes: "{transfer.notes}"
                        </p>
                      )}
                    </div>

                    <div className="flex items-center space-x-2 w-full md:w-auto justify-end">
                      <button
                        type="button"
                        onClick={() => handleApproveTransfer(transfer.id)}
                        disabled={isActionLoading}
                        className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center space-x-1 shadow-md shadow-emerald-600/20 disabled:opacity-50"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Approve</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDenyTransfer(transfer.id)}
                        disabled={isActionLoading}
                        className="px-3.5 py-1.5 rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white text-xs font-bold transition flex items-center space-x-1 border border-rose-600/30 disabled:opacity-50"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Deny</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Section 2: Shift Application Approval Queue */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <Users className="w-5 h-5 text-amber-400" />
              <h2 className="text-base font-bold text-white">
                Approval Queue ({pendingRequests.length} pending)
              </h2>
            </div>
            <span className="text-xs text-slate-400">
              Workers requiring manual review
            </span>
          </div>

          {pendingRequests.length === 0 ? (
            <div className="text-center py-12 bg-slate-950/50 rounded-xl border border-slate-800">
              <Check className="w-8 h-8 text-emerald-500/60 mx-auto mb-2" />
              <p className="text-xs text-slate-400">All caught up! No pending shift requests in the queue.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pendingRequests.map((req) => {
                const worker = req.worker;
                const shift = req.shift;

                return (
                  <div
                    key={req.id}
                    className="p-4 bg-slate-950 border border-slate-800 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
                  >
                    <div>
                      <div className="flex items-center space-x-2.5">
                        <span className="text-sm font-bold text-white">
                          {worker?.first_name} {worker?.last_name || 'Worker'}
                        </span>
                        <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-xs font-semibold border border-amber-500/20">
                          <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                          <span>{Number(worker?.aggregate_rating || 5.0).toFixed(1)}</span>
                        </span>
                        <ReliabilityBadge data={reliabilityMap[worker?.id]} />
                        <span className="text-xs text-slate-500">
                          {worker?.email}
                        </span>
                      </div>

                      <div className="text-xs text-slate-400 mt-1 flex items-center space-x-2">
                        <span className="text-emerald-400 font-semibold">{shift?.title}</span>
                        <span>•</span>
                        <span>{shift?.role_type}</span>
                        <span>•</span>
                        <span className="inline-flex items-center gap-1.5">
                          <PayLabel rate={shift?.hourly_rate} rateMax={shift?.hourly_rate_max} />
                          <TipBadge shift={shift} />
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 w-full md:w-auto justify-end">
                      <button
                        type="button"
                        onClick={() => handleApprove(req.id)}
                        disabled={actionLoading === `approve-${req.id}`}
                        className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center space-x-1 shadow-md shadow-emerald-600/20 disabled:opacity-50"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Approve</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeny(req.id)}
                        disabled={actionLoading === `deny-${req.id}`}
                        className="px-3.5 py-1.5 rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white text-xs font-bold transition flex items-center space-x-1 border border-rose-600/30 disabled:opacity-50"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Deny</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Section 3 (Phase 23): Posted Shifts board */}
        <PostedShiftsBoard
          venueId={currentVenueId}
          refreshKey={boardRefreshKey}
          reliabilityMap={reliabilityMap}
          onApprove={handleApprove}
          onDeny={handleDeny}
          onOpenBoard={setActiveDiscussionShift}
          onEditEvent={(id) => setEventForm({ mode: 'edit', eventId: id })}
          onCancelEvent={askCancelEvent}
          onDuplicateEvent={(ev) => setDupEvent(ev)}
          onTimesheet={(ev) => setTimesheetEventId(ev.event_id)}
          onRemovePerson={askRemovePerson}
          onCancelPosition={askCancelPosition}
          actionLoading={actionLoading}
          timeZone={venueDetails?.timezone}
        />
      </main>

      {eventForm && venueDetails && (
        <ShiftEventFormModal
          mode={eventForm.mode}
          eventId={eventForm.eventId}
          venue={venueDetails}
          positions={venuePositions}
          onClose={() => setEventForm(null)}
          onSaved={() => {
            setEventForm(null);
            fetchVenueData(currentVenueId);
            setNotification({
              type: 'success',
              message: eventForm.mode === 'edit' ? 'Event updated.' : 'Event and shifts published.',
            });
            loadVenuePositions(currentVenueId);
          }}
        />
      )}

      {reasonDialog && <ReasonDialog {...reasonDialog} onClose={() => setReasonDialog(null)} />}
      {dupEvent && (
        <DuplicateEventModal
          event={dupEvent}
          timeZone={venueDetails?.timezone}
          onClose={() => setDupEvent(null)}
          onDone={(count) => afterChange(`Created ${count} ${count === 1 ? 'copy' : 'copies'}.`)}
        />
      )}
      {timesheetEventId && (
        <TimesheetModal
          eventId={timesheetEventId}
          timeZone={venueDetails?.timezone}
          onClose={() => setTimesheetEventId(null)}
          onChanged={() => fetchVenueData(currentVenueId)}
        />
      )}

      {/* Discussion Board Modal (Phase 25.3: always on top) */}
      {activeDiscussionShift && (
        <ShiftBoardModal
          shiftId={activeDiscussionShift.id}
          shiftTitle={`${activeDiscussionShift.title} (${activeDiscussionShift.role_type})`}
          currentUserRole={user?.role}
          onClose={() => setActiveDiscussionShift(null)}
        />
      )}

      {showVenueSettings && venueDetails && (
        <VenueSettingsModal
          mode="edit"
          venue={venueDetails}
          onClose={() => {
            setShowVenueSettings(false);
            loadVenuePositions(currentVenueId);
          }}
          onSaved={(updated) => {
            setVenueDetails(updated);
            setShowVenueSettings(false);
            loadVenuePositions(currentVenueId);
            setNotification({ type: 'success', message: 'Venue settings saved.' });
            setBoardRefreshKey((k) => k + 1);
          }}
        />
      )}

    </div>
  );
}
