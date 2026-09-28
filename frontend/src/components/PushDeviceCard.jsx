import React, { useEffect, useState } from 'react';
import { Smartphone, BellRing, BellOff, Send, Trash2, Share, PlusSquare, Info } from 'lucide-react';
import api from '../api/client';
import {
  permissionState, currentSubscription, enablePush, disablePush, sendTestPush, isIOS,
} from '../utils/push';

const btn = 'px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50';

function fmtDay(value) {
  try {
    return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch (e) {
    return '';
  }
}

/**
 * Phase 33: phone / browser notifications (Web Push) for THIS device, plus the account's other devices.
 * Props: pushEnabled (prefs.push_enabled), onPushEnabled(bool) (saved with the modal's Save button)
 */
export default function PushDeviceCard({ pushEnabled, onPushEnabled }) {
  const [state, setState] = useState(permissionState());
  const [subscribed, setSubscribed] = useState(false);
  const [devices, setDevices] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);   // { type, text }

  const refresh = async () => {
    setState(permissionState());
    try {
      const [sub, cfg] = await Promise.all([currentSubscription(), api.get('/notifications/push')]);
      setDevices(cfg.data.devices || []);
      setSubscribed(Boolean(sub) && (cfg.data.devices || []).length > 0);
    } catch (e) {
      /* keep what we have */
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const run = async (fn, okText) => {
    setBusy(true);
    setMsg(null);
    try {
      const out = await fn();
      if (okText) setMsg({ type: 'success', text: typeof okText === 'function' ? okText(out) : okText });
    } catch (err) {
      setMsg({ type: 'error', text: err.response?.data?.detail || err.message || 'Something went wrong.' });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const turnOn = () => run(async () => {
    await enablePush();
    if (!pushEnabled) onPushEnabled(true);
  }, "Notifications are on for this device. Tap Save to keep your other settings.");
  const turnOff = () => run(disablePush, 'Turned off for this device.');
  const test = () => run(sendTestPush, (r) => (r.reached ? `Sent to ${r.reached} device${r.reached === 1 ? '' : 's'}.` : r.error || 'No device got it.'));
  const remove = (id) => run(async () => {
    await api.delete(`/notifications/push/devices/${id}`);
  }, 'Device removed.');

  return (
    <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-white">
        <Smartphone className="w-4 h-4 text-emerald-400" /> Phone notifications
      </div>
      <p className="text-xs text-slate-400">
        Pop-up alerts on your phone or computer, like a text but free. Same messages as email, plus new shifts if you
        chose "Right away". Quiet hours apply.
      </p>

      {state === 'needs_install' && (
        <div className="p-3 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-300 space-y-1.5">
          <p className="font-semibold text-white">On iPhone and iPad, notifications work from the ShiftBoard app on your Home Screen:</p>
          <p className="flex items-start gap-1.5"><Share className="w-3.5 h-3.5 text-sky-400 flex-shrink-0 mt-0.5" /><span>1. Tap <b>Share</b> in Safari.</span></p>
          <p className="flex items-start gap-1.5"><PlusSquare className="w-3.5 h-3.5 text-sky-400 flex-shrink-0 mt-0.5" /><span>2. Tap <b>Add to Home Screen</b>.</span></p>
          <p>3. Open ShiftBoard from your Home Screen and come back here.</p>
        </div>
      )}
      {state === 'unsupported' && (
        <p className="text-xs text-slate-500">This browser can't show notifications. Try Chrome, Edge, Firefox or Safari.</p>
      )}
      {state === 'denied' && (
        <p className="text-xs text-amber-300 flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>Notifications are blocked for ShiftBoard on this device. Allow them in your {isIOS() ? 'iPhone Settings → Notifications → ShiftBoard' : 'browser’s site settings'}, then come back.</span>
        </p>
      )}

      {(state === 'default' || state === 'granted') && (
        <div className="flex flex-wrap items-center gap-2">
          {subscribed ? (
            <>
              <span className="text-xs font-semibold text-emerald-300 inline-flex items-center gap-1.5 mr-auto">
                <BellRing className="w-4 h-4" /> On for this device
              </span>
              <button type="button" onClick={test} disabled={busy} className={`${btn} bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200`}>
                <Send className="w-3.5 h-3.5" /> Send a test
              </button>
              <button type="button" onClick={turnOff} disabled={busy} className={`${btn} bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300`}>
                <BellOff className="w-3.5 h-3.5" /> Turn off here
              </button>
            </>
          ) : (
            <button type="button" onClick={turnOn} disabled={busy} className={`${btn} bg-emerald-500 hover:bg-emerald-400 text-slate-950`}>
              <BellRing className="w-3.5 h-3.5" /> {busy ? 'Turning on…' : 'Turn on for this device'}
            </button>
          )}
        </div>
      )}

      {msg && (
        <p className={`text-xs ${msg.type === 'success' ? 'text-emerald-300' : 'text-rose-300'}`}>{msg.text}</p>
      )}

      {devices.length > 0 && (
        <div className="pt-1 space-y-1.5">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={!!pushEnabled} onChange={(e) => onPushEnabled(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded bg-slate-800 border-slate-700 text-emerald-500" />
            <span className="text-xs text-slate-300">Send notifications to my devices</span>
          </label>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Your devices ({devices.length})</div>
          {devices.map((d) => (
            <div key={d.id} className="flex items-center gap-2 text-xs text-slate-300">
              <Smartphone className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
              <span className="flex-1 min-w-0 truncate">
                {d.device_label || 'Device'} <span className="text-slate-500">· added {fmtDay(d.created_at)}{d.provider === 'fcm' ? ' · via Firebase' : ''}</span>
                {d.last_error && <span className="text-amber-300"> · last try failed</span>}
              </span>
              <button type="button" onClick={() => remove(d.id)} disabled={busy} title="Remove this device"
                className="p-1 rounded text-slate-500 hover:text-rose-300 hover:bg-rose-500/10">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
