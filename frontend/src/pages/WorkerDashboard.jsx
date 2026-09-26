import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import {
  Calendar, AlertCircle, Briefcase, Check, Search, Filter,
  Timer, ArrowRightLeft, MessageSquare, X, Star, Zap, Info, CalendarPlus, Navigation,
  CalendarDays, AlertTriangle,
} from 'lucide-react';
import TransferModal from '../components/TransferModal';
import ShiftBoardModal from '../components/ShiftBoardModal';
import TipBadge from '../components/TipBadge';
import PayLabel from '../components/PayLabel';
import EventListingCard from '../components/EventListingCard';
import EventListingModal from '../components/EventListingModal';
import WorkerCalendar from '../components/WorkerCalendar';
import ShiftDetailsModal from '../components/ShiftDetailsModal';
import WorkerOffers from '../components/WorkerOffers';
import RatingBadge from '../components/RatingBadge';
import { PENDING_INVITE_KEY } from './JoinPage';
import { fmtDateTime, fmtTime } from '../utils/venueTime';
import {
  STATUS_LABELS, PENDING_STATUSES, dayGroupLabel, isOnDay, downloadIcs, mapsUrl, whereOf,
} from '../utils/listingFormat';
import { getCurrentPosition } from '../utils/geo';

const UPCOMING_STATUSES = ['pending', 'pending_manager_approval', 'approved', 'confirmed', 'checked_in'];

export default function WorkerDashboard() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('find'); // 'find' | 'calendar' | 'schedule' | 'transfers'
  const [listings, setListings] = useState([]);
  const [calendar, setCalendar] = useState({ items: [], unread_count: 0 }); // Phase 26.2
  const [detailRequestId, setDetailRequestId] = useState(null);           // Phase 26.2: ShiftDetailsModal
  const [myShifts, setMyShifts] = useState([]);
  const [incomingTransfers, setIncomingTransfers] = useState([]);
  const [activeClockIns, setActiveClockIns] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [clockActionLoading, setClockActionLoading] = useState(null);
  const [transferActionLoading, setTransferActionLoading] = useState(null);
  const [withdrawingId, setWithdrawingId] = useState(null);
  const [notification, setNotification] = useState(null);

  // Phase 26.1: Find Shifts filters
  const [search, setSearch] = useState('');
  const [whenFilter, setWhenFilter] = useState('all'); // 'all' | 'today' | 'tomorrow' | 'week'
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [venueFilter, setVenueFilter] = useState('ALL');
  const [instantOnly, setInstantOnly] = useState(false);
  const [hideRequested, setHideRequested] = useState(false);

  // Modals state
  const [openListing, setOpenListing] = useState(null); // { eventId, initial }
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferShiftId, setTransferShiftId] = useState(null);
  const [activeDiscussionShift, setActiveDiscussionShift] = useState(null);
  const [shiftToDrop, setShiftToDrop] = useState(null);
  const [dropping, setDropping] = useState(false);
  const [offers, setOffers] = useState([]);              // Phase 29: shifts offered to me
  const [offerBusy, setOfferBusy] = useState(null);
  const navigate = useNavigate();

  const fetchWorkerData = async (showSpinner = true) => {
    try {
      if (showSpinner) setLoading(true);
      const [listingsRes, myRes, transfersRes, activeClocksRes, calendarRes, offersRes] = await Promise.all([
        api.get('/listings'),
        api.get('/users/me/shifts'),
        api.get('/transfers/my-incoming'),
        api.get('/shifts/time-entries/active').catch(() => ({ data: [] })),
        api.get('/me/calendar').catch(() => ({ data: { items: [], unread_count: 0 } })),
        api.get('/me/offers').catch(() => ({ data: [] })),
      ]);
      setListings(listingsRes.data || []);
      setOffers(offersRes.data || []);
      setCalendar({
        items: calendarRes.data?.items || [],
        unread_count: calendarRes.data?.unread_count || 0,
      });
      setMyShifts(myRes.data || []);
      setIncomingTransfers(transfersRes.data || []);

      const clockedIds = new Set((activeClocksRes.data || []).map((te) => te.shift_id));
      setActiveClockIns(clockedIds);
    } catch (err) {
      console.error('Error loading worker dashboard data:', err);
      setNotification({
        type: 'error',
        message: 'Failed to load shifts from backend server.',
      });
    } finally {
      if (showSpinner) setLoading(false);
    }
  };

  useEffect(() => {
    // Phase 29: finish joining a team if they signed up from an invite link
    let pendingInvite = null;
    try {
      pendingInvite = localStorage.getItem(PENDING_INVITE_KEY);
    } catch (e) {
      pendingInvite = null;
    }
    if (pendingInvite) {
      navigate(`/join/${pendingInvite}`, { replace: true });
      return;
    }
    fetchWorkerData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 29: accept / decline an offer
  const handleOffer = async (offer, action) => {
    setOfferBusy(offer.offer_id);
    try {
      const res = await api.post(`/offers/${offer.offer_id}/${action}`);
      setNotification({
        type: action === 'accept' ? 'success' : 'info',
        message: action === 'accept' ? res.data.message : 'Offer declined.',
      });
    } catch (err) {
      setNotification({ type: 'error', message: err.response?.data?.detail || 'Could not update the offer.' });
    } finally {
      setOfferBusy(null);
      fetchWorkerData(false);
    }
  };

  // Phase 26.1: withdraw a request that is still waiting for approval
  const handleWithdraw = async (req) => {
    try {
      setWithdrawingId(req.id);
      await api.post(`/listings/requests/${req.id}/withdraw`);
      setNotification({ type: 'info', message: 'Request withdrawn.' });
      fetchWorkerData(false);
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to withdraw request.',
      });
    } finally {
      setWithdrawingId(null);
    }
  };

  // Hour tracking Clock In / Clock Out
  // Phase 27: `item` is the calendar item for this booking (geofence + clock-in window info).
  const handleClockIn = async (shiftId, item) => {
    try {
      setClockActionLoading(shiftId);
      let body = {};
      if (item?.geofence_on) {
        setNotification({ type: 'info', message: 'Checking your location…' });
        body = await getCurrentPosition(); // throws a friendly Error if blocked / unavailable
      }
      const res = await api.post(`/shifts/${shiftId}/clock-in`, body);
      setActiveClockIns((prev) => new Set([...prev, shiftId]));
      setNotification({
        type: res.data?.geo_status === 'outside_geofence' ? 'info' : 'success',
        message: `⏱️ ${res.data?.message || 'Clocked in.'}`,
      });
      fetchWorkerData(false);
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || err.message || 'Failed to clock in.',
      });
    } finally {
      setClockActionLoading(null);
    }
  };

  const handleClockOut = async (shiftId, item) => {
    try {
      setClockActionLoading(shiftId);
      // Clock-out is never blocked by location; we only record it when the check is on.
      const body = item?.geofence_on ? await getCurrentPosition({ timeoutMs: 8000 }).catch(() => ({})) : {};
      const res = await api.post(`/shifts/${shiftId}/clock-out`, body);
      setActiveClockIns((prev) => {
        const updated = new Set(prev);
        updated.delete(shiftId);
        return updated;
      });
      setNotification({
        type: res.data?.status === 'undone' ? 'info' : 'success',
        message: `🏁 ${res.data?.message || 'Clocked out.'}`,
      });
      fetchWorkerData(false);
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to clock out.',
      });
    } finally {
      setClockActionLoading(null);
    }
  };

  // Shift Transfers (Accept / Reject)
  const handleAcceptTransfer = async (transferId) => {
    try {
      setTransferActionLoading(transferId);
      await api.post(`/transfers/${transferId}/accept`);
      setNotification({
        type: 'success',
        message: 'Shift transfer accepted! Awaiting Venue Manager approval.',
      });
      fetchWorkerData();
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to accept transfer.',
      });
    } finally {
      setTransferActionLoading(null);
    }
  };

  const handleRejectTransfer = async (transferId) => {
    try {
      setTransferActionLoading(transferId);
      await api.post(`/transfers/${transferId}/reject`);
      setNotification({
        type: 'info',
        message: 'Shift transfer proposal declined.',
      });
      fetchWorkerData();
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to decline transfer.',
      });
    } finally {
      setTransferActionLoading(null);
    }
  };

  // Phase 14: Shift Dropping
  const handleDropShift = async () => {
    if (!shiftToDrop) return;
    const targetShiftId = shiftToDrop.shift_id || shiftToDrop.shift?.id;
    try {
      setDropping(true);
      await api.post(`/shifts/${targetShiftId}/drop`);
      // Immediately remove the shift from the UI without requiring a page reload
      setMyShifts((prev) => prev.filter((s) => s.id !== shiftToDrop.id));
      setNotification({
        type: 'success',
        message: 'Shift dropped successfully. Capacity has been returned to the open marketplace.',
      });
      setShiftToDrop(null);
      fetchWorkerData();
    } catch (err) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to drop shift.',
      });
    } finally {
      setDropping(false);
    }
  };

  const confirmedShifts = myShifts.filter((s) =>
    ['approved', 'checked_in', 'confirmed'].includes(String(s.status || '').toLowerCase())
  );

  // ---- Phase 26.2: calendar items by request id + "please read" handling -------------------
  const calendarByRequest = useMemo(() => {
    const m = new Map();
    calendar.items.forEach((i) => m.set(i.request_id, i));
    return m;
  }, [calendar.items]);
  const detailItem = detailRequestId ? calendarByRequest.get(detailRequestId) || null : null;
  const firstUnread = calendar.items.find((i) => i.needs_ack && new Date(i.end_time).getTime() > Date.now()) || null;

  const handleAcknowledged = (requestId, seenAt) => {
    setCalendar((prev) => {
      const items = prev.items.map((i) =>
        i.request_id === requestId ? { ...i, needs_ack: false, info_change: null, info_seen_at: seenAt || new Date().toISOString() } : i
      );
      const unread = items.filter((i) => i.needs_ack && new Date(i.end_time).getTime() > Date.now()).length;
      return { items, unread_count: unread };
    });
  };

  const openDetailsForRequest = (req) => {
    if (calendarByRequest.has(req.id)) {
      setDetailRequestId(req.id);
    } else if (req.shift?.event_id) {
      setOpenListing({ eventId: req.shift.event_id, initial: null });
    }
  };

  // ---- Phase 28: deep links from notifications (?tab=, ?request=, ?event=) ----------------
  const [searchParams, setSearchParams] = useSearchParams();
  const [pendingDeepLink, setPendingDeepLink] = useState(null);

  useEffect(() => {
    const tab = searchParams.get('tab');
    const request = searchParams.get('request');
    const event = searchParams.get('event');
    if (!tab && !request && !event) return;
    if (tab && ['find', 'calendar', 'schedule', 'transfers'].includes(tab)) setActiveTab(tab);
    if (event) setOpenListing({ eventId: event, initial: null });
    if (request) {
      setPendingDeepLink(request);
      fetchWorkerData(false); // make sure the calendar has the newest booking
    }
    const next = new URLSearchParams(searchParams);
    ['tab', 'request', 'event'].forEach((k) => next.delete(k));
    setSearchParams(next, { replace: true }); // keeps ?notifications= for the bell
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (pendingDeepLink && calendarByRequest.has(pendingDeepLink)) {
      setDetailRequestId(pendingDeepLink);
      setPendingDeepLink(null);
    }
  }, [pendingDeepLink, calendarByRequest]);

  // ---- Phase 26.1: Find Shifts (one card per event) ------------------------------------
  const openListingCount = listings.filter((l) => l.total_spots_left > 0 && !l.my_request).length;

  const roleOptions = useMemo(
    () =>
      Array.from(
        new Set(listings.flatMap((l) => l.positions.filter((p) => p.status === 'OPEN').map((p) => p.role_type)))
      ).sort(),
    [listings]
  );

  const venueOptions = useMemo(() => {
    const m = new Map();
    listings.forEach((l) => l.venue && m.set(l.venue.id, l.venue.name));
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [listings]);

  const filteredListings = useMemo(() => {
    const q = search.trim().toLowerCase();
    const weekEnd = Date.now() + 7 * 86400000;
    return listings.filter((l) => {
      const tz = l.venue?.timezone;
      if (q) {
        const hay = [l.title, l.venue?.name, l.venue?.address, l.location?.name, l.location?.address, ...l.positions.map((p) => p.role_type)]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (whenFilter === 'today' && !isOnDay(l.start_time, tz, 0)) return false;
      if (whenFilter === 'tomorrow' && !isOnDay(l.start_time, tz, 1)) return false;
      if (whenFilter === 'week' && new Date(l.start_time).getTime() > weekEnd) return false;
      if (roleFilter !== 'ALL' && !l.positions.some((p) => p.role_type === roleFilter && (p.status === 'OPEN' || p.my_status))) return false;
      if (venueFilter !== 'ALL' && l.venue?.id !== venueFilter) return false;
      if (instantOnly && !l.any_instant) return false;
      if (hideRequested && l.my_request) return false;
      return true;
    });
  }, [listings, search, whenFilter, roleFilter, venueFilter, instantOnly, hideRequested]);

  const listingGroups = useMemo(() => {
    const groups = [];
    filteredListings.forEach((l) => {
      const label = dayGroupLabel(l.start_time, l.venue?.timezone);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(l);
      else groups.push({ label, items: [l] });
    });
    return groups;
  }, [filteredListings]);

  const filtersActive =
    search || whenFilter !== 'all' || roleFilter !== 'ALL' || venueFilter !== 'ALL' || instantOnly || hideRequested;
  const clearFilters = () => {
    setSearch('');
    setWhenFilter('all');
    setRoleFilter('ALL');
    setVenueFilter('ALL');
    setInstantOnly(false);
    setHideRequested(false);
  };

  // ---- Phase 26.1: My Schedule split -------------------------------------------------------
  const nowMs = Date.now();
  const isUpcomingReq = (req) => {
    const st = String(req.status || '').toLowerCase();
    if (!UPCOMING_STATUSES.includes(st)) return false;
    if (st === 'checked_in') return true;
    const end = new Date(req.shift?.end_time).getTime();
    return Number.isNaN(end) ? true : end >= nowMs;
  };
  const upcomingRequests = myShifts
    .filter(isUpcomingReq)
    .sort((a, b) => new Date(a.shift?.start_time) - new Date(b.shift?.start_time));
  const historyRequests = myShifts
    .filter((r) => !isUpcomingReq(r))
    .sort((a, b) => new Date(b.shift?.start_time) - new Date(a.shift?.start_time));

  const addShiftToCalendar = (req) => {
    const shift = req.shift;
    if (!shift) return;
    downloadIcs({
      uid: `${req.id}@shiftboard`,
      title: `${shift.title} — ${shift.role_type || 'Shift'} (${shift.venue?.name || ''})`,
      start: shift.start_time,
      end: shift.end_time,
      location: calendarByRequest.get(req.id) ? whereOf(calendarByRequest.get(req.id)).address : shift.venue?.address,
      description: [shift.event_notes, shift.description, shift.venue?.arrival_instructions].filter(Boolean).join('\n\n'),
    });
  };

  const renderRequestCard = (req) => {
    const shift = req.shift;
    const shiftId = req.shift_id || shift?.id;
    const statusLower = String(req.status || '').toLowerCase();
    const isApproved = ['approved', 'confirmed'].includes(statusLower);
    const isCheckedIn = statusLower === 'checked_in' || activeClockIns.has(shiftId);
    const isCompleted = statusLower === 'completed';
    const isPending = PENDING_STATUSES.includes(statusLower);
    const isClockLoading = clockActionLoading === shiftId;
    // Phase 27: clock-in window + where to go, from the calendar item
    const calItem = calendarByRequest.get(req.id);
    const opensAt = calItem?.clock_in_opens_at ? new Date(calItem.clock_in_opens_at) : null;
    const tooEarly = !!opensAt && Date.now() < opensAt.getTime();
    const shiftEnded = shift?.end_time ? Date.now() >= new Date(shift.end_time).getTime() : false;
    const place = calItem ? whereOf(calItem) : shift?.venue;

    return (
      <div
        key={req.id}
        className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
      >
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase ${
                isCheckedIn
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse'
                  : isApproved
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : isCompleted
                  ? 'bg-slate-800 text-slate-300 border border-slate-700'
                  : isPending
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                  : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
              }`}
            >
              {isCheckedIn ? 'CLOCKED IN' : STATUS_LABELS[statusLower] || req.status}
            </span>

            {req.approval_source && (
              <span className="text-xs text-slate-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                Via: {req.approval_source.replace(/_/g, ' ')}
              </span>
            )}

            {calendarByRequest.get(req.id)?.needs_ack && (
              <button
                type="button"
                onClick={() => setDetailRequestId(req.id)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black"
              >
                <AlertTriangle className="w-3 h-3" />
                {calendarByRequest.get(req.id)?.info_change ? 'UPDATED — READ' : 'PLEASE READ'}
              </button>
            )}
          </div>

          <h3 className="text-base font-bold text-white mt-1">{shift?.title}</h3>
          {req.status_reason && ['cancelled', 'removed', 'no_show', 'withdrawn'].includes(statusLower) && (
            <p className="text-xs text-rose-300">Reason: {req.status_reason}</p>
          )}
          <p className="text-xs text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-slate-300 font-medium">{shift?.venue?.name}</span>
            <span>•</span>
            <span>{shift?.role_type || shift?.role_required}</span>
            <span>•</span>
            <PayLabel rate={shift?.hourly_rate} rateMax={shift?.hourly_rate_max} />
            <TipBadge shift={shift} />
          </p>
          <p className="text-xs text-slate-500">
            {fmtDateTime(shift?.start_time, shift?.venue?.timezone)}
          </p>
          {req.notes && isPending && (
            <p className="text-[11px] text-slate-400">Your note: <span className="text-slate-300">{req.notes}</span></p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto justify-end">
          {(calendarByRequest.has(req.id) || shift?.event_id) && (
            <button
              type="button"
              onClick={() => openDetailsForRequest(req)}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition flex items-center space-x-1"
            >
              <Info className="w-3.5 h-3.5 text-emerald-400" />
              <span>Details</span>
            </button>
          )}

          {(isApproved || isCheckedIn) && place && (
            <a
              href={mapsUrl(place)}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition flex items-center space-x-1"
            >
              <Navigation className="w-3.5 h-3.5 text-emerald-400" />
              <span>Directions</span>
            </a>
          )}

          {isApproved && (
            <button
              type="button"
              onClick={() => addShiftToCalendar(req)}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition flex items-center space-x-1"
            >
              <CalendarPlus className="w-3.5 h-3.5 text-emerald-400" />
              <span>Calendar</span>
            </button>
          )}

          {/* Discussion Board button for confirmed shifts */}
          {(isApproved || isCheckedIn || isCompleted) && (
            <button
              type="button"
              onClick={() => setActiveDiscussionShift(shift)}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition flex items-center space-x-1"
            >
              <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
              <span>Board</span>
            </button>
          )}

          {/* Transfer Shift button */}
          {isApproved && !isCheckedIn && (
            <button
              type="button"
              onClick={() => {
                setTransferShiftId(shiftId);
                setTransferModalOpen(true);
              }}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 text-xs font-semibold transition flex items-center space-x-1"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span>Transfer</span>
            </button>
          )}

          {/* Drop Shift button (Phase 14) */}
          {isApproved && !isCheckedIn && !isCompleted && (() => {
            const shiftStartTime = new Date(shift?.start_time).getTime();
            const hoursRemaining = (shiftStartTime - Date.now()) / (1000 * 60 * 60);
            const canDrop = hoursRemaining >= 24;

            return (
              <div className="flex flex-col items-end">
                <button
                  type="button"
                  onClick={() => setShiftToDrop(req)}
                  disabled={!canDrop}
                  title={
                    !canDrop
                      ? 'Shifts cannot be dropped within 24 hours of the start time. Please request a transfer or contact the manager.'
                      : 'Drop this shift and return it to the open marketplace.'
                  }
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold transition text-red-600 border border-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  Drop Shift
                </button>
                {!canDrop && (
                  <span className="text-[10px] text-slate-500 italic mt-0.5">
                    &lt;24h to start (locked)
                  </span>
                )}
              </div>
            );
          })()}

          {/* Time Tracking Clock In / Clock Out Button */}
          {(isApproved || isCheckedIn) && (
            isCheckedIn ? (
              <button
                type="button"
                onClick={() => handleClockOut(shiftId, calItem)}
                disabled={isClockLoading}
                className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition flex items-center space-x-1.5 shadow-md shadow-rose-600/20 disabled:opacity-50"
              >
                <Timer className="w-3.5 h-3.5" />
                <span>{isClockLoading ? 'Saving...' : 'Clock Out'}</span>
              </button>
            ) : shiftEnded ? (
              <span className="text-[11px] text-slate-500 italic">Shift ended. Ask your manager to add your hours.</span>
            ) : tooEarly ? (
              <span
                title="Clock-in opens shortly before your shift starts"
                className="px-3.5 py-1.5 rounded-xl bg-slate-800 text-slate-400 border border-slate-700 text-xs font-semibold flex items-center space-x-1.5"
              >
                <Timer className="w-3.5 h-3.5" />
                <span>Clock in opens {fmtTime(opensAt, shift?.venue?.timezone)}</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => handleClockIn(shiftId, calItem)}
                disabled={isClockLoading}
                className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center space-x-1.5 shadow-md shadow-emerald-600/20 disabled:opacity-50"
              >
                <Timer className="w-3.5 h-3.5" />
                <span>{isClockLoading ? 'Saving...' : calItem?.geofence_on ? 'Clock In (uses location)' : 'Clock In'}</span>
              </button>
            )
          )}

          {isCompleted && (
            <span className="px-3.5 py-1.5 rounded-xl bg-slate-800 text-emerald-400 border border-emerald-800/40 text-xs font-bold flex items-center space-x-1">
              <Check className="w-3.5 h-3.5" />
              <span>Completed</span>
            </span>
          )}

          {isPending && (
            <>
              <span className="text-xs text-amber-400 bg-amber-950/40 border border-amber-800/40 px-3.5 py-2 rounded-xl font-medium">
                Awaiting Venue Manager Review
              </span>
              <button
                type="button"
                onClick={() => handleWithdraw(req)}
                disabled={withdrawingId === req.id}
                className="px-3 py-1.5 rounded-xl border border-rose-500/50 text-rose-300 hover:bg-rose-500/10 text-xs font-semibold transition disabled:opacity-50"
              >
                {withdrawingId === req.id ? 'Withdrawing…' : 'Withdraw'}
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

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
            <div className="flex items-center text-sm">
              <RatingBadge rating={user?.aggregate_rating ?? user?.rating_average} count={user?.rating_count} />
            </div>
            <span className="text-slate-700">•</span>
            <div className="text-xs text-slate-300">
              <span className="font-bold text-white">{confirmedShifts.length}</span> scheduled
            </div>
            <span className="text-slate-700">•</span>
            <div className="text-xs text-slate-300">
              <span className="font-bold text-white">{incomingTransfers.length}</span> transfers
            </div>
            <span className="text-slate-700">•</span>
            <div className="text-xs text-slate-300">
              <span className="font-bold text-white">{openListingCount}</span> open
            </div>
          </div>
        </div>
      </section>

      {/* Main Dashboard */}
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

        {/* Phase 26.3: admins / managers looking at the Worker view see exactly what workers see */}
        {!['worker'].includes(String(user?.role || '').toLowerCase()) && (
          <div className="mb-6 p-3 rounded-xl border border-indigo-500/40 bg-indigo-500/10 text-indigo-100 text-xs flex items-start gap-2">
            <Info className="w-4 h-4 text-indigo-300 flex-shrink-0 mt-0.5" />
            <span>
              <b>Worker preview.</b> You're seeing this page exactly as a worker would: hidden pay and
              staff-only notes stay hidden unless you're booked on that position. Your manager screens still show full pay.
            </span>
          </div>
        )}

        {/* Phase 26.2: don't let anyone miss updated shift info */}
        {calendar.unread_count > 0 && firstUnread && (
          <div className="mb-6 p-4 rounded-xl border-2 border-amber-500 bg-amber-500/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-black text-amber-100">
                  {calendar.unread_count === 1
                    ? '1 of your shifts has info you haven\'t read'
                    : `${calendar.unread_count} of your shifts have info you haven't read`}
                </div>
                <div className="text-xs text-amber-200/80">
                  Notes or times can change after you book. Open the shift and tap “Got it”.
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setDetailRequestId(firstUnread.request_id)}
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black whitespace-nowrap"
            >
              Review now
            </button>
          </div>
        )}

        {/* Tab Selection */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-4 gap-4">
          <div className="flex space-x-3 overflow-x-auto whitespace-nowrap -mx-1 px-1">
            <button
              onClick={() => setActiveTab('find')}
              className={`px-5 py-2.5 rounded-xl text-xs font-bold transition ${
                activeTab === 'find'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              Find Shifts ({openListingCount})
            </button>
            <button
              onClick={() => setActiveTab('calendar')}
              className={`px-5 py-2.5 rounded-xl text-xs font-bold transition inline-flex items-center gap-1.5 ${
                activeTab === 'calendar'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5" />
              <span>Calendar</span>
              {calendar.unread_count > 0 && (
                <span className="ml-0.5 min-w-[1.25rem] h-5 px-1 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black inline-flex items-center justify-center">
                  {calendar.unread_count}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('schedule')}
              className={`px-5 py-2.5 rounded-xl text-xs font-bold transition ${
                activeTab === 'schedule'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              My Schedule ({upcomingRequests.length})
            </button>
            <button
              onClick={() => setActiveTab('transfers')}
              className={`px-5 py-2.5 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 ${
                activeTab === 'transfers'
                  ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span>Pending Transfers ({incomingTransfers.length})</span>
            </button>
          </div>
        </div>

        {/* Phase 29: shifts a manager offered to me (shown on every tab) */}
        <WorkerOffers
          offers={offers}
          busyId={offerBusy}
          onAccept={(o) => handleOffer(o, 'accept')}
          onDecline={(o) => handleOffer(o, 'decline')}
        />

        {/* TAB 1: Find Shifts (Phase 26.1: one card per event) */}
        {activeTab === 'find' && (
          <div className="mt-6">
            {/* Filters */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-3 sm:p-4 space-y-3">
              <div className="flex flex-col lg:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search events, venues, positions"
                    className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1 overflow-x-auto">
                  {[
                    { id: 'all', label: 'All dates' },
                    { id: 'today', label: 'Today' },
                    { id: 'tomorrow', label: 'Tomorrow' },
                    { id: 'week', label: 'Next 7 days' },
                  ].map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => setWhenFilter(w.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                        whenFilter === w.id ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <Filter className="w-3.5 h-3.5" />
                </span>
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-medium text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="ALL">All positions</option>
                  {roleOptions.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <select
                  value={venueFilter}
                  onChange={(e) => setVenueFilter(e.target.value)}
                  className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-medium text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="ALL">All venues</option>
                  {venueOptions.map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setInstantOnly((v) => !v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border inline-flex items-center gap-1 transition ${
                    instantOnly
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                  }`}
                >
                  <Zap className="w-3.5 h-3.5" /> Instant book
                </button>
                <button
                  type="button"
                  onClick={() => setHideRequested((v) => !v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                    hideRequested
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                  }`}
                >
                  Hide ones I've requested
                </button>
                {filtersActive && (
                  <button type="button" onClick={clearFilters} className="text-xs text-slate-400 underline hover:text-white ml-auto">
                    Clear filters
                  </button>
                )}
              </div>
            </div>

            {loading ? (
              <div className="py-20 text-center text-slate-500 text-xs">Loading open shifts...</div>
            ) : filteredListings.length === 0 ? (
              <div className="mt-6 text-center py-20 bg-slate-900/40 rounded-2xl border border-slate-800">
                <Briefcase className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <h3 className="text-sm font-semibold text-slate-300">
                  {listings.length === 0 ? 'No shifts open right now' : 'Nothing matches these filters'}
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  {listings.length === 0 ? 'Check back soon as venue managers post new shifts.' : 'Try clearing a filter or two.'}
                </p>
              </div>
            ) : (
              <div className="mt-6 space-y-8">
                {listingGroups.map((g) => (
                  <section key={g.label}>
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
                      <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                      {g.label}
                      <span className="text-slate-600 font-semibold normal-case tracking-normal">
                        · {g.items.length} event{g.items.length === 1 ? '' : 's'}
                      </span>
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
                      {g.items.map((l) => (
                        <EventListingCard
                          key={l.event_id}
                          listing={l}
                          onOpen={(item) => setOpenListing({ eventId: item.event_id, initial: item })}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB: Calendar (Phase 26.2) */}
        {activeTab === 'calendar' && (
          <div className="mt-6">
            {loading ? (
              <div className="py-20 text-center text-slate-500 text-xs">Loading your calendar...</div>
            ) : (
              <WorkerCalendar
                items={calendar.items}
                openListings={listings}
                onSelectItem={(item) => setDetailRequestId(item.request_id)}
                onSelectListing={(l) => setOpenListing({ eventId: l.event_id, initial: l })}
              />
            )}
          </div>
        )}

        {/* TAB 2: My Schedule (Phase 26.1: upcoming first, history folded away) */}
        {activeTab === 'schedule' && (
          <div className="mt-6 space-y-4">
            {upcomingRequests.length === 0 ? (
              <div className="text-center py-16 bg-slate-900/40 rounded-2xl border border-slate-800">
                <Calendar className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <h3 className="text-sm font-semibold text-slate-300">Nothing coming up</h3>
                <p className="text-xs text-slate-500 mt-1">Browse "Find Shifts" to pick up your next shift.</p>
              </div>
            ) : (
              upcomingRequests.map(renderRequestCard)
            )}

            {historyRequests.length > 0 && (
              <details className="group pt-2">
                <summary className="cursor-pointer select-none text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-white">
                  Past & closed ({historyRequests.length})
                </summary>
                <div className="mt-4 space-y-4 opacity-80">
                  {historyRequests.map(renderRequestCard)}
                </div>
              </details>
            )}
          </div>
        )}

        {/* TAB 3: Pending Shift Transfers */}
        {activeTab === 'transfers' && (
          <div className="mt-6 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <ArrowRightLeft className="w-5 h-5 text-amber-400" />
                <h2 className="text-base font-bold text-white">
                  Incoming Shift Transfer Offers ({incomingTransfers.length})
                </h2>
              </div>
              <span className="text-xs text-slate-400">
                Peers proposing to transfer confirmed shifts to you
              </span>
            </div>

            {incomingTransfers.length === 0 ? (
              <div className="text-center py-20 bg-slate-900/40 rounded-2xl border border-slate-800">
                <ArrowRightLeft className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <h3 className="text-sm font-semibold text-slate-300">No incoming transfer offers</h3>
                <p className="text-xs text-slate-500 mt-1">
                  When other workers propose shift transfers to you, they will appear here.
                </p>
              </div>
            ) : (
              incomingTransfers.map((transfer) => {
                const shift = transfer.shift;
                const fromWorker = transfer.from_worker;
                const isActionLoading = transferActionLoading === transfer.id;

                return (
                  <div
                    key={transfer.id}
                    className="p-5 bg-slate-900 border border-slate-800 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xl"
                  >
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-bold uppercase px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">
                          Transfer Offer
                        </span>
                        <span className="text-xs text-slate-400">
                          From: <strong className="text-white">{fromWorker?.first_name} {fromWorker?.last_name}</strong> ({fromWorker?.email})
                        </span>
                      </div>

                      <h3 className="text-base font-bold text-white mt-1.5">{shift?.title}</h3>
                      <p className="text-xs text-slate-400 flex items-center space-x-2 mt-1">
                        <span className="text-slate-300 font-medium">{shift?.venue?.name}</span>
                        <span>•</span>
                        <span>{shift?.role_type}</span>
                        <span>•</span>
                        <PayLabel rate={shift?.hourly_rate} rateMax={shift?.hourly_rate_max} className="text-emerald-400 font-semibold" />
                        <TipBadge shift={shift} />
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        {fmtDateTime(shift?.start_time, shift?.venue?.timezone)}
                      </p>
                    </div>

                    <div className="flex items-center space-x-2.5 w-full md:w-auto justify-end">
                      <button
                        type="button"
                        onClick={() => handleAcceptTransfer(transfer.id)}
                        disabled={isActionLoading}
                        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center space-x-1.5 shadow-md shadow-emerald-600/20 disabled:opacity-50"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>{isActionLoading ? 'Processing...' : 'Accept Transfer'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRejectTransfer(transfer.id)}
                        disabled={isActionLoading}
                        className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-rose-950 text-slate-300 hover:text-rose-300 border border-slate-700 text-xs font-semibold transition disabled:opacity-50"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </main>

      {/* Phase 26.2: My shift details (big date/time, all notes, "Got it") */}
      {detailItem && (
        <ShiftDetailsModal
          key={detailItem.request_id}
          item={detailItem}
          onClose={() => setDetailRequestId(null)}
          onAcknowledged={handleAcknowledged}
          onOpenBoard={(shiftLike) => setActiveDiscussionShift(shiftLike)}
        />
      )}

      {/* Phase 26.1: Event details + request modal */}
      {openListing && (
        <EventListingModal
          eventId={openListing.eventId}
          initial={openListing.initial}
          onClose={() => setOpenListing(null)}
          onChanged={() => fetchWorkerData(false)}
          onGoToSchedule={() => {
            setOpenListing(null);
            setActiveTab('schedule');
          }}
        />
      )}

      {/* Transfer Proposal Modal */}
      {transferModalOpen && (
        <TransferModal
          isOpen={transferModalOpen}
          onClose={() => setTransferModalOpen(false)}
          myConfirmedShifts={confirmedShifts}
          preselectedShiftId={transferShiftId}
          onTransferSuccess={() => {
            setNotification({
              type: 'success',
              message: 'Transfer proposal sent to peer worker! Awaiting their acceptance.',
            });
            fetchWorkerData();
          }}
        />
      )}

      {/* Shift Discussion Board Modal (Phase 25.3: always on top) */}
      {activeDiscussionShift && (
        <ShiftBoardModal
          shiftId={activeDiscussionShift.id}
          shiftTitle={`${activeDiscussionShift.title} (${activeDiscussionShift.venue?.name || ''})`}
          currentUserRole={user?.role}
          onClose={() => setActiveDiscussionShift(null)}
        />
      )}

      {/* Confirm Drop Modal (Phase 14) */}
      {shiftToDrop && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-800">
              <div className="flex items-center space-x-2 text-rose-500">
                <AlertCircle className="w-5 h-5" />
                <h3 className="text-base font-bold text-white">Confirm Drop Shift</h3>
              </div>
              <button
                type="button"
                onClick={() => setShiftToDrop(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-slate-300 leading-relaxed">
                Are you sure you want to drop this shift? This action cannot be undone, and the shift will be offered to other workers.
              </p>

              {shiftToDrop.shift && (
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs space-y-1">
                  <p className="font-bold text-white">{shiftToDrop.shift.title}</p>
                  <p className="text-slate-400">
                    {shiftToDrop.shift.venue?.name} • {shiftToDrop.shift.role_type} • <PayLabel rate={shiftToDrop.shift.hourly_rate} rateMax={shiftToDrop.shift.hourly_rate_max} />
                  </p>
                  <p className="text-slate-500 text-[11px]">
                    {fmtDateTime(shiftToDrop.shift.start_time, shiftToDrop.shift.venue?.timezone)}
                  </p>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShiftToDrop(null)}
                disabled={dropping}
                className="px-4 py-2 rounded-xl bg-slate-800 text-xs font-semibold text-slate-300 hover:bg-slate-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDropShift}
                disabled={dropping}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition shadow-md shadow-rose-600/20 disabled:opacity-50"
              >
                {dropping ? 'Dropping...' : 'Confirm Drop'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
