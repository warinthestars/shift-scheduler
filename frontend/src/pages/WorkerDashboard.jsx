import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import {
  Calendar, AlertCircle, Briefcase, Check, Search, Filter, ArrowRightLeft, Zap, Info, CalendarDays, AlertTriangle,
  ListChecks, Send, ChevronRight, RotateCcw, X, LayoutGrid,
} from 'lucide-react';
import TransferModal from '../components/TransferModal';
import ShiftBoardModal from '../components/ShiftBoardModal';
import EventListingCard from '../components/EventListingCard';
import EventListingModal from '../components/EventListingModal';
import WorkerCalendar from '../components/WorkerCalendar';
import ShiftDetailsModal from '../components/ShiftDetailsModal';
import WorkerOffers from '../components/WorkerOffers';
import RatingBadge from '../components/RatingBadge';
import { Avatar } from '../components/WorkerProfilePanel';
import MyShiftCard from '../components/worker/MyShiftCard';
import DropShiftDialog from '../components/worker/DropShiftDialog';
import ConfirmDialog from '../components/ConfirmDialog';
import HandoffsPanel from '../components/worker/HandoffsPanel';
import ProfileNudge from '../components/worker/ProfileNudge';
import AppNudge from '../components/AppNudge';   // Phase 33
import EarningsCard from '../components/worker/EarningsCard';   // Phase 33.1
import CoverDialog from '../components/worker/CoverDialog';     // Phase 34
import CoverBoard from '../components/worker/CoverBoard';       // Phase 34
import WaitlistPanel from '../components/worker/WaitlistPanel'; // Phase 34
import LeadBanner from '../components/lead/LeadBanner';         // Phase 36
import { takePublicEvent } from '../utils/publicConfig';        // Phase 36
import { PENDING_INVITE_KEY } from './JoinPage';
import {
  dayGroupLabel, isOnDay, downloadIcs, mapsUrl, whereOf,
} from '../utils/listingFormat';
import { getCurrentPosition } from '../utils/geo';
import { BOARD_NAME } from '../brand';   // Phase 37

const UPCOMING_STATUSES = ['pending', 'pending_manager_approval', 'approved', 'confirmed', 'checked_in'];
const WEEK_MS = 7 * 86400000;   // Phase 37: "this week" for choosing the first tab
const TAB_IDS = ['schedule', 'find', 'calendar', 'transfers'];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;

/**
 * Worker home. Phase 29.4 layout:
 *   Tabs: My shifts · ShiftBoard · Calendar · Hand-offs.
 *   Phase 37: "Find shifts" is now the ShiftBoard: every shift that is up and is NOT already on My shifts
 *   (nothing they asked for, are booked on, are waitlisted for, or were offered).
 *   With no ?tab= in the address, the first tab is My shifts when they have something booked or waiting in the
 *   next 7 days, otherwise the ShiftBoard.
 *   Each shift card has ONE main button (clock in/out, read the update, withdraw, ask to come back)
 *   and a ⋯ menu for the rest (details, directions, calendar, chat, hand off, drop).
 *   Tab ids stay 'schedule' | 'find' | 'calendar' | 'transfers' so notification links keep working.
 */
// Phase 32.2: an event counts as "other departments" when nothing open in it fits the viewer
// (and they have no request in it).
function isOtherDept(l) {
  return l.department_match === 'outside' && !l.my_request;
}

function groupByDay(list) {
  const groups = [];
  list.forEach((l) => {
    const label = dayGroupLabel(l.start_time, l.venue?.timezone);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(l);
    else groups.push({ label, items: [l] });
  });
  return groups;
}

// Phase 34: a full event is listed so people can join its waitlist; it goes in its own section
function isFullOnly(l) {
  return l.full && !l.my_request;
}

function ListingDayGroups({ groups, onOpen }) {
  return groups.map((g) => (
    <section key={g.label}>
      <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
        <Calendar className="w-3.5 h-3.5 text-brand-400" />
        {g.label}
        <span className="text-slate-600 font-semibold normal-case tracking-normal">· {plural(g.items.length, 'event')}</span>
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
        {g.items.map((l) => (
          <EventListingCard key={l.event_id} listing={l} onOpen={onOpen} />
        ))}
      </div>
    </section>
  ));
}

export default function WorkerDashboard() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(TAB_IDS.includes(urlTab) ? urlTab : null);
  const [listings, setListings] = useState([]);
  const [calendar, setCalendar] = useState({ items: [], unread_count: 0 });
  const [detailRequestId, setDetailRequestId] = useState(null);
  const [myShifts, setMyShifts] = useState([]);
  const [incomingTransfers, setIncomingTransfers] = useState([]);
  const [outgoingTransfers, setOutgoingTransfers] = useState([]);   // Phase 29.4
  const [activeClockIns, setActiveClockIns] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [clockActionLoading, setClockActionLoading] = useState(null);
  const [handoffBusy, setHandoffBusy] = useState(null);
  const [withdrawingId, setWithdrawingId] = useState(null);
  const [notification, setNotification] = useState(null);

  // Find Shifts filters
  const [search, setSearch] = useState('');
  const [whenFilter, setWhenFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [venueFilter, setVenueFilter] = useState('ALL');
  const [instantOnly, setInstantOnly] = useState(false);
  const [fitsOnly, setFitsOnly] = useState(false);            // Phase 31: fits my availability, not on time off
  const [mineOnly, setMineOnly] = useState(false);            // Phase 32.2: hide other departments

  const [openListing, setOpenListing] = useState(null); // { eventId, initial }
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferShiftId, setTransferShiftId] = useState(null);
  const [activeDiscussionShift, setActiveDiscussionShift] = useState(null);
  const [shiftToDrop, setShiftToDrop] = useState(null);
  const [earningsKey, setEarningsKey] = useState(0);   // Phase 33.1: reload the hours card after clock-in / out
  const [clockOutAsk, setClockOutAsk] = useState(null);   // Phase 32.3: { shiftId, item, title } waiting for "Clock out?" confirm
  const [offers, setOffers] = useState([]);
  const [offerBusy, setOfferBusy] = useState(null);
  // Phase 34: cover requests + waitlists
  const [coverOpen, setCoverOpen] = useState([]);          // shifts that need cover that I could see
  const [myCovers, setMyCovers] = useState([]);            // my live cover requests
  const [waitlists, setWaitlists] = useState([]);          // my places in line / offers
  const [coverFor, setCoverFor] = useState(null);          // req being posted for cover (dialog)
  const [coverCancel, setCoverCancel] = useState(null);    // { cover, title } waiting for "Cancel cover request?"
  const [coverTake, setCoverTake] = useState(null);        // cover listing waiting for "Take this shift?"
  const [coverBusy, setCoverBusy] = useState(null);
  const [waitBusy, setWaitBusy] = useState(null);
  const navigate = useNavigate();

  const flash = (type, message) => setNotification({ type, message });

  const fetchWorkerData = async (showSpinner = true) => {
    try {
      if (showSpinner) setLoading(true);
      const [listingsRes, myRes, transfersRes, outRes, activeClocksRes, calendarRes, offersRes, coverRes, myCoverRes, waitRes] = await Promise.all([
        api.get('/listings'),
        api.get('/users/me/shifts'),
        api.get('/transfers/my-incoming'),
        api.get('/transfers/my-outgoing').catch(() => ({ data: [] })),
        api.get('/shifts/time-entries/active').catch(() => ({ data: [] })),
        api.get('/me/calendar').catch(() => ({ data: { items: [], unread_count: 0 } })),
        api.get('/me/offers').catch(() => ({ data: [] })),
        api.get('/cover/open').catch(() => ({ data: [] })),        // Phase 34
        api.get('/cover/mine').catch(() => ({ data: [] })),
        api.get('/waitlist/mine').catch(() => ({ data: [] })),
      ]);
      setListings(listingsRes.data || []);
      setOffers(offersRes.data || []);
      setCoverOpen(coverRes.data || []);
      setMyCovers(myCoverRes.data || []);
      setWaitlists(waitRes.data || []);
      setCalendar({ items: calendarRes.data?.items || [], unread_count: calendarRes.data?.unread_count || 0 });
      setMyShifts(myRes.data || []);
      setIncomingTransfers(transfersRes.data || []);
      setOutgoingTransfers(outRes.data || []);
      setActiveClockIns(new Set((activeClocksRes.data || []).map((te) => te.shift_id)));
      // First load (Phase 37): My shifts when something is booked or waiting in the next 7 days, otherwise the ShiftBoard.
      //   booked or asked for  a request whose shift starts within 7 days (or is running now)
      //   waiting on them      an offer from a manager, or a waitlist spot being held
      //   in line              a waitlist place for a shift that starts within 7 days
      setActiveTab((prev) => {
        if (prev) return prev;
        const now = Date.now();
        const soon = (start) => {
          const t = new Date(start).getTime();
          return !Number.isNaN(t) && t <= now + WEEK_MS;
        };
        const upcoming = (myRes.data || []).some((r) => {
          const st = String(r.status || '').toLowerCase();
          if (!UPCOMING_STATUSES.includes(st)) return false;
          if (st === 'checked_in') return true;
          return new Date(r.shift?.end_time).getTime() >= now && soon(r.shift?.start_time);
        });
        const waiting = (waitRes.data || []).some((w) => w.status === 'offered' || soon(w.start_time));
        return upcoming || waiting || (offersRes.data || []).length ? 'schedule' : 'find';
      });
    } catch (err) {
      flash('error', "Couldn't load your shifts. Check your connection and refresh.");
      setActiveTab((prev) => prev || 'find');
    } finally {
      if (showSpinner) setLoading(false);
    }
  };

  useEffect(() => {
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

  // ---- Actions ---------------------------------------------------------------------------
  const handleOffer = async (offer, action) => {
    setOfferBusy(offer.offer_id);
    try {
      const res = await api.post(`/offers/${offer.offer_id}/${action}`);
      flash(action === 'accept' ? 'success' : 'info', action === 'accept' ? res.data.message : 'Offer declined.');
    } catch (err) {
      flash('error', err.response?.data?.detail || 'Could not update the offer.');
    } finally {
      setOfferBusy(null);
      fetchWorkerData(false);
    }
  };

  // Phase 34: cover + waitlist actions
  const takeCover = async (c) => {
    setCoverBusy(c.cover_id);
    try {
      const res = await api.post(`/cover/${c.cover_id}/take`);
      flash('success', res.data.message);
    } catch (err) {
      throw err;   // ConfirmDialog shows it
    } finally {
      setCoverBusy(null);
      fetchWorkerData(false);
    }
  };

  const cancelCover = async (cover) => {
    await api.post(`/cover/${cover.cover_id}/cancel`);
    flash('info', "Cover request cancelled. You're keeping this shift.");
    fetchWorkerData(false);
  };

  const waitAction = async (e, action) => {
    setWaitBusy(e.entry_id);
    try {
      const res = await api.post(`/waitlist/${e.entry_id}/${action}`);
      flash(action === 'take' ? 'success' : 'info', res.data.message);
    } catch (err) {
      flash('error', err.response?.data?.detail || 'Could not update the waitlist.');
    } finally {
      setWaitBusy(null);
      fetchWorkerData(false);
    }
  };

  const handleWithdraw = async (req) => {
    try {
      setWithdrawingId(req.id);
      await api.post(`/listings/requests/${req.id}/withdraw`);
      flash('info', 'Request withdrawn.');
      fetchWorkerData(false);
    } catch (err) {
      flash('error', err.response?.data?.detail || 'Could not withdraw the request.');
    } finally {
      setWithdrawingId(null);
    }
  };

  const handleClockIn = async (shiftId, item) => {
    try {
      setClockActionLoading(shiftId);
      let body = {};
      if (item?.geofence_on) {
        flash('info', 'Checking your location…');
        body = await getCurrentPosition();
      }
      const res = await api.post(`/shifts/${shiftId}/clock-in`, body);
      setActiveClockIns((prev) => new Set([...prev, shiftId]));
      flash(res.data?.geo_status === 'outside_geofence' ? 'info' : 'success', res.data?.message || 'Clocked in.');
      fetchWorkerData(false);
      setEarningsKey((k) => k + 1);
    } catch (err) {
      flash('error', err.response?.data?.detail || err.message || 'Could not clock in.');
    } finally {
      setClockActionLoading(null);
    }
  };

  const handleClockOut = async (shiftId, item) => {
    try {
      setClockActionLoading(shiftId);
      const body = item?.geofence_on ? await getCurrentPosition({ timeoutMs: 8000 }).catch(() => ({})) : {};
      const res = await api.post(`/shifts/${shiftId}/clock-out`, body);
      setActiveClockIns((prev) => {
        const next = new Set(prev);
        next.delete(shiftId);
        return next;
      });
      flash(res.data?.status === 'undone' ? 'info' : 'success', res.data?.message || 'Clocked out.');
      fetchWorkerData(false);
      setEarningsKey((k) => k + 1);
    } catch (err) {
      flash('error', err.response?.data?.detail || 'Could not clock out.');
    } finally {
      setClockActionLoading(null);
    }
  };

  const handoffAction = async (t, action) => {
    setHandoffBusy(t.id);
    try {
      await api.post(`/transfers/${t.id}/${action === 'accept' ? 'accept' : 'reject'}`);
      flash(
        action === 'accept' ? 'success' : 'info',
        action === 'accept'
          ? 'Accepted. Your manager still has to approve it before the shift is yours.'
          : action === 'withdraw'
            ? 'Hand-off withdrawn. You still have the shift.'
            : 'Declined. They keep the shift.',
      );
      fetchWorkerData(false);
    } catch (err) {
      flash('error', err.response?.data?.detail || 'Could not update the hand-off.');
    } finally {
      setHandoffBusy(null);
    }
  };

  // ---- Derived data ----------------------------------------------------------------------
  const confirmedShifts = myShifts.filter((s) => ['approved', 'checked_in', 'confirmed'].includes(String(s.status || '').toLowerCase()));

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
    if (calendarByRequest.has(req.id)) setDetailRequestId(req.id);
    else if (req.shift?.event_id) setOpenListing({ eventId: req.shift.event_id, initial: null });
  };

  // Phase 36: they tapped a shift on the public board, then signed in or signed up: open that shift
  useEffect(() => {
    if (String(user?.role || '').toLowerCase() !== 'worker') return;
    const eventId = takePublicEvent();
    if (!eventId) return;
    setActiveTab('find');
    setOpenListing({ eventId, initial: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep links from notifications (?tab=, ?request=, ?event=)
  const [pendingDeepLink, setPendingDeepLink] = useState(null);
  useEffect(() => {
    const tab = searchParams.get('tab');
    const request = searchParams.get('request');
    const event = searchParams.get('event');
    if (!tab && !request && !event) return;
    if (tab && TAB_IDS.includes(tab)) setActiveTab(tab);
    if (event) setOpenListing({ eventId: event, initial: null });
    if (request) {
      setPendingDeepLink(request);
      fetchWorkerData(false);
    }
    const next = new URLSearchParams(searchParams);
    ['tab', 'request', 'event'].forEach((k) => next.delete(k));
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (pendingDeepLink && calendarByRequest.has(pendingDeepLink)) {
      setDetailRequestId(pendingDeepLink);
      setPendingDeepLink(null);
    }
  }, [pendingDeepLink, calendarByRequest]);

  // The ShiftBoard (Phase 37): everything that is up and is NOT already on My shifts.
  // Left out: an event they asked for or are booked on, one they are waitlisted for, and one they were offered.
  const offeredShiftIds = useMemo(() => new Set(offers.map((o) => o.shift_id)), [offers]);
  const boardListings = useMemo(
    () => listings.filter((l) => !l.my_request && !l.positions.some((p) => p.my_waitlist || offeredShiftIds.has(p.shift_id))),
    [listings, offeredShiftIds]
  );
  const onMyShifts = listings.length - boardListings.length;
  const openListingCount = boardListings.filter((l) => l.total_spots_left > 0).length;   // Phase 34: full events don't count
  const roleOptions = useMemo(
    () => Array.from(new Set(boardListings.flatMap((l) => l.positions.filter((p) => p.status === 'OPEN' || p.can_waitlist).map((p) => p.role_type)))).sort(),
    [boardListings]
  );
  const venueOptions = useMemo(() => {
    const m = new Map();
    boardListings.forEach((l) => l.venue && m.set(l.venue.id, l.venue.name));
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [boardListings]);
  const filteredListings = useMemo(() => {
    const q = search.trim().toLowerCase();
    const weekEnd = Date.now() + 7 * 86400000;
    return boardListings.filter((l) => {
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
      if (roleFilter !== 'ALL' && !l.positions.some((p) => p.role_type === roleFilter && (p.status === 'OPEN' || p.can_waitlist))) return false;
      if (venueFilter !== 'ALL' && l.venue?.id !== venueFilter) return false;
      if (instantOnly && !l.any_instant) return false;
      if (fitsOnly && (l.availability === 'outside' || l.time_off === 'blocked')) return false;   // Phase 31 / 32.1
      if (mineOnly && isOtherDept(l)) return false;                                              // Phase 32.2
      return true;
    });
  }, [boardListings, search, whenFilter, roleFilter, venueFilter, instantOnly, fitsOnly, mineOnly]);
  // Phase 32.2: shifts in my departments first; everything else under "Other departments"
  const listingGroups = useMemo(() => groupByDay(filteredListings.filter((l) => !isOtherDept(l) && !isFullOnly(l))), [filteredListings]);
  const otherGroups = useMemo(() => groupByDay(filteredListings.filter((l) => isOtherDept(l) && !isFullOnly(l))), [filteredListings]);
  const fullListings = useMemo(() => filteredListings.filter(isFullOnly), [filteredListings]);                 // Phase 34
  const fullGroups = useMemo(() => groupByDay(fullListings), [fullListings]);
  const coverByRequest = useMemo(() => new Map(myCovers.map((c) => [c.request_id, c])), [myCovers]);
  const waitOffers = waitlists.filter((w) => w.status === 'offered').length;
  const filtersActive = search || whenFilter !== 'all' || roleFilter !== 'ALL' || venueFilter !== 'ALL' || instantOnly || fitsOnly || mineOnly;
  const clearFilters = () => {
    setSearch('');
    setWhenFilter('all');
    setRoleFilter('ALL');
    setVenueFilter('ALL');
    setInstantOnly(false);
    setFitsOnly(false);
    setMineOnly(false);
  };

  // My shifts: coming up / dropped (can still ask back) / history
  const nowMs = Date.now();
  const isUpcomingReq = (req) => {
    const st = String(req.status || '').toLowerCase();
    if (!UPCOMING_STATUSES.includes(st)) return false;
    if (st === 'checked_in') return true;
    const end = new Date(req.shift?.end_time).getTime();
    return Number.isNaN(end) ? true : end >= nowMs;
  };
  const canAskBack = (req) =>
    String(req.status || '').toLowerCase() === 'dropped'
    && new Date(req.shift?.start_time).getTime() > nowMs
    && String(req.shift?.status || '').toUpperCase() !== 'CANCELLED';
  const upcomingRequests = myShifts.filter(isUpcomingReq).sort((a, b) => new Date(a.shift?.start_time) - new Date(b.shift?.start_time));
  const droppedRequests = myShifts.filter(canAskBack).sort((a, b) => new Date(a.shift?.start_time) - new Date(b.shift?.start_time));
  const historyRequests = myShifts
    .filter((r) => !isUpcomingReq(r) && !canAskBack(r))
    .sort((a, b) => new Date(b.shift?.start_time) - new Date(a.shift?.start_time));
  const needsAnswer = offers.length + incomingTransfers.length + waitOffers;

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

  const renderCard = (req) => {
    const shiftId = req.shift_id || req.shift?.id;
    const calItem = calendarByRequest.get(req.id);
    const place = calItem ? whereOf(calItem) : req.shift?.venue;
    return (
      <MyShiftCard
        key={req.id}
        req={req}
        calItem={calItem}
        clockedIn={activeClockIns.has(shiftId)}
        busy={clockActionLoading === shiftId ? 'clock' : withdrawingId === req.id ? 'withdraw' : null}
        onDetails={(calItem || req.shift?.event_id) ? () => openDetailsForRequest(req) : null}
        onClockIn={() => handleClockIn(shiftId, calItem)}
        onClockOut={() => setClockOutAsk({ shiftId, item: calItem, title: req.shift?.title || calItem?.title || 'this shift' })}
        onBoard={() => setActiveDiscussionShift(req.shift)}
        onHandOff={() => {
          setTransferShiftId(shiftId);
          setTransferModalOpen(true);
        }}
        onDrop={() => setShiftToDrop(req)}
        onWithdraw={() => handleWithdraw(req)}
        onAddCalendar={() => addShiftToCalendar(req)}
        onDirections={place ? () => window.open(mapsUrl(place), '_blank', 'noopener') : null}
        onAskBack={req.shift?.event_id ? () => setOpenListing({ eventId: req.shift.event_id, initial: null }) : null}
        cover={coverByRequest.get(req.id) || null}
        onAskCover={() => setCoverFor(req)}
        onCancelCover={() => setCoverCancel({ cover: coverByRequest.get(req.id), title: req.shift?.title || 'this shift' })}
      />
    );
  };

  // Phase 33: tell the phone tab bar which tab is open and what needs attention
  useEffect(() => {
    if (!activeTab) return;
    const detail = {
      tab: activeTab,
      badges: { schedule: offers.length + waitOffers, calendar: calendar.unread_count || 0, transfers: incomingTransfers.length },
    };
    try { sessionStorage.setItem('shiftboard_worker_tab', JSON.stringify(detail)); } catch (e) { /* private mode */ }
    window.dispatchEvent(new CustomEvent('worker_tab_state', { detail }));
  }, [activeTab, offers.length, waitOffers, calendar.unread_count, incomingTransfers.length]);

  const tabs = [
    { id: 'schedule', label: 'My shifts', icon: ListChecks, count: upcomingRequests.length, badge: waitOffers },
    { id: 'find', label: BOARD_NAME, icon: LayoutGrid, count: openListingCount, badge: coverOpen.filter((c) => c.can_take).length },   // Phase 37
    { id: 'calendar', label: 'Calendar', icon: CalendarDays, badge: calendar.unread_count },
    { id: 'transfers', label: 'Hand-offs', icon: ArrowRightLeft, badge: incomingTransfers.length },
  ];
  const isWorker = String(user?.role || '').toLowerCase() === 'worker';
  const activeTabLabel = (tabs.find((t) => t.id === activeTab) || {}).label;
  const chipBtn = 'px-3 py-1.5 rounded-xl bg-slate-950/80 border border-slate-800 hover:border-slate-600 text-xs text-slate-300 inline-flex items-center gap-1.5';

  return (
    <div className="w-full min-h-screen bg-slate-950 text-slate-100 pb-16">
      {/* Header */}
      <section className="bg-slate-900 border-b border-slate-800 py-6 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto w-full flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar person={user} size="w-12 h-12 text-base" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold text-white truncate">{`${user?.first_name || ''} ${user?.last_name || ''}`.trim() || 'Your shifts'}</h1>
                {!isWorker && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/10 text-indigo-300 border border-indigo-500/30">Worker preview</span>
                )}
              </div>
              {user?.bio && <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{user.bio}</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={chipBtn.replace('hover:border-slate-600', '')}>
              <RatingBadge rating={user?.aggregate_rating ?? user?.rating_average} count={user?.rating_count} />
            </span>
            <button type="button" onClick={() => setActiveTab('schedule')} className={chipBtn}>
              <b className="text-white">{upcomingRequests.length}</b> coming up
            </button>
            {needsAnswer > 0 && (
              <button type="button" onClick={() => setActiveTab(offers.length || waitOffers ? 'schedule' : 'transfers')}
                className={`${chipBtn} border-amber-500/50 text-amber-200`}>
                <b className="text-amber-100">{needsAnswer}</b> waiting for your answer
              </button>
            )}
            <button type="button" onClick={() => setActiveTab('find')} className={chipBtn}>
              <b className="text-white">{openListingCount}</b> open to pick up
            </button>
          </div>
        </div>
      </section>

      <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-6">
        {isWorker && <ProfileNudge />}
        {isWorker && <LeadBanner />}
        <AppNudge />
        {notification && (
          <div className={`mb-5 p-3.5 rounded-xl border flex items-start justify-between gap-3 ${
            notification.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-700 text-emerald-200'
              : notification.type === 'error'
                ? 'bg-rose-950/80 border-rose-700 text-rose-200'
                : 'bg-indigo-950/80 border-indigo-700 text-indigo-200'
          }`}>
            <div className="flex items-start gap-2">
              {notification.type === 'success' ? <Check className="w-5 h-5 text-emerald-400 flex-shrink-0" /> : <AlertCircle className="w-5 h-5 flex-shrink-0" />}
              <span className="text-sm font-medium">{notification.message}</span>
            </div>
            <button type="button" onClick={() => setNotification(null)} aria-label="Dismiss" className="p-1 rounded-lg hover:bg-white/10">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {!isWorker && (
          <div className="mb-5 p-3 rounded-xl border border-indigo-500/40 bg-indigo-500/10 text-indigo-100 text-xs flex items-start gap-2">
            <Info className="w-4 h-4 text-indigo-300 flex-shrink-0 mt-0.5" />
            <span>
              <b>Worker preview.</b> You're seeing this page exactly as a worker would: hidden pay and staff-only notes stay
              hidden unless you're booked on that shift. Your manager screens still show full pay.
            </span>
          </div>
        )}

        {calendar.unread_count > 0 && firstUnread && (
          <div className="mb-5 p-4 rounded-xl border-2 border-amber-500 bg-amber-500/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-black text-amber-100">
                  {calendar.unread_count === 1 ? "1 of your shifts has info you haven't read" : `${calendar.unread_count} of your shifts have info you haven't read`}
                </div>
                <div className="text-xs text-amber-200/80">Notes or times can change after you book. Open the shift and tap “Got it”.</div>
              </div>
            </div>
            <button type="button" onClick={() => setDetailRequestId(firstUnread.request_id)}
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black whitespace-nowrap">
              Review now
            </button>
          </div>
        )}

        {/* Tabs: 2×2 on phones so none are hidden. Phase 33: workers on phones use the bottom tab bar instead. */}
        {isWorker && activeTabLabel && (
          <h2 className="md:hidden text-lg font-bold text-white border-b border-slate-800 pb-3">{activeTabLabel}</h2>
        )}
        <div className={`${isWorker ? 'hidden md:flex md:flex-wrap' : 'grid grid-cols-2 sm:flex sm:flex-wrap'} gap-2 border-b border-slate-800 pb-4`}>
          {tabs.map((t) => {
            const Icon = t.icon;
            const on = activeTab === t.id;
            return (
              <button key={t.id} type="button" onClick={() => setActiveTab(t.id)}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold transition inline-flex items-center justify-center gap-1.5 ${
                  on ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20' : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'}`}>
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
                {t.count !== undefined && <span className={on ? 'text-slate-900' : 'text-slate-500'}>{t.count}</span>}
                {t.badge > 0 && (
                  <span className="min-w-[1.25rem] h-5 px-1 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black inline-flex items-center justify-center">{t.badge}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Offers get answered on My shifts; elsewhere a slim reminder */}
        {offers.length + waitOffers > 0 && activeTab !== 'schedule' && (
          <button type="button" onClick={() => setActiveTab('schedule')}
            className="mt-4 w-full p-3 rounded-xl border border-indigo-500/40 bg-indigo-500/5 text-left text-sm text-indigo-100 flex items-center gap-2 hover:bg-indigo-500/10">
            <Send className="w-4 h-4 text-indigo-300" />
            <span className="flex-1">{plural(offers.length + waitOffers, 'shift')} offered to you. Answer on My shifts.</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        )}

        {activeTab === null && <div className="py-20 text-center text-slate-500 text-xs">Loading your shifts…</div>}

        {/* My shifts */}
        {activeTab === 'schedule' && (
          <div className="mt-2 space-y-6">
            <EarningsCard refreshKey={earningsKey} />
            <WorkerOffers offers={offers} busyId={offerBusy} onAccept={(o) => handleOffer(o, 'accept')} onDecline={(o) => handleOffer(o, 'decline')} />
            <WaitlistPanel entries={waitlists} busyId={waitBusy}
              onTake={(e) => waitAction(e, 'take')} onPass={(e) => waitAction(e, 'pass')} onLeave={(e) => waitAction(e, 'leave')}
              onExpired={() => fetchWorkerData(false)} />
            <section className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mt-4">Coming up</h2>
              {loading ? (
                <div className="py-12 text-center text-slate-500 text-xs">Loading…</div>
              ) : upcomingRequests.length === 0 ? (
                <div className="text-center py-12 bg-slate-900/40 rounded-2xl border border-slate-800">
                  <Calendar className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                  <h3 className="text-sm font-semibold text-slate-300">Nothing coming up</h3>
                  <button type="button" onClick={() => setActiveTab('find')} className="mt-2 text-xs text-brand-400 hover:text-brand-300 font-semibold">
                    Open the {BOARD_NAME} →
                  </button>
                </div>
              ) : (
                upcomingRequests.map(renderCard)
              )}
            </section>

            {droppedRequests.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <RotateCcw className="w-3.5 h-3.5" /> Dropped · you can still ask to come back
                </h2>
                <p className="text-[11px] text-slate-500 -mt-1">Your manager has to approve it, and they'll see why you can make it now.</p>
                {droppedRequests.map(renderCard)}
              </section>
            )}

            {historyRequests.length > 0 && (
              <details className="group pt-1">
                <summary className="cursor-pointer select-none text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-white">
                  Past & closed ({historyRequests.length})
                </summary>
                <div className="mt-4 space-y-3 opacity-80">{historyRequests.map(renderCard)}</div>
              </details>
            )}
          </div>
        )}

        {/* The ShiftBoard (Phase 37; the tab id is still 'find') */}
        {activeTab === 'find' && (
          <div className="mt-6">
            <div className="mb-5 flex flex-col sm:flex-row sm:items-end justify-between gap-2">
              <div>
                <h2 className="hidden md:flex text-xl font-extrabold text-white items-center gap-2">
                  <LayoutGrid className="w-5 h-5 text-brand-400" /> {BOARD_NAME}
                </h2>
                <p className="text-sm text-slate-400 md:mt-0.5">Every shift that's up and isn't yours yet.</p>
              </div>
              {onMyShifts > 0 && (
                <button type="button" onClick={() => setActiveTab('schedule')}
                  className="self-start sm:self-auto text-xs font-semibold text-brand-400 hover:text-brand-300 inline-flex items-center gap-1">
                  {plural(onMyShifts, 'event')} {onMyShifts === 1 ? 'is' : 'are'} already on My shifts <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <CoverBoard items={coverOpen} busyId={coverBusy} onTake={(c) => setCoverTake(c)} />
            <div className="mt-6 bg-slate-900/60 border border-slate-800 rounded-2xl p-3 sm:p-4 space-y-3">
              <div className="flex flex-col lg:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search events, venues, positions"
                    className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-100 focus:outline-none focus:border-brand-500" />
                </div>
                <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1 overflow-x-auto">
                  {[{ id: 'all', label: 'All dates' }, { id: 'today', label: 'Today' }, { id: 'tomorrow', label: 'Tomorrow' }, { id: 'week', label: 'Next 7 days' }].map((w) => (
                    <button key={w.id} type="button" onClick={() => setWhenFilter(w.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${whenFilter === w.id ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                      {w.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
                  className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-medium text-slate-200 focus:outline-none focus:border-brand-500">
                  <option value="ALL">All positions</option>
                  {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <select value={venueFilter} onChange={(e) => setVenueFilter(e.target.value)}
                  className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-medium text-slate-200 focus:outline-none focus:border-brand-500">
                  <option value="ALL">All venues</option>
                  {venueOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
                <button type="button" onClick={() => setInstantOnly((v) => !v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border inline-flex items-center gap-1 transition ${
                    instantOnly ? 'bg-brand-500/15 text-brand-300 border-brand-500/40' : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'}`}>
                  <Zap className="w-3.5 h-3.5" /> Instant book
                </button>
                <button type="button" onClick={() => setFitsOnly((v) => !v)}
                  title="Hide shifts outside your weekly availability or on days you have time off"
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border inline-flex items-center gap-1 transition ${
                    fitsOnly ? 'bg-brand-500/15 text-brand-300 border-brand-500/40' : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'}`}>
                  <CalendarDays className="w-3.5 h-3.5" /> Fits my availability
                </button>
                <button type="button" onClick={() => setMineOnly((v) => !v)}
                  title="Hide shifts outside the departments you work"
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border inline-flex items-center gap-1 transition ${
                    mineOnly ? 'bg-brand-500/15 text-brand-300 border-brand-500/40' : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'}`}>
                  <Briefcase className="w-3.5 h-3.5" /> Only my departments
                </button>
                {filtersActive && (
                  <button type="button" onClick={clearFilters} className="text-xs text-slate-400 underline hover:text-white ml-auto">Clear filters</button>
                )}
              </div>
            </div>

            {loading ? (
              <div className="py-20 text-center text-slate-500 text-xs">Loading open shifts…</div>
            ) : filteredListings.length === 0 ? (
              <div className="mt-6 text-center py-20 bg-slate-900/40 rounded-2xl border border-slate-800">
                <Briefcase className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <h3 className="text-sm font-semibold text-slate-300">{boardListings.length === 0 ? (onMyShifts > 0 ? 'Nothing else is open right now' : 'No shifts open right now') : 'Nothing matches these filters'}</h3>
                <p className="text-xs text-slate-500 mt-1">
                  {boardListings.length === 0 ? "Check back soon. You'll get a notification when a venue you work with posts a shift." : 'Try clearing a filter or two.'}
                </p>
              </div>
            ) : (
              <div className="mt-6 space-y-8">
                {listingGroups.length === 0 && otherGroups.length === 0 && fullGroups.length > 0 && (
                  <p className="text-xs text-slate-400 bg-slate-900/40 border border-slate-800 rounded-2xl p-4 text-center">
                    Everything listed is full right now. Join a waitlist below and we'll let you know if a spot opens.
                  </p>
                )}
                {listingGroups.length === 0 && otherGroups.length > 0 && (
                  <p className="text-xs text-slate-400 bg-slate-900/40 border border-slate-800 rounded-2xl p-4 text-center">
                    Nothing open in your departments right now.{' '}
                    <Link to="/profile?tab=about" className="text-brand-300 hover:underline font-semibold">Check your departments</Link>
                  </p>
                )}
                <ListingDayGroups groups={listingGroups} onOpen={(item) => setOpenListing({ eventId: item.event_id, initial: item })} />
                {otherGroups.length > 0 && (
                  <div className="space-y-6 pt-2">
                    <div className="border-t border-slate-800 pt-6">
                      <h2 className="text-sm font-bold text-slate-200">Other departments</h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        These aren't in the departments you work, so a manager has to approve them.{' '}
                        <Link to="/profile?tab=about" className="text-brand-300 hover:underline">Change your departments</Link>
                      </p>
                    </div>
                    <ListingDayGroups groups={otherGroups} onOpen={(item) => setOpenListing({ eventId: item.event_id, initial: item })} />
                  </div>
                )}
                {/* Phase 34: full events, so people can get in line */}
                {fullGroups.length > 0 && (
                  <details className="group border-t border-slate-800 pt-6">
                    <summary className="cursor-pointer select-none list-none">
                      <span className="text-sm font-bold text-slate-200">Full: join a waitlist ({fullListings.length})</span>
                      <span className="block text-xs text-slate-500 mt-0.5">
                        No spots left. Join the line and we'll book you (or offer you the spot) if one opens.
                      </span>
                    </summary>
                    <div className="mt-6 space-y-6">
                      <ListingDayGroups groups={fullGroups} onOpen={(item) => setOpenListing({ eventId: item.event_id, initial: item })} />
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        )}

        {/* Calendar */}
        {activeTab === 'calendar' && (
          <div className="mt-6">
            {loading ? (
              <div className="py-20 text-center text-slate-500 text-xs">Loading your calendar…</div>
            ) : (
              <WorkerCalendar
                items={calendar.items}
                openListings={boardListings.filter((l) => !isFullOnly(l))}
                onSelectItem={(item) => setDetailRequestId(item.request_id)}
                onSelectListing={(l) => setOpenListing({ eventId: l.event_id, initial: l })}
              />
            )}
          </div>
        )}

        {/* Hand-offs */}
        {activeTab === 'transfers' && (
          <div className="mt-6">
            <HandoffsPanel
              incoming={incomingTransfers}
              outgoing={outgoingTransfers}
              busyId={handoffBusy}
              onAccept={(t) => handoffAction(t, 'accept')}
              onDecline={(t) => handoffAction(t, 'decline')}
              onWithdraw={(t) => handoffAction(t, 'withdraw')}
            />
          </div>
        )}
      </main>

      {detailItem && (
        <ShiftDetailsModal
          key={detailItem.request_id}
          item={detailItem}
          onClose={() => setDetailRequestId(null)}
          onAcknowledged={handleAcknowledged}
          onOpenBoard={(shiftLike) => setActiveDiscussionShift(shiftLike)}
        />
      )}

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

      {transferModalOpen && (
        <TransferModal
          isOpen={transferModalOpen}
          onClose={() => setTransferModalOpen(false)}
          myConfirmedShifts={confirmedShifts}
          preselectedShiftId={transferShiftId}
          onTransferSuccess={() => {
            flash('success', "Hand-off sent. Once they accept and your manager approves, it's theirs. Until then it's still yours.");
            fetchWorkerData(false);
          }}
        />
      )}

      {activeDiscussionShift && (
        <ShiftBoardModal
          shiftId={activeDiscussionShift.id}
          shiftTitle={`${activeDiscussionShift.title} (${activeDiscussionShift.venue?.name || ''})`}
          currentUserRole={user?.role}
          onClose={() => setActiveDiscussionShift(null)}
        />
      )}

      {/* Phase 32.3: Clock out replaces Clock in on the same button, so it asks first (a quick second tap would undo the clock-in) */}
      {clockOutAsk && (
        <ConfirmDialog
          title="Clock out now?"
          message={`You'll be clocked out of ${clockOutAsk.title} right now. If you clocked in less than a minute ago, this undoes the clock-in instead.`}
          confirmLabel="Clock out"
          danger
          onConfirm={() => handleClockOut(clockOutAsk.shiftId, clockOutAsk.item)}
          onClose={() => setClockOutAsk(null)}
        />
      )}

      {/* Phase 34: cover */}
      {coverFor && (
        <CoverDialog req={coverFor} onClose={() => setCoverFor(null)}
          onPosted={(message) => { flash('success', message); fetchWorkerData(false); }} />
      )}
      {coverCancel && (
        <ConfirmDialog
          title="Cancel your cover request?"
          message={`Nobody will be able to take ${coverCancel.title} from you anymore. You're still booked on it.`}
          confirmLabel="Cancel cover request"
          onConfirm={() => cancelCover(coverCancel.cover)}
          onClose={() => setCoverCancel(null)}
        />
      )}
      {coverTake && (
        <ConfirmDialog
          title={coverTake.booking === 'instant' ? 'Take this shift?' : 'Ask to take this shift?'}
          message={`${coverTake.role_type} · ${coverTake.title} at ${coverTake.venue_name}, covering for ${coverTake.from_first_name}. ${
            coverTake.booking === 'instant'
              ? "It's yours right away and goes in My shifts."
              : `The manager has to approve it. Until then it's still ${coverTake.from_first_name}'s.`}${coverTake.take_note ? ` ${coverTake.take_note}` : ''}`}
          confirmLabel={coverTake.booking === 'instant' ? 'Take it' : 'Send to the manager'}
          onConfirm={() => takeCover(coverTake)}
          onClose={() => setCoverTake(null)}
        />
      )}

      {shiftToDrop && (
        <DropShiftDialog
          req={shiftToDrop}
          onClose={() => setShiftToDrop(null)}
          onDropped={(message) => {
            flash('success', message);
            fetchWorkerData(false);
          }}
        />
      )}
    </div>
  );
}
