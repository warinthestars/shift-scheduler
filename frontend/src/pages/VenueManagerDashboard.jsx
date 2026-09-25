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
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeDiscussionShift, setActiveDiscussionShift] = useState(null);
  const [notification, setNotification] = useState(null);

  // Phase 16: Roster & Calendar Views state
  const [viewMode, setViewMode] = useState("calendar"); // Toggles between "list" and "calendar".
  const [roster, setRoster] = useState([]); // Holds the data from `/api/venues/{venue_id}/roster`.
  const [selectedShift, setSelectedShift] = useState(null); // Triggers the drill-down modal.

  // Form state for Shift Creation Modal
  const [eventName, setEventName] = useState('');
  const [startDateTime, setStartDateTime] = useState('');
  const [endDateTime, setEndDateTime] = useState('');
  const [isAutoConfirm, setIsAutoConfirm] = useState(false);
  const [roleRequirements, setRoleRequirements] = useState([
    { role: 'Bartender', quantity: 2, hourly_rate: '25.00', tips_eligible: false, tip_pool: false },
  ]);
  const [reliabilityMap, setReliabilityMap] = useState({});
  const [managedVenues, setManagedVenues] = useState([]);
  const [boardRefreshKey, setBoardRefreshKey] = useState(0);
  const [venuePositions, setVenuePositions] = useState([]);
  const [showVenueSettings, setShowVenueSettings] = useState(false);

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
  const handleExportCSV = exportPayroll;

  // Dynamic role requirements helpers
  const FALLBACK_ROLES = ['Bartender', 'Server', 'Dishwasher', 'Barback', 'AV Tech'];

  const rowForPosition = (pos, fallbackName = 'Bartender') => ({
    role: pos ? pos.name : fallbackName,
    quantity: 1,
    hourly_rate: pos ? Number(pos.default_rate).toFixed(2) : '25.00',
    tips_eligible: pos ? !!pos.tips_eligible : false,
    tip_pool: pos ? !!pos.tip_pool : false,
  });

  const openCreateShiftModal = () => {
    setRoleRequirements([rowForPosition(venuePositions[0])]);
    setShowCreateModal(true);
  };

  const handleAddRoleRow = () => {
    const used = new Set(roleRequirements.map((r) => r.role));
    const next = venuePositions.find((p) => !used.has(p.name)) || venuePositions[0];
    setRoleRequirements([...roleRequirements, rowForPosition(next, 'Server')]);
  };

  const handleRemoveRoleRow = (index) => {
    if (roleRequirements.length <= 1) return;
    setRoleRequirements(roleRequirements.filter((_, idx) => idx !== index));
  };

  const handleRoleChange = (index, field, value) => {
    const updated = roleRequirements.map((row, i) => {
      if (i !== index) return row;
      const next = { ...row };
      if (field === 'quantity') {
        next.quantity = parseInt(value, 10) || 1;
      } else if (field === 'tips_eligible') {
        next.tips_eligible = Boolean(value);
        if (!value) next.tip_pool = false;
      } else if (field === 'tip_pool') {
        next.tip_pool = Boolean(value);
      } else if (field === 'role') {
        next.role = value;
        const pos = venuePositions.find((p) => p.name === value);
        if (pos) {
          next.hourly_rate = Number(pos.default_rate).toFixed(2);
          next.tips_eligible = !!pos.tips_eligible;
          next.tip_pool = !!pos.tip_pool;
        }
      } else {
        next[field] = value; // 'hourly_rate' (kept as string while typing)
      }
      return next;
    });
    setRoleRequirements(updated);
  };

  const handleCreateShiftSubmit = async (e) => {
    e.preventDefault();
    try {
      const payloadRoles = roleRequirements.map((r) => ({
        role: r.role,
        quantity: r.quantity,
        hourly_rate: parseFloat(r.hourly_rate),
        tips_eligible: r.tips_eligible,
        tip_pool: r.tips_eligible ? r.tip_pool : false,
      }));
      if (payloadRoles.some((r) => !r.hourly_rate || r.hourly_rate <= 0)) {
        setNotification({ type: 'error', message: 'Every role needs an hourly rate greater than $0.' });
        return;
      }

      const now = new Date();
      const venueTz = venueDetails?.timezone;
      const start = startDateTime
        ? zonedLocalToUtcIso(startDateTime, venueTz)
        : new Date(now.getTime() + 86400000).toISOString();
      const end = endDateTime
        ? zonedLocalToUtcIso(endDateTime, venueTz)
        : new Date(now.getTime() + 86400000 + 21600000).toISOString();
      if (new Date(end) <= new Date(start)) {
        setNotification({ type: 'error', message: 'End time must be after the start time.' });
        return;
      }

      await api.post('/shifts', {
        venue_id: currentVenueId,
        title: eventName,
        start_time: start,
        end_time: end,
        is_shift_auto_confirm: isAutoConfirm,
        role_requirements: payloadRoles,
      });

      setNotification({
        type: 'success',
        message: `Shift "${eventName}" created with ${roleRequirements.length} role requirement(s)!`,
      });

      setShowCreateModal(false);
      setEventName('');
      setRoleRequirements([rowForPosition(venuePositions[0])]);
      fetchVenueData(currentVenueId);
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to create shifts.',
      });
    }
  };

  const handleManagerVenueChange = (e) => {
    const newId = e.target.value;
    setCurrentVenueId(newId);
    fetchVenueData(newId);
  };

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
              onClick={openCreateShiftModal}
              className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition flex items-center space-x-1.5 shadow-md shadow-emerald-500/20"
            >
              <Plus className="w-4 h-4" />
              <span>Create New Shift</span>
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
                          <span>${shift?.hourly_rate}/hr</span>
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
                          <span>${shift?.hourly_rate}/hr</span>
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
          actionLoading={actionLoading}
          timeZone={venueDetails?.timezone}
        />
      </main>

      {/* Modal: Shift Creation */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-2 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Create New Shift</h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateShiftSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Event / Shift Name</label>
                <input
                  type="text"
                  required
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                  placeholder="Saturday Night Rooftop Service"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">{`Starts (${venueDetails?.timezone || 'local'} time)`}</label>
                  <input
                    type="datetime-local"
                    value={startDateTime}
                    onChange={(e) => setStartDateTime(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">{`Ends (${venueDetails?.timezone || 'local'} time)`}</label>
                  <input
                    type="datetime-local"
                    value={endDateTime}
                    onChange={(e) => setEndDateTime(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Dynamic List for Positions */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-xs font-semibold text-slate-300">
                    Positions
                  </label>
                  <button
                    type="button"
                    onClick={handleAddRoleRow}
                    className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center space-x-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Role</span>
                  </button>
                </div>

                <div className="space-y-2">
                  {roleRequirements.map((row, idx) => (
                    <div key={idx} className="p-3 bg-slate-800/50 border border-slate-700 rounded-xl space-y-2">
                      <div className="flex items-center space-x-2">
                        <select
                          value={row.role}
                          onChange={(e) => handleRoleChange(idx, 'role', e.target.value)}
                          className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                        >
                          {(venuePositions.length > 0 ? venuePositions.map((p) => p.name) : FALLBACK_ROLES).map((name) => (
                            <option key={name} value={name}>{name}</option>
                          ))}
                          {row.role && !(venuePositions.length > 0 ? venuePositions.map((p) => p.name) : FALLBACK_ROLES).includes(row.role) && (
                            <option value={row.role}>{row.role}</option>
                          )}
                        </select>
                        <input
                          type="number"
                          min="1"
                          value={row.quantity}
                          onChange={(e) => handleRoleChange(idx, 'quantity', e.target.value)}
                          className="w-16 px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                          placeholder="Qty"
                          title="Quantity"
                        />
                        <div className="relative w-24">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">$</span>
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            required
                            value={row.hourly_rate}
                            onChange={(e) => handleRoleChange(idx, 'hourly_rate', e.target.value)}
                            className="w-full pl-6 pr-2 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                            placeholder="Rate"
                            title="Hourly rate"
                          />
                        </div>
                        {roleRequirements.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveRoleRow(idx)}
                            className="p-2 text-slate-500 hover:text-rose-400"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      <div className="flex items-center space-x-4 pl-1">
                        <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={row.tips_eligible}
                            onChange={(e) => handleRoleChange(idx, 'tips_eligible', e.target.checked)}
                            className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-amber-500 focus:ring-amber-500"
                          />
                          <span>Tips eligible</span>
                        </label>
                        {row.tips_eligible && (
                          <label className="flex items-center space-x-2 text-xs text-amber-300 cursor-pointer pl-4 border-l border-slate-700">
                            <input
                              type="checkbox"
                              checked={row.tip_pool}
                              onChange={(e) => handleRoleChange(idx, 'tip_pool', e.target.checked)}
                              className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-amber-500 focus:ring-amber-500"
                            />
                            <span>Tip pool</span>
                          </label>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center space-x-2 pt-2">
                <input
                  type="checkbox"
                  id="modalAutoConfirm"
                  checked={isAutoConfirm}
                  onChange={(e) => setIsAutoConfirm(e.target.checked)}
                  className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-emerald-500 focus:ring-emerald-500"
                />
                <label htmlFor="modalAutoConfirm" className="text-xs text-slate-300">
                  Instant booking for this shift (anyone who picks it up is confirmed)
                </label>
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-xs font-semibold text-slate-300 hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition shadow-md shadow-emerald-500/20"
                >
                  Publish Shift(s)
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Discussion Board Modal */}
      {activeDiscussionShift && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-2xl w-full">
            <ShiftBoard
              shiftId={activeDiscussionShift.id}
              shiftTitle={`${activeDiscussionShift.title} (${activeDiscussionShift.role_type})`}
              currentUserRole={user?.role}
              onClose={() => setActiveDiscussionShift(null)}
            />
          </div>
        </div>
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
