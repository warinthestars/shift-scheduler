import React, { useState, useEffect } from 'react';
import api from '../api/client';
import {
  Shield, Building2, Plus, UserPlus, MapPin, Check,
  AlertCircle, Trash2, Calendar, Clock, DollarSign
} from 'lucide-react';

export default function AdminPanel() {
  const [venues, setVenues] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState(null);

  // New Venue State
  const [venueName, setVenueName] = useState('');
  const [venueAddress, setVenueAddress] = useState('');
  const [venueLat, setVenueLat] = useState('40.7128');
  const [venueLng, setVenueLng] = useState('-74.0060');
  const [geofenceRadius, setGeofenceRadius] = useState('100');
  const [autoApproveRating, setAutoApproveRating] = useState('4.5');

  // Assign Manager State
  const [selectedVenueId, setSelectedVenueId] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');

  // New Shift State
  const [shiftVenueId, setShiftVenueId] = useState('');
  const [shiftTitle, setShiftTitle] = useState('');
  const [shiftRole, setShiftRole] = useState('Bartender');
  const [shiftRate, setShiftRate] = useState('35.00');
  const [shiftSpots, setShiftSpots] = useState('2');
  const [shiftAutoConfirm, setShiftAutoConfirm] = useState(false);
  const [shiftStart, setShiftStart] = useState('');
  const [shiftEnd, setShiftEnd] = useState('');

  const loadAdminData = async () => {
    try {
      setLoading(true);
      const [venuesRes, usersRes] = await Promise.all([
        api.get('/venues'),
        api.get('/users'),
      ]);
      setVenues(venuesRes.data);
      setUsers(usersRes.data);
      if (venuesRes.data.length > 0) {
        setSelectedVenueId(venuesRes.data[0].id);
        setShiftVenueId(venuesRes.data[0].id);
      }
      if (usersRes.data.length > 0) {
        setSelectedUserId(usersRes.data[0].id);
      }
    } catch (err) {
      console.error('Failed to load admin data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAdminData();
  }, []);

  const handleCreateVenue = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post('/venues', {
        name: venueName,
        address: venueAddress,
        latitude: parseFloat(venueLat),
        longitude: parseFloat(venueLng),
        geofence_radius_meters: parseInt(geofenceRadius, 10),
        global_auto_approve_min_rating: autoApproveRating ? parseFloat(autoApproveRating) : null,
      });
      setStatusMsg({ type: 'success', text: `Venue "${res.data.name}" created successfully!` });
      setVenueName('');
      setVenueAddress('');
      loadAdminData();
    } catch (err) {
      setStatusMsg({ type: 'error', text: err.response?.data?.detail || 'Failed to create venue.' });
    }
  };

  const handleAssignManager = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/venues/${selectedVenueId}/managers`, {
        user_id: selectedUserId,
        is_primary: false,
      });
      setStatusMsg({ type: 'success', text: 'Venue manager assigned successfully!' });
      loadAdminData();
    } catch (err) {
      setStatusMsg({ type: 'error', text: err.response?.data?.detail || 'Failed to assign manager.' });
    }
  };

  const handleCreateShift = async (e) => {
    e.preventDefault();
    try {
      const now = new Date();
      const start = shiftStart ? new Date(shiftStart).toISOString() : new Date(now.getTime() + 86400000).toISOString();
      const end = shiftEnd ? new Date(shiftEnd).toISOString() : new Date(now.getTime() + 86400000 + 21600000).toISOString();

      await api.post('/shifts', {
        venue_id: shiftVenueId,
        title: shiftTitle,
        role_required: shiftRole,
        start_time: start,
        end_time: end,
        hourly_rate: parseFloat(shiftRate),
        spots_needed: parseInt(shiftSpots, 10),
        auto_confirm_anyone: shiftAutoConfirm,
      });

      setStatusMsg({ type: 'success', text: `Shift "${shiftTitle}" posted to the call-board!` });
      setShiftTitle('');
    } catch (err) {
      setStatusMsg({ type: 'error', text: err.response?.data?.detail || 'Failed to post shift.' });
    }
  };

  const handleDeleteVenue = async (venueId) => {
    if (!confirm('Are you sure you want to delete this venue?')) return;
    try {
      await api.delete(`/venues/${venueId}`);
      setStatusMsg({ type: 'success', text: 'Venue deleted.' });
      loadAdminData();
    } catch (err) {
      setStatusMsg({ type: 'error', text: err.response?.data?.detail || 'Failed to delete venue.' });
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-16">
      {/* Header */}
      <section className="bg-slate-900 border-b border-slate-800 py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex items-center space-x-3">
          <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-2xl border border-indigo-500/20">
            <Shield className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white">Super Admin Control Panel</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Manage platform venues, assign venue managers, and post system-wide shifts.
            </p>
          </div>
        </div>
      </section>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8 space-y-8">
        {/* Status Alerts */}
        {statusMsg && (
          <div
            className={`p-4 rounded-xl border flex items-center justify-between ${
              statusMsg.type === 'success'
                ? 'bg-emerald-950/80 border-emerald-700 text-emerald-200'
                : 'bg-rose-950/80 border-rose-700 text-rose-200'
            }`}
          >
            <div className="flex items-center space-x-2">
              {statusMsg.type === 'success' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              <span className="text-sm font-medium">{statusMsg.text}</span>
            </div>
            <button onClick={() => setStatusMsg(null)} className="text-xs underline">Dismiss</button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column: Create Venue & Assign Manager */}
          <div className="space-y-8">
            {/* Create Venue Form */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <h3 className="text-base font-bold text-white mb-4 flex items-center space-x-2">
                <Building2 className="w-5 h-5 text-emerald-400" />
                <span>Register New Venue</span>
              </h3>
              <form onSubmit={handleCreateVenue} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Venue Name</label>
                  <input
                    type="text"
                    required
                    value={venueName}
                    onChange={(e) => setVenueName(e.target.value)}
                    placeholder="The Rooftop Bar & Grill"
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Physical Address</label>
                  <input
                    type="text"
                    required
                    value={venueAddress}
                    onChange={(e) => setVenueAddress(e.target.value)}
                    placeholder="123 Main St, New York, NY"
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Latitude</label>
                    <input
                      type="number"
                      step="any"
                      required
                      value={venueLat}
                      onChange={(e) => setVenueLat(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Longitude</label>
                    <input
                      type="number"
                      step="any"
                      required
                      value={venueLng}
                      onChange={(e) => setVenueLng(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Geofence Radius (m)</label>
                    <input
                      type="number"
                      required
                      value={geofenceRadius}
                      onChange={(e) => setGeofenceRadius(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Auto-Approve Rating (★)</label>
                    <input
                      type="number"
                      step="0.1"
                      min="1.0"
                      max="5.0"
                      value={autoApproveRating}
                      onChange={(e) => setAutoApproveRating(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full mt-2 py-2 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 font-bold text-slate-950 text-xs shadow-md shadow-emerald-500/20 transition flex items-center justify-center space-x-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create Venue</span>
                </button>
              </form>
            </div>

            {/* Assign Venue Manager Form */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <h3 className="text-base font-bold text-white mb-4 flex items-center space-x-2">
                <UserPlus className="w-5 h-5 text-indigo-400" />
                <span>Assign Venue Manager</span>
              </h3>
              <form onSubmit={handleAssignManager} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Select Venue</label>
                  <select
                    value={selectedVenueId}
                    onChange={(e) => setSelectedVenueId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    {venues.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Select User to Promote</label>
                  <select
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.first_name} {u.last_name} ({u.email})
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="submit"
                  className="w-full mt-2 py-2 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-bold text-white text-xs shadow-md shadow-indigo-600/20 transition flex items-center justify-center space-x-1.5"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Assign Manager</span>
                </button>
              </form>
            </div>
          </div>

          {/* Right Columns: Registered Venues & Post Shifts */}
          <div className="lg:col-span-2 space-y-8">
            {/* Post Shift Form */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <h3 className="text-base font-bold text-white mb-4 flex items-center space-x-2">
                <Calendar className="w-5 h-5 text-emerald-400" />
                <span>Post New Shift to Call-Board</span>
              </h3>
              <form onSubmit={handleCreateShift} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Venue</label>
                  <select
                    value={shiftVenueId}
                    onChange={(e) => setShiftVenueId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                  >
                    {venues.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Shift Title</label>
                  <input
                    type="text"
                    required
                    value={shiftTitle}
                    onChange={(e) => setShiftTitle(e.target.value)}
                    placeholder="Weekend Prime Bar Service"
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Role Required</label>
                  <select
                    value={shiftRole}
                    onChange={(e) => setShiftRole(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="Bartender">Bartender</option>
                    <option value="Server">Server</option>
                    <option value="Dishwasher">Dishwasher</option>
                    <option value="Barback">Barback</option>
                    <option value="AV Tech">AV Tech</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Hourly ($)</label>
                    <input
                      type="number"
                      step="0.5"
                      required
                      value={shiftRate}
                      onChange={(e) => setShiftRate(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Spots Needed</label>
                    <input
                      type="number"
                      min="1"
                      required
                      value={shiftSpots}
                      onChange={(e) => setShiftSpots(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div className="md:col-span-2 flex items-center space-x-2 pt-2">
                  <input
                    type="checkbox"
                    id="autoConfirmCheck"
                    checked={shiftAutoConfirm}
                    onChange={(e) => setShiftAutoConfirm(e.target.checked)}
                    className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-emerald-500 focus:ring-emerald-500"
                  />
                  <label htmlFor="autoConfirmCheck" className="text-xs font-medium text-slate-300">
                    Auto-Confirm Anyone (Condition 1 in Engine: bypasses whitelist and rating checks)
                  </label>
                </div>

                <div className="md:col-span-2">
                  <button
                    type="submit"
                    className="w-full py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 font-bold text-slate-950 text-xs shadow-md shadow-emerald-500/20 transition flex items-center justify-center space-x-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Publish Shift to Call-Board</span>
                  </button>
                </div>
              </form>
            </div>

            {/* Venues List */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <h3 className="text-base font-bold text-white mb-4">
                Registered Venues ({venues.length})
              </h3>
              <div className="space-y-3">
                {venues.map((venue) => (
                  <div
                    key={venue.id}
                    className="p-4 bg-slate-950/60 border border-slate-800 rounded-xl flex items-center justify-between"
                  >
                    <div>
                      <h4 className="text-sm font-bold text-white">{venue.name}</h4>
                      <p className="text-xs text-slate-400 flex items-center space-x-1 mt-0.5">
                        <MapPin className="w-3.5 h-3.5 text-slate-500" />
                        <span>{venue.address}</span>
                      </p>
                      <div className="flex items-center space-x-3 text-xs text-slate-500 mt-2">
                        <span>Geofence: {venue.geofence_radius_meters}m</span>
                        <span>•</span>
                        <span>Auto-Approve Threshold: ≥ {venue.global_auto_approve_min_rating || 'None'}★</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteVenue(venue.id)}
                      className="p-2 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition"
                      title="Delete venue"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
