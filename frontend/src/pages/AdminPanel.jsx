import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import {
  Shield, Building2, Plus, Users, Calendar, AlertCircle,
  Check, X, MapPin, Trash2, BarChart3, Briefcase, Search,
  UserPlus, CheckCircle2, XCircle, Power, UserCheck, Pencil
} from 'lucide-react';
import VenueSettingsModal from '../components/VenueSettingsModal';

export default function AdminPanel() {
  const { user: currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState('venues'); // 'venues' | 'users'
  const [venues, setVenues] = useState([]);
  const [users, setUsers] = useState([]);
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
  const [venueModal, setVenueModal] = useState(null); // null | { mode: 'create' | 'edit', venue: null | venueObj }
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [userToDelete, setUserToDelete] = useState(null);
  const [deletingUser, setDeletingUser] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [editRole, setEditRole] = useState('worker');
  const [editVenueIds, setEditVenueIds] = useState([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const [notification, setNotification] = useState(null);

  // Form state for Create New User Modal
  const [userEmail, setUserEmail] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [userFirstName, setUserFirstName] = useState('');
  const [userLastName, setUserLastName] = useState('');
  const [userPhone, setUserPhone] = useState('');
  const [userRole, setUserRole] = useState('worker');
  const [selectedVenueIds, setSelectedVenueIds] = useState([]);
  const [creatingUser, setCreatingUser] = useState(false);
  const [togglingUserId, setTogglingUserId] = useState(null);

  // Filters for User Management Table
  const [userSearchTerm, setUserSearchTerm] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('ALL');

  const fetchAdminData = async () => {
    try {
      setLoading(true);
      const [venuesRes, statsRes, usersRes] = await Promise.all([
        api.get('/admin/venues'),
        api.get('/admin/stats'),
        api.get('/admin/users').catch(() => ({ data: [] })),
      ]);
      setVenues(venuesRes.data || []);
      setSystemStats(statsRes.data || {});
      setUsers(usersRes.data || []);
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

  const handleCreateUser = async (e) => {
    e.preventDefault();
    try {
      setCreatingUser(true);
      const payload = {
        email: userEmail.trim(),
        password: userPassword,
        first_name: userFirstName.trim(),
        last_name: userLastName.trim(),
        phone: userPhone.trim() || undefined,
        role: userRole,
        venue_ids: userRole === 'platform_admin' ? [] : selectedVenueIds,
      };

      const res = await api.post('/admin/users', payload);
      setUsers((prev) => [res.data, ...prev]);
      setNotification({
        type: 'success',
        message: `User ${res.data.first_name} ${res.data.last_name} (${res.data.role}) provisioned successfully!`,
      });

      setShowCreateUserModal(false);
      setUserEmail('');
      setUserPassword('');
      setUserFirstName('');
      setUserLastName('');
      setUserPhone('');
      setUserRole('worker');
      setSelectedVenueIds([]);
      fetchAdminData();
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to create user.',
      });
    } finally {
      setCreatingUser(false);
    }
  };

  const handleToggleUserStatus = async (user) => {
    try {
      setTogglingUserId(user.id);
      const newStatus = !user.is_active;
      const res = await api.patch(`/admin/users/${user.id}`, { is_active: newStatus });
      setUsers((prev) => prev.map((u) => (u.id === user.id ? res.data : u)));
      setNotification({
        type: 'success',
        message: `User ${user.first_name} ${user.last_name} marked as ${newStatus ? 'Active' : 'Inactive'}.`,
      });
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to update user status.',
      });
    } finally {
      setTogglingUserId(null);
    }
  };

  const handleDeleteUser = async () => {
    if (!userToDelete) return;
    setDeletingUser(true);
    try {
      await api.delete(`/admin/users/${userToDelete.id}`);
      setUsers((prev) => prev.filter((u) => u.id !== userToDelete.id));
      setNotification({ type: 'success', message: `Deleted ${userToDelete.email}.` });
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to delete user.',
      });
    } finally {
      setDeletingUser(false);
      setUserToDelete(null);
    }
  };

  const normalizeRole = (r) => {
    const v = (r || '').toLowerCase();
    return v === 'super_admin' ? 'platform_admin' : v || 'worker';
  };

  const openEditUser = (u) => {
    setEditingUser(u);
    setEditRole(normalizeRole(u.role));
    setEditVenueIds((u.venue_ids || []).map(String));
  };

  const toggleEditVenue = (venueId) => {
    const id = String(venueId);
    setEditVenueIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSaveUserEdit = async () => {
    if (!editingUser) return;
    if (editRole === 'venue_manager' && editVenueIds.length === 0) {
      setNotification({ type: 'error', message: 'Pick at least one venue for a Venue Manager.' });
      return;
    }
    setSavingEdit(true);
    try {
      const payload = {
        role: editRole,
        venue_ids: editRole === 'platform_admin' ? [] : editVenueIds,
      };
      const res = await api.patch(`/admin/users/${editingUser.id}`, payload);
      setUsers((prev) => prev.map((u) => (u.id === editingUser.id ? res.data : u)));
      const roleLabel = editRole === 'platform_admin' ? 'Platform Admin' : editRole === 'venue_manager' ? 'Venue Manager' : 'Worker';
      setNotification({
        type: 'success',
        message: `${res.data.first_name} ${res.data.last_name} is now a ${roleLabel}. They'll see the change the next time they refresh or sign in.`,
      });
      setEditingUser(null);
      fetchAdminData();
    } catch (err) {
      setNotification({ type: 'error', message: err.response?.data?.detail || 'Failed to update user.' });
    } finally {
      setSavingEdit(false);
    }
  };

  const handleToggleVenueSelection = (venueId) => {
    setSelectedVenueIds((prev) =>
      prev.includes(venueId) ? prev.filter((id) => id !== venueId) : [...prev, venueId]
    );
  };

  // Filter users based on search term & role filter
  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      userSearchTerm === '' ||
      `${u.first_name} ${u.last_name}`.toLowerCase().includes(userSearchTerm.toLowerCase()) ||
      u.email.toLowerCase().includes(userSearchTerm.toLowerCase());

    const matchesRole =
      userRoleFilter === 'ALL' ||
      u.role.toLowerCase() === userRoleFilter.toLowerCase();

    return matchesSearch && matchesRole;
  });

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
                Super Admin control panel for venue oversight, user provisioning, and platform analytics.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={() => setShowCreateUserModal(true)}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-bold text-white text-xs shadow-md shadow-indigo-600/20 transition flex items-center space-x-1.5"
            >
              <UserPlus className="w-4 h-4" />
              <span>Create New User</span>
            </button>
            <button
              onClick={() => setVenueModal({ mode: 'create', venue: null })}
              className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 font-bold text-slate-950 text-xs shadow-md shadow-emerald-500/20 transition flex items-center space-x-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Create New Venue</span>
            </button>
          </div>
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
            <p className="text-xs text-slate-500 mt-2">Active business locations</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Shifts</p>
            <h3 className="text-2xl font-black text-emerald-400 mt-1">{systemStats.total_shifts}</h3>
            <p className="text-xs text-slate-500 mt-2">{systemStats.open_shifts} currently open</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Users (Total / Workers)</p>
            <h3 className="text-2xl font-black text-teal-400 mt-1">
              {users.length || systemStats.total_workers}
            </h3>
            <p className="text-xs text-slate-500 mt-2">
              {systemStats.total_workers} workers, {systemStats.total_managers} managers
            </p>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Shift Requests</p>
            <h3 className="text-2xl font-black text-amber-400 mt-1">{systemStats.total_requests}</h3>
            <p className="text-xs text-slate-500 mt-2">{systemStats.pending_requests} pending approval</p>
          </div>
        </div>

        {/* Tab Switcher: Venues vs Users */}
        <div className="flex border-b border-slate-800 space-x-6">
          <button
            onClick={() => setActiveTab('venues')}
            className={`pb-3 text-sm font-bold flex items-center space-x-2 border-b-2 transition ${
              activeTab === 'venues'
                ? 'border-emerald-400 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Building2 className="w-4 h-4" />
            <span>Venues Directory ({venues.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('users')}
            className={`pb-3 text-sm font-bold flex items-center space-x-2 border-b-2 transition ${
              activeTab === 'users'
                ? 'border-indigo-400 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>User Management ({users.length})</span>
          </button>
        </div>

        {/* TAB 1: VENUES TABLE */}
        {activeTab === 'venues' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
            <div className="p-6 border-b border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-white">Registered Venues</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Complete directory of venues with live shift, manager, and worker affiliations.
                </p>
              </div>
              <button
                onClick={() => setVenueModal({ mode: 'create', venue: null })}
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
                      <th className="py-3 px-5 text-center">Active Shifts</th>
                      <th className="py-3 px-5 text-center">Managers</th>
                      <th className="py-3 px-5 text-center">Workers</th>
                      <th className="py-3 px-5">Geofence</th>
                      <th className="py-3 px-5">Auto-Approve</th>
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
                        <td className="py-3.5 px-5 text-center">
                          <span className="px-2 py-0.5 rounded-full bg-slate-800 text-emerald-400 border border-slate-700 font-mono font-bold">
                            {venue.total_shifts ?? venue.shifts_count ?? 0}
                          </span>
                        </td>
                        <td className="py-3.5 px-5 text-center">
                          <span className="px-2 py-0.5 rounded-full bg-slate-800 text-amber-400 border border-slate-700 font-mono font-bold">
                            {venue.total_managers ?? venue.managers_count ?? 0}
                          </span>
                        </td>
                        <td className="py-3.5 px-5 text-center">
                          <span className="px-2 py-0.5 rounded-full bg-slate-800 text-teal-400 border border-slate-700 font-mono font-bold">
                            {venue.assigned_workers_count ?? venue.workers_count ?? 0}
                          </span>
                        </td>
                        <td className="py-3.5 px-5 font-mono text-slate-300">
                          {venue.geofence_radius_meters}m
                        </td>
                        <td className="py-3.5 px-5">
                          <span className="px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-semibold">
                            {venue.auto_approve_rating_threshold ? `≥ ${venue.auto_approve_rating_threshold}★ (rated workers)` : 'Manual review'}
                          </span>
                        </td>
                        <td className="py-3.5 px-5 text-slate-500">
                          {new Date(venue.created_at).toLocaleDateString()}
                        </td>
                        <td className="py-3.5 px-5 text-right">
                          <div className="inline-flex items-center space-x-1">
                            <button
                              onClick={() => setVenueModal({ mode: 'edit', venue })}
                              title="Edit Venue Settings"
                              className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-400 hover:bg-slate-800 transition"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteVenue(venue.id)}
                              title="Delete venue"
                              className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: USER MANAGEMENT TABLE */}
        {activeTab === 'users' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden space-y-4">
            <div className="p-6 border-b border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-white">Platform Users Directory</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Manage worker and manager permissions, affiliations, and active account status.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                {/* Search */}
                <div className="relative flex-1 md:w-64">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={userSearchTerm}
                    onChange={(e) => setUserSearchTerm(e.target.value)}
                    placeholder="Search by name or email..."
                    className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                {/* Role Filter */}
                <select
                  value={userRoleFilter}
                  onChange={(e) => setUserRoleFilter(e.target.value)}
                  className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
                >
                  <option value="ALL">All Roles</option>
                  <option value="worker">Workers</option>
                  <option value="venue_manager">Venue Managers</option>
                  <option value="platform_admin">Platform Admins</option>
                </select>

                <button
                  onClick={() => setShowCreateUserModal(true)}
                  className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-bold text-white text-xs flex items-center space-x-1.5 transition shadow-md shadow-indigo-600/20"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Create User</span>
                </button>
              </div>
            </div>

            {filteredUsers.length === 0 ? (
              <div className="text-center py-16 text-slate-500 text-xs">
                No users found matching your search and filter criteria.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950/70 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
                    <tr>
                      <th className="py-3 px-5">User</th>
                      <th className="py-3 px-5">Email</th>
                      <th className="py-3 px-5">Role</th>
                      <th className="py-3 px-5">Affiliated Venues</th>
                      <th className="py-3 px-5">Rating & Shifts</th>
                      <th className="py-3 px-5 text-center">Status</th>
                      <th className="py-3 px-5">Registered</th>
                      <th className="py-3 px-5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {filteredUsers.map((u) => {
                      const roleNorm = (u.role || '').toLowerCase();
                      const isToggling = togglingUserId === u.id;
                      const hasVenues = u.venue_names && u.venue_names.length > 0;

                      return (
                        <tr key={u.id} className="hover:bg-slate-800/40 transition">
                          {/* Name + Initials */}
                          <td className="py-3.5 px-5 font-bold text-white flex items-center space-x-3">
                            <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-slate-200 uppercase flex-shrink-0">
                              {u.first_name?.[0] || 'U'}{u.last_name?.[0] || ''}
                            </div>
                            <div>
                              <div className="text-white font-bold">{u.first_name} {u.last_name}</div>
                              {u.phone && <div className="text-[11px] text-slate-500">{u.phone}</div>}
                            </div>
                          </td>

                          {/* Email */}
                          <td className="py-3.5 px-5 font-mono text-slate-300">
                            {u.email}
                          </td>

                          {/* Role Badge */}
                          <td className="py-3.5 px-5">
                            {roleNorm === 'platform_admin' || roleNorm === 'super_admin' ? (
                              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
                                Platform Admin
                              </span>
                            ) : roleNorm === 'venue_manager' ? (
                              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                                Venue Manager
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                                Worker
                              </span>
                            )}
                          </td>

                          {/* Affiliated Venues Chips */}
                          <td className="py-3.5 px-5 max-w-xs">
                            {roleNorm === 'platform_admin' || roleNorm === 'super_admin' ? (
                              <span className="text-[11px] px-2 py-0.5 rounded bg-indigo-950/60 border border-indigo-800/60 text-indigo-300">
                                Omnipresent (All Venues)
                              </span>
                            ) : hasVenues ? (
                              <div className="flex flex-wrap gap-1">
                                {u.venue_names.map((vName, idx) => (
                                  <span
                                    key={idx}
                                    className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700"
                                  >
                                    {vName}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-slate-500 italic text-[11px]">None assigned</span>
                            )}
                          </td>

                          {/* Rating & Shifts */}
                          <td className="py-3.5 px-5">
                            <div className="flex items-center space-x-1.5 text-slate-300">
                              <span className="text-amber-400 font-bold">★ {Number(u.aggregate_rating || 5.0).toFixed(1)}</span>
                              <span className="text-slate-500 text-[11px]">({u.rating_count || 0})</span>
                              <span className="text-slate-600">•</span>
                              <span className="text-slate-400 text-[11px]">{u.total_shifts || 0} shifts</span>
                            </div>
                          </td>

                          {/* Status Toggle Button */}
                          <td className="py-3.5 px-5 text-center">
                            <button
                              type="button"
                              onClick={() => handleToggleUserStatus(u)}
                              disabled={isToggling}
                              title={u.is_active ? 'Click to deactivate user' : 'Click to activate user'}
                              className={`px-3 py-1 rounded-full text-xs font-bold transition flex items-center space-x-1 mx-auto ${
                                u.is_active
                                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-rose-500/20 hover:text-rose-400 hover:border-rose-500/30'
                                  : 'bg-rose-500/15 text-rose-400 border border-rose-500/30 hover:bg-emerald-500/20 hover:text-emerald-400 hover:border-emerald-500/30'
                              } disabled:opacity-50`}
                            >
                              <Power className="w-3 h-3" />
                              <span>{isToggling ? '...' : u.is_active ? 'Active' : 'Inactive'}</span>
                            </button>
                          </td>

                          {/* Registered Date */}
                          <td className="py-3.5 px-5 text-slate-500">
                            {new Date(u.created_at).toLocaleDateString()}
                          </td>

                          {/* Actions */}
                          <td className="py-3.5 px-5 text-right">
                            <div className="inline-flex items-center space-x-1">
                              <button
                                type="button"
                                onClick={() => openEditUser(u)}
                                className="p-2 text-slate-500 hover:text-amber-400 rounded-lg hover:bg-amber-500/10 transition"
                                title="Edit role & venues"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              {currentUser?.id !== u.id && (
                                <button
                                  type="button"
                                  onClick={() => setUserToDelete(u)}
                                  className="p-2 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-rose-500/10 transition"
                                  title="Delete user"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Modal: Create / Edit Venue (Phase 25) */}
      {venueModal && (
        <VenueSettingsModal
          mode={venueModal.mode}
          venue={venueModal.venue}
          onClose={() => setVenueModal(null)}
          onSaved={(savedVenue) => {
            setNotification({
              type: 'success',
              message: venueModal.mode === 'create'
                ? `Venue "${savedVenue.name}" created successfully!`
                : `Settings for "${savedVenue.name}" updated successfully.`,
            });
            fetchAdminData();
          }}
        />
      )}

      {/* Modal: Create New User (Phase 20) */}
      {showCreateUserModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-2 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <UserPlus className="w-5 h-5 text-indigo-400" />
                <span>Create New User</span>
              </h3>
              <button onClick={() => setShowCreateUserModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">First Name *</label>
                  <input
                    type="text"
                    required
                    value={userFirstName}
                    onChange={(e) => setUserFirstName(e.target.value)}
                    placeholder="Alice"
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Last Name *</label>
                  <input
                    type="text"
                    required
                    value={userLastName}
                    onChange={(e) => setUserLastName(e.target.value)}
                    placeholder="Smith"
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Email Address *</label>
                <input
                  type="email"
                  required
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                  placeholder="alice.smith@example.com"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Temporary Password *</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={userPassword}
                  onChange={(e) => setUserPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Phone Number (Optional)</label>
                <input
                  type="tel"
                  value={userPhone}
                  onChange={(e) => setUserPhone(e.target.value)}
                  placeholder="+1 (555) 012-3456"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Role *</label>
                <select
                  value={userRole}
                  onChange={(e) => setUserRole(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="worker">Worker (Shift Seeker)</option>
                  <option value="venue_manager">Venue Manager (Operations)</option>
                  <option value="platform_admin">Platform Admin (Super Admin)</option>
                </select>
              </div>

              {/* Affiliated Venues Multi-Select (for worker or venue_manager) */}
              {userRole !== 'platform_admin' ? (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Affiliated Venues ({selectedVenueIds.length} selected)
                  </label>
                  <p className="text-[11px] text-slate-500 mb-2">
                    {userRole === 'venue_manager'
                      ? 'Select which venues this manager will oversee:'
                      : 'Select which venues this worker belongs to:'}
                  </p>
                  <div className="max-h-40 overflow-y-auto space-y-1.5 p-2.5 bg-slate-950 border border-slate-800 rounded-xl">
                    {venues.length === 0 ? (
                      <p className="text-slate-500 text-xs italic">No venues available.</p>
                    ) : (
                      venues.map((venue) => {
                        const isChecked = selectedVenueIds.includes(venue.id);
                        return (
                          <label
                            key={venue.id}
                            className={`flex items-center space-x-2.5 p-2 rounded-lg cursor-pointer text-xs transition ${
                              isChecked ? 'bg-indigo-950/60 text-white font-medium' : 'text-slate-400 hover:bg-slate-800/40'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleToggleVenueSelection(venue.id)}
                              className="w-4 h-4 rounded text-indigo-600 bg-slate-800 border-slate-700 focus:ring-indigo-500 focus:ring-offset-slate-900"
                            />
                            <div className="truncate">
                              <span className="text-white font-medium">{venue.name}</span>
                              <span className="text-slate-500 text-[11px] ml-2">({venue.address})</span>
                            </div>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-indigo-950/50 border border-indigo-800/50 rounded-xl text-xs text-indigo-300 space-y-1">
                  <p className="font-semibold flex items-center space-x-1">
                    <Shield className="w-3.5 h-3.5" />
                    <span>Omnipresent Access</span>
                  </p>
                  <p className="text-[11px] text-indigo-200/80">
                    Platform Admins automatically bypass venue boundaries and have administrative access to all venues across ShiftBoard.
                  </p>
                </div>
              )}

              <div className="pt-3 border-t border-slate-800 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowCreateUserModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-xs font-semibold text-slate-300 hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingUser}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition disabled:opacity-50 shadow-md shadow-indigo-600/20 flex items-center space-x-1.5"
                >
                  <UserCheck className="w-4 h-4" />
                  <span>{creatingUser ? 'Creating...' : 'Provision User'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit User */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-lg font-bold text-white">Edit {editingUser.first_name} {editingUser.last_name}</h3>
                <p className="text-xs text-slate-400 font-mono">{editingUser.email}</p>
              </div>
              <button type="button" onClick={() => setEditingUser(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-2">Role</label>
              {currentUser?.id === editingUser.id && (
                <p className="text-[11px] text-amber-300 mb-2">You can't change your own role.</p>
              )}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'worker', label: 'Worker', cls: 'emerald' },
                  { id: 'venue_manager', label: 'Venue Manager', cls: 'amber' },
                  { id: 'platform_admin', label: 'Platform Admin', cls: 'indigo' },
                ].map((opt) => {
                  const selected = editRole === opt.id;
                  const disabled = currentUser?.id === editingUser.id;
                  const tone = {
                    emerald: 'border-emerald-500 bg-emerald-500/15 text-emerald-300',
                    amber: 'border-amber-500 bg-amber-500/15 text-amber-300',
                    indigo: 'border-indigo-500 bg-indigo-500/15 text-indigo-300',
                  }[opt.cls];
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => setEditRole(opt.id)}
                      className={`px-3 py-2 rounded-xl border text-xs font-semibold transition disabled:opacity-50 ${
                        selected ? tone : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {editRole === 'platform_admin' ? (
              <p className="text-xs text-slate-400 bg-slate-800/60 border border-slate-700 rounded-xl p-3">
                Platform admins can access every venue. Existing venue assignments will be cleared.
              </p>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  {editRole === 'venue_manager' ? 'Managed venues (required)' : 'Pre-approved venues (optional)'}
                </label>
                <p className="text-[11px] text-slate-500 mb-2">
                  {editRole === 'venue_manager'
                    ? 'This person will manage shifts, rosters and approvals for the selected venues.'
                    : "Workers on a venue's whitelist are pre-approved to pick up its shifts."}
                </p>
                {venues.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">No venues exist yet. Create one first.</p>
                ) : (
                  <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {venues.map((v) => {
                      const checked = editVenueIds.includes(String(v.id));
                      return (
                        <label
                          key={v.id}
                          className={`flex items-center space-x-2.5 p-2 rounded-lg border cursor-pointer transition ${
                            checked ? 'border-amber-500/50 bg-amber-500/10' : 'border-slate-800 bg-slate-950 hover:border-slate-600'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleEditVenue(v.id)}
                            className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-amber-500 focus:ring-amber-500"
                          />
                          <span className="text-sm text-white">{v.name}</span>
                          <span className="text-[11px] text-slate-500 truncate">{v.address}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
                {editRole === 'venue_manager' && editVenueIds.length === 0 && (
                  <p className="text-[11px] text-rose-400 mt-2">Select at least one venue.</p>
                )}
              </div>
            )}

            <div className="flex justify-end space-x-3 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                disabled={savingEdit}
                className="px-4 py-2 text-sm rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveUserEdit}
                disabled={savingEdit || (editRole === 'venue_manager' && editVenueIds.length === 0)}
                className="px-4 py-2 text-sm rounded-xl bg-amber-500 text-slate-950 font-semibold hover:bg-amber-400 disabled:opacity-50"
              >
                {savingEdit ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirm User Deletion */}
      {userToDelete && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-white">Delete user?</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              Permanently delete <span className="text-white font-semibold">{userToDelete.first_name} {userToDelete.last_name}</span> ({userToDelete.email})?
              Their venue assignments, shift requests, transfers and messages will be removed. Users with payroll history cannot be deleted — deactivate them instead.
            </p>
            <div className="flex justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setUserToDelete(null)}
                disabled={deletingUser}
                className="px-4 py-2 text-sm rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteUser}
                disabled={deletingUser}
                className="px-4 py-2 text-sm rounded-xl bg-rose-600 text-white font-semibold hover:bg-rose-500 disabled:opacity-50 transition"
              >
                {deletingUser ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
