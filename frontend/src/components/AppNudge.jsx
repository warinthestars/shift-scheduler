import React, { useEffect, useState } from 'react';
import { Smartphone, BellRing, X, Share, PlusSquare, Download } from 'lucide-react';
import {
  isStandalone, isIOS, permissionState, currentSubscription, enablePush, canPromptInstall, promptInstall,
} from '../utils/push';

const KEY_INSTALL = 'shiftboard_nudge_install_dismissed';
const KEY_PUSH = 'shiftboard_nudge_push_dismissed';
const isPhone = () => window.matchMedia && window.matchMedia('(max-width: 767px)').matches;

/**
 * Phase 33: one small, dismissible card on the dashboard:
 *   1. on a phone, not installed yet  -> "Get the ShiftBoard app" (Install button, or iPhone steps)
 *   2. installed / on a computer, notifications not on here -> "Turn on notifications"
 * Dismissing hides it on this device (localStorage).
 * Props: manager (bool) for the manager dashboard's wording.
 */
export default function AppNudge({ manager = false }) {
  const [mode, setMode] = useState(null);      // 'install' | 'push' | null
  const [showSteps, setShowSteps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const decide = async () => {
    const dismissed = (k) => {
      try { return localStorage.getItem(k) === '1'; } catch (e) { return false; }
    };
    if (!isStandalone() && isPhone() && !dismissed(KEY_INSTALL) && (isIOS() || canPromptInstall())) {
      setMode('install');
      return;
    }
    const state = permissionState();
    if ((state === 'default' || state === 'granted') && !dismissed(KEY_PUSH)) {
      const sub = await currentSubscription().catch(() => null);
      setMode(sub ? null : 'push');
      return;
    }
    setMode(null);
  };

  useEffect(() => {
    decide();
    const again = () => decide();
    window.addEventListener('shiftboard_install_ready', again);
    return () => window.removeEventListener('shiftboard_install_ready', again);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!mode) return null;

  const dismiss = () => {
    try { localStorage.setItem(mode === 'install' ? KEY_INSTALL : KEY_PUSH, '1'); } catch (e) { /* private mode */ }
    setMode(null);
  };

  const install = async () => {
    if (isIOS()) {
      setShowSteps(true);
      return;
    }
    setBusy(true);
    await promptInstall();
    setBusy(false);
    decide();
  };

  const turnOn = async () => {
    setBusy(true);
    setError('');
    try {
      await enablePush();
      setMode(null);
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Could not turn on notifications.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-5 p-3.5 rounded-xl border border-emerald-500/40 bg-emerald-500/5 flex items-start gap-3">
      {mode === 'install' ? <Smartphone className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" /> : <BellRing className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-white">
          {mode === 'install' ? 'Get the ShiftBoard app on your phone' : 'Get shift alerts on this device'}
        </p>
        <p className="text-xs text-slate-400 mt-0.5">
          {mode === 'install'
            ? 'One tap from your Home Screen, full screen, and notifications when shifts change.'
            : manager
              ? 'Know right away about new requests, drops, and people who haven’t clocked in.'
              : 'Know right away when you’re booked, a shift changes, or it’s time to clock in.'}
        </p>
        {showSteps && (
          <div className="mt-2 text-xs text-slate-300 space-y-1">
            <p className="flex items-start gap-1.5"><Share className="w-3.5 h-3.5 text-sky-400 flex-shrink-0 mt-0.5" /><span>1. Tap <b>Share</b> at the bottom of Safari.</span></p>
            <p className="flex items-start gap-1.5"><PlusSquare className="w-3.5 h-3.5 text-sky-400 flex-shrink-0 mt-0.5" /><span>2. Tap <b>Add to Home Screen</b>, then <b>Add</b>.</span></p>
            <p>3. Open ShiftBoard from your Home Screen.</p>
          </div>
        )}
        {error && <p className="mt-1.5 text-xs text-rose-300">{error}</p>}
        {!showSteps && (
          <button type="button" onClick={mode === 'install' ? install : turnOn} disabled={busy}
            className="mt-2 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
            {mode === 'install' ? <Download className="w-3.5 h-3.5" /> : <BellRing className="w-3.5 h-3.5" />}
            {busy ? 'One moment…' : mode === 'install' ? (isIOS() ? 'Show me how' : 'Install') : 'Turn on notifications'}
          </button>
        )}
      </div>
      <button type="button" onClick={dismiss} aria-label="Not now" className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
