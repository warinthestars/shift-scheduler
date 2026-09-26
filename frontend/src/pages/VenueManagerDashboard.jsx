import React, { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import {
  Plus, Check, Building2, AlertCircle, Download, Settings, UserPlus, Globe, Users, ArrowRightLeft, X,
} from 'lucide-react';
import PostedShiftsBoard from '../components/PostedShiftsBoard';
import VenueSettingsModal from '../components/VenueSettingsModal';
import ShiftEventFormModal from '../components/ShiftEventFormModal';
import ShiftBoardModal from '../components/ShiftBoardModal';
import ReasonDialog from '../components/ReasonDialog';
import DuplicateEventModal from '../components/DuplicateEventModal';
import TimesheetModal from '../components/TimesheetModal';
import TeamModal from '../components/TeamModal';
import ReviewModal from '../components/ReviewModal';
import ActivityFeed from '../components/ActivityFeed';
import { ApprovalQueueCard, TransfersCard } from '../components/ManagerQueues';
import { WorkerProfileModal } from '../components/WorkerProfilePanel';

/**
 * Venue manager dashboard.
 * Phase 29.1 layout: Posted Shifts on the left (2/3), and on the right the things that need you
 * (requests, hand-offs) plus the venue's activity log. On phones a "Needs attention" strip at the
 * top jumps to the queues. The old Phase 16 roster/calendar code (never shown) was removed.
 */
export default function VenueManagerDashboard() {
  const { user } = useAuth();
  const isPlatformAdmin = ['platform_admin', 'super_admin'].includes((user?.role || '').toLowerCase());
  // Phase 28: notification links open /venue?venue=<id>&event=<id>
  const [searchParams, setSearchParams] = useSearchParams();
  const urlVenue = searchParams.get('venue');
  if (urlVenue && isPlatformAdmin && localStorage.getItem('shiftboard_admin_venue_id') !== urlVenue) {
    localStorage.setItem('shiftboard_admin_venue_id', urlVenue);
  }
  const initialVenue = urlVenue
    || (isPlatformAdmin
      ? (localStorage.getItem('shiftboard_admin_venue_id') || user?.venue_id || null)
      : (user?.venue_id || null));

  const [pendingRequests, setPendingRequests] = useState([]);
  const [pendingTransfers, setPendingTransfers] = useState([]);
  const [currentVenueId, setCurrentVenueId] = useState(initialVenue);
  const [venueDetails, setVenueDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [exportingCSV, setExportingCSV] = useState(false);
  const [activeDiscussionShift, setActiveDiscussionShift] = useState(null);
  const [notification, setNotification] = useState(null);

  const [reliabilityMap, setReliabilityMap] = useState({});
  const [managedVenues, setManagedVenues] = useState([]);
  const [boardRefreshKey, setBoardRefreshKey] = useState(0);
  const [venuePositions, setVenuePositions] = useState([]);
  const [showVenueSettings, setShowVenueSettings] = useState(false);
  const [eventForm, setEventForm] = useState(null); // { mode: 'create' } | { mode: 'edit', eventId }
  const [reasonDialog, setReasonDialog] = useState(null);
  const [dupEvent, setDupEvent] = useState(null);
  const [timesheetEventId, setTimesheetEventId] = useState(null);
  const [openTarget, setOpenTarget] = useState(null); // Phase 28: { venueId, eventId } from a notification link
  const [showTeam, setShowTeam] = useState(false);    // Phase 29: Team page
  const [review, setReview] = useState(null);         // Phase 29.1: { type: 'request' | 'transfer', data }
  const [profileWorkerId, setProfileWorkerId] = useState(null); // Phase 29.1: from the activity log
  const noticeTimer = useRef(null);

  // Phase 29.1: success / info banners clear themselves after 6 s; errors stay until dismissed
  useEffect(() => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    if (notification && notification.type !== 'error') {
      noticeTimer.current = setTimeout(() => setNotification(null), 6000);
    }
    return () => noticeTimer.current && clearTimeout(noticeTimer.current);
  }, [notification]);

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

      const [requestsRes, venueRes, transfersRes, reliabilityRes] = await Promise.all([
        api.get(`/venues/${activeId}/requests/pending`),
        api.get(`/venues/${activeId}`),
        api.get(`/transfers/venue/${activeId}/pending`).catch(() => ({ data: [] })),
        api.get(`/venues/${activeId}/reliability`).catch(() => ({ data: {} })),
      ]);

      setPendingRequests(requestsRes.data || []);
      setVenueDetails(venueRes.data || null);
      setPendingTransfers(transfersRes.data || []);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 28: handle ?venue= / ?event= (also when already on this page); Phase 29: ?team=1
  useEffect(() => {
    const venue = searchParams.get('venue');
    const event = searchParams.get('event');
    const team = searchParams.get('team');
    if (!venue && !event && !team) return;
    const targetVenue = venue || currentVenueId;
    if (venue && String(venue) !== String(currentVenueId)) {
      if (isPlatformAdmin) {
        localStorage.setItem('shiftboard_admin_venue_id', venue);
        window.dispatchEvent(new CustomEvent('admin_venue_changed', { detail: venue })); // listener above reloads
      } else {
        fetchVenueData(venue);
      }
    }
    if (event) setOpenTarget({ venueId: targetVenue, eventId: event });
    if (team) setShowTeam(true);
    const next = new URLSearchParams(searchParams);
    next.delete('venue');
    next.delete('event');
    next.delete('team');
    setSearchParams(next, { replace: true }); // keeps ?notifications= for the bell
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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

  // Approval queue actions
  const handleApprove = async (requestId) => {
    try {
      setActionLoading(`approve-${requestId}`);
      await api.post(`/requests/${requestId}/approve`);
      setPendingRequests((prev) => prev.filter((r) => r.id !== requestId));
      setNotification({ type: 'success', message: 'Approved. They are booked and have been notified.' });
      setReview(null);
      fetchVenueData(currentVenueId);
    } catch (err) {
      setNotification({ type: 'error', message: err.response?.data?.detail || 'Failed to approve request.' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeny = async (requestId) => {
    try {
      setActionLoading(`deny-${requestId}`);
      await api.post(`/requests/${requestId}/deny`);
      setPendingRequests((prev) => prev.filter((r) => r.id !== requestId));
      setNotification({ type: 'info', message: 'Request declined. They have been notified.' });
      setReview(null);
      fetchVenueData(currentVenueId);
    } catch (err) {
      setNotification({ type: 'error', message: err.response?.data?.detail || 'Failed to deny request.' });
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
      setNotification({ type: 'success', message: 'Hand-off approved. The spot now belongs to the new worker.' });
      setReview(null);
      fetchVenueData(currentVenueId);
    } catch (err) {
      setNotification({ type: 'error', message: err.response?.data?.detail || 'Failed to approve the hand-off.' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDenyTransfer = async (transferId) => {
    try {
      setActionLoading(`transfer-deny-${transferId}`);
      await api.post(`/transfers/${transferId}/manager-review`, { action: 'deny' });
      setPendingTransfers((prev) => prev.filter((t) => t.id !== transferId));
      setNotification({ type: 'info', message: 'Hand-off denied. The original worker keeps the shift.' });
      setReview(null);
      fetchVenueData(currentVenueId);
    } catch (err) {
      setNotification({ type: 'error', message: err.response?.data?.detail || 'Failed to deny the hand-off.' });
    } finally {
      setActionLoading(null);
    }
  };

  // Phase 19: Hour Tracking & Payroll CSV Export
  const exportPayroll = async () => {
    if (!currentVenueId) return;
    try {
      setExportingCSV(true);
      const response = await api.get(`/venues/${currentVenueId}/payroll/export`, { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'payroll.csv');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setNotification({ type: 'success', message: 'Payroll CSV downloaded.' });
    } catch (err) {
      console.error('Error exporting payroll CSV:', err);
      setNotification({ type: 'error', message: 'Failed to download payroll CSV.' });
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

  const openEvent = (eventId) => {
    setReview(null);
    setProfileWorkerId(null);
    setOpenTarget({ venueId: currentVenueId, eventId });
  };

  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      <div className="min-h-screen w-full bg-slate-950 text-slate-100 flex items-center justify-center p-6">
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

  const tz = venueDetails?.timezone;
  const attention = pendingRequests.length + pendingTransfers.length;
  const headerBtn =
    'px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition inline-flex items-center gap-1.5 shadow-sm disabled:opacity-50';

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 pb-16">
      {/* Header */}
      <section className="w-full bg-slate-900 border-b border-slate-800 py-6">
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-400 flex items-center justify-center text-slate-950 shadow-lg shadow-amber-500/20 flex-shrink-0">
              <Building2 className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold text-white truncate">{venueDetails?.name || 'Venue'}</h1>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  {isPlatformAdmin ? 'Platform admin' : 'Venue manager'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 truncate">{venueDetails?.address || ''}</p>
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

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setEventForm({ mode: 'create' })}
              className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition inline-flex items-center gap-1.5 shadow-md shadow-emerald-500/20"
            >
              <Plus className="w-4 h-4" /> Post a Shift
            </button>
            <button type="button" onClick={() => setShowTeam(true)} disabled={!venueDetails} className={headerBtn}>
              <UserPlus className="w-4 h-4 text-emerald-400" /> Team
            </button>
            <button type="button" onClick={() => setShowVenueSettings(true)} disabled={!venueDetails} className={headerBtn}>
              <Settings className="w-4 h-4 text-amber-400" /> Settings
            </button>
            <button type="button" onClick={exportPayroll} disabled={exportingCSV || !currentVenueId} className={headerBtn}>
              <Download className="w-4 h-4 text-emerald-400" /> {exportingCSV ? 'Downloading…' : 'Payroll CSV'}
            </button>
            {currentVenueId && (
              <Link to={`/venues/${currentVenueId}`} className={headerBtn}>
                <Globe className="w-4 h-4 text-sky-400" /> Public page
              </Link>
            )}
          </div>
        </div>
      </section>

      <main className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-6">
        {notification && (
          <div
            className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
              notification.type === 'success'
                ? 'bg-emerald-950/80 border-emerald-700 text-emerald-200'
                : notification.type === 'error'
                ? 'bg-rose-950/80 border-rose-700 text-rose-200'
                : 'bg-indigo-950/80 border-indigo-700 text-indigo-200'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {notification.type === 'success' ? (
                <Check className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
              )}
              <span className="text-sm font-medium">{notification.message}</span>
            </div>
            <button type="button" onClick={() => setNotification(null)} aria-label="Dismiss" className="p-1 rounded-lg hover:bg-white/10">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Phones / tablets: jump to the queues that sit below the shifts */}
        {attention > 0 && (
          <div className="lg:hidden flex flex-wrap gap-2">
            {pendingRequests.length > 0 && (
              <button type="button" onClick={() => scrollTo('approval-queue')}
                className="px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs font-bold inline-flex items-center gap-1.5">
                <Users className="w-4 h-4" /> {pendingRequests.length} request{pendingRequests.length === 1 ? '' : 's'} to review
              </button>
            )}
            {pendingTransfers.length > 0 && (
              <button type="button" onClick={() => scrollTo('pending-transfers')}
                className="px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs font-bold inline-flex items-center gap-1.5">
                <ArrowRightLeft className="w-4 h-4" /> {pendingTransfers.length} hand-off{pendingTransfers.length === 1 ? '' : 's'} to approve
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Left: posted shifts */}
          <div className="lg:col-span-2 min-w-0">
            <PostedShiftsBoard
              venueId={currentVenueId}
              openEventId={openTarget && String(openTarget.venueId) === String(currentVenueId) ? openTarget.eventId : null}
              onOpenedEvent={() => setOpenTarget(null)}
              onDataChanged={() => fetchVenueData(currentVenueId)}
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
              timeZone={tz}
            />
          </div>

          {/* Right: what needs you + activity */}
          <aside className="space-y-6 min-w-0">
            <ApprovalQueueCard
              requests={pendingRequests}
              reliabilityMap={reliabilityMap}
              timeZone={tz}
              actionLoading={actionLoading}
              onReview={(req) => setReview({ type: 'request', data: req })}
              onApprove={handleApprove}
              onDeny={handleDeny}
            />
            <TransfersCard
              transfers={pendingTransfers}
              timeZone={tz}
              actionLoading={actionLoading}
              onReview={(t) => setReview({ type: 'transfer', data: t })}
              onApprove={handleApproveTransfer}
              onDeny={handleDenyTransfer}
            />
            <ActivityFeed
              venueId={currentVenueId}
              refreshKey={boardRefreshKey}
              onOpenEvent={openEvent}
              onOpenWorker={setProfileWorkerId}
            />
          </aside>
        </div>
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
          timeZone={tz}
          onClose={() => setDupEvent(null)}
          onDone={(count) => afterChange(`Created ${count} ${count === 1 ? 'copy' : 'copies'}.`)}
        />
      )}
      {timesheetEventId && (
        <TimesheetModal
          eventId={timesheetEventId}
          timeZone={tz}
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

      {review && currentVenueId && (
        <ReviewModal
          venueId={currentVenueId}
          item={review}
          timeZone={tz}
          busy={!!actionLoading}
          onApprove={review.type === 'transfer' ? handleApproveTransfer : handleApprove}
          onDeny={review.type === 'transfer' ? handleDenyTransfer : handleDeny}
          onOpenEvent={openEvent}
          onClose={() => setReview(null)}
        />
      )}

      {profileWorkerId && currentVenueId && (
        <WorkerProfileModal
          venueId={currentVenueId}
          workerId={profileWorkerId}
          timeZone={tz}
          onClose={() => setProfileWorkerId(null)}
        />
      )}

      {showTeam && venueDetails && (
        <TeamModal
          venue={venueDetails}
          positions={venuePositions}
          timeZone={tz}
          onClose={() => setShowTeam(false)}
          onChanged={() => fetchVenueData(currentVenueId)}
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
