import React, { useState, useEffect } from 'react';
import api from '../api/client';
import {
  Shield, Building2, Plus, Users, Calendar, AlertCircle,
  Check, X, MapPin, Trash2, BarChart3, Briefcase
} from 'lucide-react';

export default function AdminPanel() {
  const [venues, setVenues] = useState([]);
  const [systemStats, setSystemStats] = useState({
    total_venues: 0,
    total_shifts: 0,
    open_shifts: 0,
    total_workers: 0,
    total_managers: 0,
    total_requests: 0,
    pending_requests: 0,
  });
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [notification, setNotification] = useState(null);

  // Form state for Create New Venue Modal
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [managerEmail, setManagerEmail] = useState('');
  const [geofenceRadius, setGeofenceRadius] = useState('150');
  const [autoApproveRating, setAutoApproveRating] = useState('4.5');

  const fetchAdminData = async () => {
    try {
      setLoading(true);
      const [venuesRes, statsRes] = await Promise.all([
        api.get('/admin/venues'),
        api.get('/admin/stats'),
      ]);
      setVenues(venuesRes.data || []);
      setSystemStats(statsRes.data || {});
    } catch (err) {
      console.error('Failed to load admin data:', err);
      setNotification({
        type: 'error',
        message: 'Failed to load platform data from admin endpoints.',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdminData();
  }, []);

  const handleCreateVenue = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post('/venues', {
        name,
        address,
        initial_manager_email: managerEmail || undefined,
        manager_email: managerEmail || undefined,
        geofence_radius_meters: parseInt(geofenceRadius, 10) || 100,
        auto_approve_rating_threshold: autoApproveRating ? parseFloat(autoApproveRating) : null,
      });

      setNotification({
        type: 'success',
        message: `Venue "${res.data.name}" created successfully${managerEmail ? ` and assigned to ${managerEmail}` : ''}!`,
      });

      setShowCreateModal(false);
      setName('');
      setAddress('');
      setManagerEmail('');
      fetchAdminData();
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to create venue.',
      });
    }
  };

  const handleDeleteVenue = async (venueId) => {
    if (!confirm('Are you sure you want to remove this venue from ShiftBoard?')) return;
    try {
      await api.delete(`/venues/${venueId}`);
      setNotification({
        type: 'info',
        message: 'Venue deleted.',
      });
      fetchAdminData();
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to delete venue.',
      });
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-16">
      {/* Header */}
      <section className="bg-slate-900 border-b border-slate-800 py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center space-x-4">
            <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-2xl border border-indigo-500/20">
              <Shield className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-white">Platform Administration</h1>
              <p className="text-xs text-slate-400 mt-0.5">
                Super Admin control panel for venue oversight, system analytics, and management.
              </p>
            </div>
          </div>

          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 font-bold text-slate-950 text-xs shadow-md shadow-emerald-500/20 transition flex items-center space-x-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Create New Venue</span>
          </button>
        </div>
      </section>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8 space-y-8">
        {notification && (
          <div
            className={`p-4 rounded-xl border flex items-center justify-between ${
              notification.type === 'success'
                ? 'bg-emerald-950/80 border-emerald-700 text-emerald-200'
                : notification.type === 'error'
                ? 'bg-rose-950/80 border-rose-700 text-rose-200'
                : 'bg-indigo-950/80 border-indigo-700 text-indigo-200'
            }`}
          >
            <div className="flex items-center space-x-2">
              {notification.type === 'success' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              <span className="text-sm font-medium">{notification.message}</span>
            </div>
            <button onClick={() => setNotification(null)} className="text-xs underline">Dismiss</button>
          </div>
        )}

        {/* System Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Venues</p>
            <h3 className="text-2xl font-black text-white mt-1">{systemStats.total_venues}</h3>
            <p className="text-xs text-slate-500 mt-2">Active business accounts</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Shifts</p>
            <h3 className="text-2xl font-black text-emerald-400 mt-1">{systemStats.total_shifts}</h3>
            <p className="text-xs text-slate-500 mt-2">{systemStats.open_shifts} currently open</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Workers</p>
            <h3 className="text-2xl font-black text-teal-400 mt-1">{systemStats.total_workers}</h3>
            <p className="text-xs text-slate-500 mt-2">Registered shift seekers</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Shift Requests</p>
            <h3 className="text-2xl font-black text-amber-400 mt-1">{systemStats.total_requests}</h3>
            <p className="text-xs text-slate-500 mt-2">{systemStats.pending_requests} pending approval</p>
          </div>
        </div>

        {/* Venues Data-Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
          <div className="p-6 border-b border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-white">Registered Venues</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Complete directory of venues on the ShiftBoard platform.
              </p>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 font-bold text-slate-950 text-xs flex items-center space-x-1.5 transition"
            >
              <Plus className="w-4 h-4" />
              <span>Create New Venue</span>
            </button>
          </div>

          {venues.length === 0 ? (
            <div className="text-center py-16 text-slate-500 text-xs">
              No venues registered. Click "Create New Venue" to add one.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950/70 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-5">Venue Name</th>
                    <th className="py-3 px-5">Address</th>
                    <th className="py-3 px-5">Geofence</th>
                    <th className="py-3 px-5">Auto-Approve Threshold</th>
                    <th className="py-3 px-5">Registered</th>
                    <th className="py-3 px-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {venues.map((venue) => (
                    <tr key={venue.id} className="hover:bg-slate-800/40 transition">
                      <td className="py-3.5 px-5 font-bold text-white flex items-center space-x-2">
                        <Building2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                        <span>{venue.name}</span>
                      </td>
                      <td className="py-3.5 px-5 text-slate-400 max-w-xs truncate">
                        {venue.address}
                      </td>
                      <td className="py-3.5 px-5 font-mono text-slate-300">
                        {venue.geofence_radius_meters}m
                      </td>
                      <td className="py-3.5 px-5">
                        <span className="px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-semibold">
                          ≥ {venue.auto_approve_rating_threshold || venue.global_auto_approve_min_rating || '4.5'}★
                        </span>
                      </td>
                      <td className="py-3.5 px-5 text-slate-500">
                        {new Date(venue.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-3.5 px-5 text-right">
                        <button
                          onClick={() => handleDeleteVenue(venue.id)}
                          title="Delete venue"
                          className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Modal: Create New Venue */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <Building2 className="w-5 h-5 text-emerald-400" />
                <span>Create New Venue</span>
              </h3>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateVenue} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Venue Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="The Grand Terrace"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Physical Address</label>
                <input
                  type="text"
                  required
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="450 Lexington Ave, New York, NY"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Assign Initial Manager Email
                </label>
                <input
                  type="email"
                  value={managerEmail}
                  onChange={(e) => setManagerEmail(e.target.value)}
                  placeholder="manager@venue.com"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  If user does not exist, an account with venue_manager role will be provisioned.
                </p>
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
                  <label className="block text-xs font-medium text-slate-300 mb-1">Auto-Approve Min Rating (★)</label>
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
                  Save Venue
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
