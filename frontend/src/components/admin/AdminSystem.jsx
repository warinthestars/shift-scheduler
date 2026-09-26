import React, { useEffect, useState } from 'react';
import {
  Settings2, CheckCircle2, AlertTriangle, XCircle, Activity, Mail, RefreshCw, Send, Database, RotateCcw,
} from 'lucide-react';
import api from '../../api/client';
import { card, inputCls, btnGhost, btnPrimary, SectionTitle, ago, fmtDateTime } from './adminUi';

function Row({ state, label, children }) {
  const [Icon, tone] = state === 'ok' ? [CheckCircle2, 'text-emerald-400'] : state === 'bad' ? [XCircle, 'text-rose-400'] : [AlertTriangle, 'text-amber-400'];
  return (
    <div className="py-2.5 flex items-start gap-3">
      <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${tone}`} />
      <div className="min-w-0 flex-1">
        <div className="text-sm text-white font-semibold">{label}</div>
        <div className="text-xs text-slate-400 mt-0.5 break-words">{children}</div>
      </div>
    </div>
  );
}

/**
 * Phase 29.2: System tab. GET /admin/system, GET /admin/deliveries, retry, test email.
 * Props: refreshKey, onFlash({type, message})
 */
export default function AdminSystem({ refreshKey = 0, onFlash }) {
  const [sys, setSys] = useState(null);
  const [failed, setFailed] = useState([]);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    let active = true;
    setError('');
    Promise.all([api.get('/admin/system'), api.get('/admin/deliveries', { params: { status: 'failed', limit: 25 } })])
      .then(([s, d]) => {
        if (!active) return;
        setSys(s.data);
        setFailed(d.data || []);
      })
      .catch((err) => active && setError(err.response?.data?.detail || 'Could not load system status.'));
    return () => {
      active = false;
    };
  }, [refreshKey, reload]);

  const run = async (key, fn) => {
    setBusy(key);
    try {
      const res = await fn();
      onFlash({ type: 'success', message: res.data?.detail || 'Done.' });
      setReload((n) => n + 1);
    } catch (err) {
      onFlash({ type: 'error', message: err.response?.data?.detail || 'That did not work.' });
    } finally {
      setBusy('');
    }
  };

  if (error) return <p className="text-sm text-rose-300">{error}</p>;
  if (!sys) return <p className="text-sm text-slate-500 py-10 text-center">Loading…</p>;

  const beat = sys.worker_heartbeat_at ? new Date(sys.worker_heartbeat_at) : null;
  const beatFresh = beat && Date.now() - beat.getTime() < 3 * 60 * 1000;
  const workerState = !sys.worker_enabled ? 'warn' : beatFresh && sys.worker_last_ok !== false ? 'ok' : 'bad';
  const d = sys.deliveries;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className={`${card} p-4`}>
          <SectionTitle
            icon={Settings2}
            title="Configuration"
            right={(
              <button type="button" onClick={() => setReload((n) => n + 1)} className={btnGhost}>
                <RefreshCw className="w-3 h-3" /> Refresh
              </button>
            )}
          />
          <div className="divide-y divide-slate-800">
            <Row state={sys.app_base_url_ok ? 'ok' : 'bad'} label="Public address (APP_BASE_URL)">
              {sys.app_base_url || 'Not set'}{!sys.app_base_url_ok && ' · links in emails, texts and invites will not open for people.'}
            </Row>
            <Row state={sys.email_ready ? 'ok' : 'warn'} label="Email">
              {sys.email_ready ? `${sys.email_provider.toUpperCase()} from ${sys.email_from}` : `Console mode: emails are only written to the backend log (provider "${sys.email_provider}").`}
            </Row>
            <Row state={sys.sms_ready && sys.sms_provider !== 'console' ? 'ok' : 'warn'} label="Text messages">
              {sys.sms_provider === 'console'
                ? 'Console mode: texts are only written to the backend log.'
                : sys.sms_ready ? `Sending with ${sys.sms_provider}` : `Not sending (provider "${sys.sms_provider}"). People only get emails and in-app notifications.`}
            </Row>
            <Row state={sys.firebase === 'real' ? 'ok' : 'warn'} label="Google / Firebase sign-in">
              {sys.firebase === 'real' ? 'On' : sys.firebase === 'mock' ? 'Mock mode (testing only)' : 'Off: people sign in with a ShiftBoard password only'}
            </Row>
            <Row state="ok" label="Self sign-up">
              {sys.self_registration ? 'Anyone can create a worker account.' : 'Off: only admins and invites create accounts.'}
            </Row>
            <Row state={sys.always_admin_count ? 'ok' : 'warn'} label="Always-admin accounts">
              {sys.always_admin_count} listed in ALWAYS_ADMIN_EMAILS{sys.always_admin_count ? '' : ' (add one so you can never be locked out)'}
            </Row>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">Change these in the backend's secrets file and restart the backend container.</p>
        </section>

        <section className={`${card} p-4`}>
          <SectionTitle icon={Activity} title="Background worker" tone="text-emerald-400" />
          <div className="divide-y divide-slate-800">
            <Row state={workerState} label={!sys.worker_enabled ? 'Turned off' : workerState === 'ok' ? 'Running' : 'Not responding'}>
              {sys.worker_enabled
                ? <>Sends emails and texts, the daily new-shift digest (around {sys.digest_hour}:00 local time), shift reminders and late clock-in alerts.</>
                : 'NOTIFICATIONS_WORKER_ENABLED is false, so no emails, texts, reminders or late alerts go out.'}
            </Row>
            <Row state={beatFresh ? 'ok' : 'warn'} label="Last heartbeat">
              {beat ? `${ago(beat)} (${fmtDateTime(beat)})` : 'None recorded yet (Redis unreachable or the worker has not ticked).'}
            </Row>
            {sys.worker_last_error && (
              <Row state="bad" label="Last error in this process">
                <span className="font-mono">{sys.worker_last_error}</span>
              </Row>
            )}
          </div>
          <div className="grid grid-cols-5 gap-2 mt-3">
            {[
              ['Queued', d.pending, 'text-white'],
              ['Sent 24h', d.sent_24h, 'text-emerald-400'],
              ['Failed 24h', d.failed_24h, d.failed_24h ? 'text-rose-400' : 'text-white'],
              ['Failed 7d', d.failed_7d, d.failed_7d ? 'text-rose-400' : 'text-white'],
              ['Skipped 24h', d.skipped_24h, 'text-slate-400'],
            ].map(([label, value, tone]) => (
              <div key={label} className="p-2 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold whitespace-nowrap truncate">{label}</div>
                <div className={`text-lg font-black font-mono ${tone}`}>{value}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className={`${card} p-4`}>
        <SectionTitle
          icon={XCircle}
          tone="text-rose-400"
          title={`Failed emails & texts (${failed.length})`}
          right={failed.length > 0 && (
            <button type="button" disabled={busy === 'all'} onClick={() => run('all', () => api.post('/admin/deliveries/retry-failed'))} className={btnGhost}>
              <RotateCcw className="w-3 h-3" /> Retry all (last 7 days)
            </button>
          )}
        />
        {failed.length === 0 ? (
          <p className="text-xs text-slate-500 py-3 text-center">Nothing failed.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="text-slate-500 uppercase tracking-wider text-[10px] border-b border-slate-800">
                <tr>
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">To</th>
                  <th className="py-2 pr-3">Message</th>
                  <th className="py-2 pr-3">Error</th>
                  <th className="py-2 text-right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {failed.map((f) => (
                  <tr key={f.id}>
                    <td className="py-2 pr-3 whitespace-nowrap text-slate-400">{fmtDateTime(f.created_at)}</td>
                    <td className="py-2 pr-3">
                      <div className="text-slate-100">{f.user_name}</div>
                      <div className="text-[10px] text-slate-500">{f.channel === 'sms' ? 'Text' : 'Email'} · {f.user_email}</div>
                    </td>
                    <td className="py-2 pr-3">{f.title}</td>
                    <td className="py-2 pr-3 font-mono text-rose-300 max-w-xs truncate" title={f.last_error || ''}>{f.last_error || '—'}</td>
                    <td className="py-2 text-right">
                      <button type="button" disabled={busy === f.id} onClick={() => run(f.id, () => api.post(`/admin/deliveries/${f.id}/retry`))} className={btnGhost}>
                        <RotateCcw className="w-3 h-3" /> Retry
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className={`${card} p-4`}>
          <SectionTitle icon={Mail} title="Send a test email" />
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (to.trim()) run('test', () => api.post('/admin/test-email', { to: to.trim() }));
            }}
          >
            <input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@example.com" className={inputCls} />
            <button type="submit" disabled={busy === 'test' || !to.trim()} className={btnPrimary}>
              <Send className="w-3.5 h-3.5" /> {busy === 'test' ? 'Sending…' : 'Send'}
            </button>
          </form>
          <p className="text-[11px] text-slate-500 mt-2">Uses the same email settings as real notifications, so it proves the whole path works.</p>
        </section>

        <section className={`${card} p-4`}>
          <SectionTitle icon={Database} title="Data" tone="text-slate-400" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Object.entries(sys.table_counts).map(([k, v]) => (
              <div key={k} className="p-2 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{k.replace('_', ' ')}</div>
                <div className="text-sm text-white font-mono font-bold">{v.toLocaleString()}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
