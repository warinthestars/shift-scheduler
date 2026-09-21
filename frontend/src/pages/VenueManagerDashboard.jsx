import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import {
  Calendar, Clock, DollarSign, Users, Plus, Trash2, Check, X,
  Building2, Star, AlertCircle, ShieldCheck, Zap, ArrowRight
} from 'lucide-react';

export default function VenueManagerDashboard() {
  const { user } = useAuth();
  const [venueShifts, setVenueShifts] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [currentVenueId, setCurrentVenueId] = useState(user?.venue_id || null);
  const [venueDetails, setVenueDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [notification, setNotification] = useState(null);

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
      // If venueId is not known, fetch available venues first
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

      const [shiftsRes, requestsRes, venueRes] = await Promise.all([
        api.get(`/venues/${activeId}/shifts`),
        api.get(`/venues/${activeId}/requests/pending`),
        api.get(`/venues/${activeId}`),
      ]);

      setVenueShifts(shiftsRes.data || []);
      setPendingRequests(requestsRes.data || []);
      setVenueDetails(venueRes.data || null);
    } catch (err) {
      console.error('Error fetching venue manager dashboard:', err);
      setNotification({
        type: 'error',
        message: 'Could not load venue shifts or approval queue from backend.',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVenueData(user?.venue_id);
  }, [user?.venue_id]);

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

          <div className="flex items-center space-x-3">
            <button
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

        {/* Section 1: Approval Queue */}
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
                        onClick={() => handleApprove(req.id)}
                        disabled={actionLoading === `approve-${req.id}`}
                        className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center space-x-1 shadow-md shadow-emerald-600/20 disabled:opacity-50"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Approve</span>
                      </button>
                      <button
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

        {/* Section 2: Venue Shifts */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <Calendar className="w-5 h-5 text-emerald-400" />
              <h2 className="text-base font-bold text-white">
                Scheduled Venue Shifts ({venueShifts.length})
              </h2>
            </div>
          </div>

          {venueShifts.length === 0 ? (
            <div className="text-center py-12 bg-slate-950/50 rounded-xl border border-slate-800">
              <Calendar className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="text-xs text-slate-400">No shifts created yet for this venue.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {venueShifts.map((shift) => (
                <div
                  key={shift.id}
                  className="bg-slate-950 border border-slate-800 p-4 rounded-xl flex flex-col justify-between"
                >
                  <div>
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-xs font-bold text-slate-300 uppercase px-2 py-0.5 rounded bg-slate-800">
                        {shift.role_type}
                      </span>
                      <span className="text-sm font-black text-emerald-400">
                        ${Number(shift.hourly_rate).toFixed(2)}/hr
                      </span>
                    </div>

                    <h4 className="text-sm font-bold text-white mb-1">{shift.title}</h4>
                    <p className="text-xs text-slate-400 flex items-center space-x-1 mb-2">
                      <Clock className="w-3 h-3 text-slate-500" />
                      <span>{new Date(shift.start_time).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    </p>

                    <div className="text-xs text-slate-400">
                      Spots: <span className="text-white font-semibold">{shift.spots_filled} / {shift.capacity} filled</span>
                    </div>
                  </div>

                  <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                    {shift.is_shift_auto_confirm ? (
                      <span className="text-emerald-400 flex items-center space-x-1 font-medium">
                        <Zap className="w-3 h-3" />
                        <span>Auto-Confirm Anyone</span>
                      </span>
                    ) : (
                      <span className="text-slate-500">Standard Review</span>
                    )}
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 text-xs">
                      {shift.status}
                    </span>
                  </div>
                </div>
              ))}
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
    </div>
  );
}
