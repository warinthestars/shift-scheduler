import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Bell, CheckCheck, Settings, AlertTriangle } from 'lucide-react';
import api from '../api/client';
import NotificationSettingsModal from './NotificationSettingsModal';

const POLL_MS = 60000;

function timeAgo(value) {
  const s = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/**
 * Phase 28: Bell in the navbar. Polls the unread count every minute (and when the tab regains focus),
 * shows the latest notifications, opens the linked screen, and opens notification settings
 * (also when the URL has ?notifications=settings, e.g. from an email footer).
 */
export default function NotificationBell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const panelRef = useRef(null);

  const loadCount = useCallback(async () => {
    try {
      const res = await api.get('/notifications/unread-count');
      setCount(res.data?.count || 0);
    } catch (e) {
      /* not signed in / offline: keep the last value */
    }
  }, []);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/notifications', { params: { limit: 30 } });
      setItems(res.data || []);
    } catch (e) {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCount();
    const t = setInterval(loadCount, POLL_MS);
    const onFocus = () => document.visibilityState === 'visible' && loadCount();
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [loadCount]);

  // Refresh when the page changes (e.g. after acting on something)
  useEffect(() => {
    loadCount();
  }, [location.pathname, loadCount]);

  // ?notifications=settings opens the settings (email footer link)
  useEffect(() => {
    if (searchParams.get('notifications') === 'settings') {
      setShowSettings(true);
      const next = new URLSearchParams(searchParams);
      next.delete('notifications');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Close the panel on outside click
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) loadItems();
  };

  const openItem = async (n) => {
    setOpen(false);
    if (!n.read) {
      try {
        const res = await api.post(`/notifications/${n.id}/read`);
        setCount(res.data?.count ?? Math.max(0, count - 1));
      } catch (e) {
        /* ignore */
      }
    }
    if (n.link) navigate(n.link);
  };

  const readAll = async () => {
    try {
      await api.post('/notifications/read-all');
      setCount(0);
      setItems((xs) => xs.map((x) => ({ ...x, read: true })));
    } catch (e) {
      /* ignore */
    }
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={toggle}
        aria-label={count ? `${count} unread notifications` : 'Notifications'}
        className="relative p-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800/80 transition"
      >
        <Bell className="w-5 h-5" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-rose-500 text-white text-[10px] font-black flex items-center justify-center">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed sm:absolute left-2 right-2 sm:left-auto sm:right-0 top-16 sm:top-auto sm:mt-2 sm:w-96 z-[70] rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
            <span className="text-sm font-bold text-white">Notifications</span>
            <div className="flex items-center gap-1">
              <button type="button" onClick={readAll} title="Mark all as read"
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
                <CheckCheck className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => { setOpen(false); setShowSettings(true); }} title="Notification settings"
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
                <Settings className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="max-h-[70vh] overflow-y-auto divide-y divide-slate-800">
            {loading && items.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-slate-500">Loading…</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-slate-500">You're all caught up.</p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => openItem(n)}
                  className={`w-full text-left px-4 py-3 hover:bg-slate-800/70 transition flex gap-3 ${n.read ? 'opacity-70' : ''}`}
                >
                  <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${n.read ? 'bg-transparent' : n.urgent ? 'bg-rose-400' : 'bg-emerald-400'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      {n.urgent && !n.read && <AlertTriangle className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />}
                      <span className={`text-sm ${n.read ? 'text-slate-300' : 'text-white font-semibold'}`}>{n.title}</span>
                    </span>
                    {n.body && <span className="block text-xs text-slate-400 mt-0.5 whitespace-pre-line line-clamp-3">{n.body}</span>}
                    <span className="block text-[10px] text-slate-500 mt-1">{timeAgo(n.created_at)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {showSettings && <NotificationSettingsModal onClose={() => setShowSettings(false)} onSent={loadCount} />}
    </div>
  );
}
