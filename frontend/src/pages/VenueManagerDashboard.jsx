import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import {
  Calendar as CalendarIcon, Clock, DollarSign, Users, Plus, Trash2, Check, X,
  Building2, Star, AlertCircle, ShieldCheck, Zap, ArrowRight,
  Download, ArrowRightLeft, MessageSquare, FileText, List as ListIcon
} from 'lucide-react';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { enUS } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import ShiftBoard from '../components/ShiftBoard';
import ShiftRosterModal from '../components/ShiftRosterModal';

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
  const [venueShifts, setVenueShifts] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [pendingTransfers, setPendingTransfers] = useState([]);
  const [currentVenueId, setCurrentVenueId] = useState(user?.venue_id || null);
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
  const [hourlyRate, setHourlyRate] = useState('35.00');
  const [isAutoConfirm, setIsAutoConfirm] = useState(false);
  const [roleRequirements, setRoleRequirements] = useState([
    { role: 'Bartender', quantity: 2 },
  ]);

  const fetchVenueData = async (venueId) => {
    try {
      setLoading(true);
      let activeId = venueId;
      if (!activeId) {
        const vRes = await api.get('/venues');
        if (vRes.data && vRes.data.length > 0) {
          activeId = vRes.data[0].id;
          setCurrentVenueId(activeId);
        }
      }

      if (!activeId) {
        setLoading(false);
        return;
      }

      const [shiftsRes, requestsRes, venueRes, transfersRes, rosterRes] = await Promise.all([
        api.get(`/venues/${activeId}/shifts`),
        api.get(`/venues/${activeId}/requests/pending`),
        api.get(`/venues/${activeId}`),
        api.get(`/transfers/venue/${activeId}/pending`).catch(() => ({ data: [] })),
        api.get(`/venues/${activeId}/roster`).catch(() => ({ data: [] })),
      ]);

      setVenueShifts(shiftsRes.data || []);
      setPendingRequests(requestsRes.data || []);
      setVenueDetails(venueRes.data || null);
      setPendingTransfers(transfersRes.data || []);
      setRoster(rosterRes.data || []);
    } catch (err) {
      console.error('Error fetching venue manager dashboard:', err);
      setNotification({
        type: 'error',
        message: 'Could not load venue shifts, approval queue, or transfers from backend.',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVenueData(user?.venue_id);
  }, [user?.venue_id]);

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
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to deny request.',
      });
    } finally {
      setActionLoading(null);
    }
  };

  // Shift Transfer Approval actions
  const handleApproveTransfer = async (transferId) => {
    try {
      setActionLoading(`transfer-approve-${transferId}`);
      await api.post(`/transfers/${transferId}/approve`);
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
      await api.post(`/transfers/${transferId}/reject`);
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
  const handleAddRoleRow = () => {
    setRoleRequirements([...roleRequirements, { role: 'Server', quantity: 1 }]);
  };

  const handleRemoveRoleRow = (index) => {
    if (roleRequirements.length <= 1) return;
    setRoleRequirements(roleRequirements.filter((_, idx) => idx !== index));
  };

  const handleRoleChange = (index, field, value) => {
    const updated = [...roleRequirements];
    updated[index][field] = field === 'quantity' ? parseInt(value, 10) || 1 : value;
    setRoleRequirements(updated);
  };

  const handleCreateShiftSubmit = async (e) => {
    e.preventDefault();
    try {
      const now = new Date();
      const start = startDateTime
        ? new Date(startDateTime).toISOString()
        : new Date(now.getTime() + 86400000).toISOString();
      const end = endDateTime
        ? new Date(endDateTime).toISOString()
        : new Date(now.getTime() + 86400000 + 21600000).toISOString();

      await api.post('/shifts', {
        venue_id: currentVenueId,
        title: eventName,
        start_time: start,
        end_time: end,
        hourly_rate: parseFloat(hourlyRate),
        is_shift_auto_confirm: isAutoConfirm,
        role_requirements: roleRequirements,
      });

      setNotification({
        type: 'success',
        message: `Shift "${eventName}" created with ${roleRequirements.length} role requirement(s)!`,
      });

      setShowCreateModal(false);
      setEventName('');
      setRoleRequirements([{ role: 'Bartender', quantity: 2 }]);
      fetchVenueData(currentVenueId);
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to create shifts.',
      });
    }
  };

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
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
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
              onClick={() => setShowCreateModal(true)}
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
                        <span>${shift?.hourly_rate}/hr</span>
                        <span>•</span>
                        <span>{new Date(shift?.start_time).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                      </div>
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
                        <span className="text-xs text-slate-500">
                          {worker?.email}
                        </span>
                      </div>

                      <div className="text-xs text-slate-400 mt-1 flex items-center space-x-2">
                        <span className="text-emerald-400 font-semibold">{shift?.title}</span>
                        <span>•</span>
                        <span>{shift?.role_type}</span>
                        <span>•</span>
                        <span>${shift?.hourly_rate}/hr</span>
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

        {/* Section 3: Scheduled Venue Shifts & Roster Overview */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
            <div className="flex items-center space-x-2">
              <CalendarIcon className="w-5 h-5 text-emerald-400" />
              <div>
                <h2 className="text-base font-bold text-white">
                  Scheduled Venue Shifts ({roster.length})
                </h2>
                <p className="text-xs text-slate-400">
                  Comprehensive scheduling overview & worker contact drill-down
                </p>
              </div>
            </div>

            {/* Toggle Control: Calendar vs List */}
            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 self-stretch sm:self-auto justify-center">
              <button
                type="button"
                onClick={() => setViewMode('calendar')}
                className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                  viewMode === 'calendar'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <CalendarIcon className="w-3.5 h-3.5" />
                <span>Calendar</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                  viewMode === 'list'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <ListIcon className="w-3.5 h-3.5" />
                <span>List</span>
              </button>
            </div>
          </div>

          {/* Calendar View (react-big-calendar) */}
          {viewMode === 'calendar' && (
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 min-h-[620px]">
              <Calendar
                localizer={localizer}
                events={calendarEvents}
                startAccessor="start"
                endAccessor="end"
                style={{ height: 600 }}
                onSelectEvent={(event) => setSelectedShift(event.resource)}
                views={['month', 'week', 'day', 'agenda']}
                defaultView="month"
                popup
                eventPropGetter={() => ({
                  style: {
                    backgroundColor: '#059669',
                    borderColor: '#10b981',
                    color: '#ffffff',
                    borderRadius: '6px',
                    padding: '2px 6px',
                    fontSize: '12px',
                    fontWeight: '600',
                    cursor: 'pointer',
                  },
                })}
              />
            </div>
          )}

          {/* List View: Table grouped by Date */}
          {viewMode === 'list' && (
            <div className="space-y-6">
              {Object.keys(shiftsByDate).length === 0 ? (
                <div className="text-center py-12 bg-slate-950/50 rounded-xl border border-slate-800">
                  <CalendarIcon className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                  <p className="text-xs text-slate-400">No shifts scheduled yet for this venue.</p>
                </div>
              ) : (
                Object.entries(shiftsByDate).map(([dateStr, dateShifts]) => (
                  <div key={dateStr} className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                    <div className="bg-slate-800/40 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
                      <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-2">
                        <CalendarIcon className="w-3.5 h-3.5 text-emerald-400" />
                        <span>{dateStr}</span>
                      </h3>
                      <span className="text-[11px] text-slate-400 font-medium">
                        {dateShifts.length} {dateShifts.length === 1 ? 'shift' : 'shifts'}
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-800/80 text-[11px] font-semibold text-slate-400 bg-slate-900/30 uppercase">
                            <th className="py-2.5 px-4">Shift Name</th>
                            <th className="py-2.5 px-4">Time</th>
                            <th className="py-2.5 px-4">Role Requirements</th>
                            <th className="py-2.5 px-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50 text-xs">
                          {dateShifts.map((shift) => {
                            const timeFormatted = shift.start_time && shift.end_time
                              ? `${new Date(shift.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${new Date(shift.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                              : 'TBD';
                            const assignedCount = shift.assigned_workers ? shift.assigned_workers.length : shift.spots_filled;

                            return (
                              <tr key={shift.id} className="hover:bg-slate-900/40 transition">
                                <td className="py-3 px-4 font-semibold text-white">
                                  <div>{shift.title || shift.name}</div>
                                  <div className="text-[11px] text-emerald-400 font-normal">
                                    ${Number(shift.hourly_rate).toFixed(2)}/hr
                                  </div>
                                </td>
                                <td className="py-3 px-4 text-slate-300">
                                  <span className="flex items-center space-x-1 text-xs">
                                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                                    <span>{timeFormatted}</span>
                                  </span>
                                </td>
                                <td className="py-3 px-4">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[11px] font-semibold uppercase">
                                      {shift.role_type}
                                    </span>
                                    <span className="text-slate-400 text-xs">
                                      ({assignedCount} / {shift.capacity} filled)
                                    </span>
                                  </div>
                                </td>
                                <td className="py-3 px-4 text-right">
                                  <div className="inline-flex items-center space-x-2">
                                    <button
                                      type="button"
                                      onClick={() => setActiveDiscussionShift(shift)}
                                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 hover:text-white font-medium text-xs border border-slate-700 transition inline-flex items-center space-x-1"
                                      title="Discussion Board"
                                    >
                                      <MessageSquare className="w-3 h-3 text-indigo-400" />
                                      <span>Board</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setSelectedShift(shift)}
                                      className="px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white font-semibold text-xs border border-emerald-600/30 transition inline-flex items-center space-x-1.5 shadow-sm"
                                    >
                                      <Users className="w-3.5 h-3.5" />
                                      <span>View Staff</span>
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
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
                  <label className="block text-xs font-medium text-slate-300 mb-1">Start DateTime</label>
                  <input
                    type="datetime-local"
                    value={startDateTime}
                    onChange={(e) => setStartDateTime(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">End DateTime</label>
                  <input
                    type="datetime-local"
                    value={endDateTime}
                    onChange={(e) => setEndDateTime(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Hourly Rate ($)</label>
                <input
                  type="number"
                  step="0.5"
                  required
                  value={hourlyRate}
                  onChange={(e) => setHourlyRate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Dynamic List for Role Requirements */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-xs font-semibold text-slate-300">
                    Role Requirements (Dynamic List)
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
                    <div key={idx} className="flex items-center space-x-2">
                      <select
                        value={row.role}
                        onChange={(e) => handleRoleChange(idx, 'role', e.target.value)}
                        className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                      >
                        <option value="Bartender">Bartender</option>
                        <option value="Server">Server</option>
                        <option value="Dishwasher">Dishwasher</option>
                        <option value="Barback">Barback</option>
                        <option value="AV Tech">AV Tech</option>
                      </select>

                      <input
                        type="number"
                        min="1"
                        value={row.quantity}
                        onChange={(e) => handleRoleChange(idx, 'quantity', e.target.value)}
                        className="w-20 px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                        placeholder="Qty"
                      />

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
                  Auto-Confirm Anyone (Instant auto-booking for all applicants)
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

      {/* Drill-Down Modal: Shift Staff Roster Details */}
      {selectedShift && (
        <ShiftRosterModal
          selectedShift={selectedShift}
          onClose={() => setSelectedShift(null)}
          setSelectedShift={setSelectedShift}
        />
      )}
    </div>
  );
}
