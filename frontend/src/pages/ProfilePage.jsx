import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UserRound, CalendarDays, CalendarOff, Award, Bell, Check, AlertCircle, X, CircleDot } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Avatar } from '../components/WorkerProfilePanel';
import AboutSection from '../components/profile/AboutSection';
import AvailabilityEditor from '../components/profile/AvailabilityEditor';
import TimeOffPanel from '../components/profile/TimeOffPanel';
import CertificatesPanel from '../components/profile/CertificatesPanel';
import NotificationSettingsModal from '../components/NotificationSettingsModal';

const MISSING_TEXT = {
  phone: ['Add your mobile number', 'about'],
  photo: ['Add a profile photo', 'about'],
  emergency_contact: ['Add an emergency contact', 'about'],
  availability: ['Set your weekly availability', 'availability'],
};

/**
 * Phase 31 + 32: The signed-in person's profile.
 * Tabs (?tab=): about · availability · time-off · certificates · notifications. Workers see all of them;
 * managers and admins see About and Notifications.
 */
export default function ProfilePage() {
  const { refreshProfile } = useAuth();
  const [params, setParams] = useSearchParams();
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);   // { type, text }
  const [showNotif, setShowNotif] = useState(false);

  const load = async () => {
    try {
      const res = await api.get('/me/profile');
      setProfile(res.data);
      setError('');
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not load your profile.');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const isWorker = profile?.role === 'worker';
  const tabs = [
    { id: 'about', label: 'About me', icon: UserRound },
    isWorker && { id: 'availability', label: 'Availability', icon: CalendarDays },
    isWorker && { id: 'time-off', label: 'Time off', icon: CalendarOff, badge: (profile?.time_off || []).filter((t) => t.status === 'pending').length },
    isWorker && { id: 'certificates', label: 'Certificates', icon: Award, badge: (profile?.certifications || []).filter((c) => c.expired || c.status === 'rejected').length },
    { id: 'notifications', label: 'Notifications', icon: Bell },
  ].filter(Boolean);
  const requested = params.get('tab');
  const tab = tabs.some((t) => t.id === requested) ? requested : 'about';
  const setTab = (id) => {
    const next = new URLSearchParams(params);
    next.set('tab', id);
    setParams(next, { replace: true });
    if (id === 'notifications') setShowNotif(true);
  };

  useEffect(() => {
    if (tab === 'notifications') setShowNotif(true);
  }, [tab]);

  const ok = (text) => setNotice({ type: 'success', text });
  const fail = (text) => setNotice({ type: 'error', text });
  const afterSave = (next, text) => {
    setProfile(next);
    ok(text);
    refreshProfile?.();
  };
  const reload = async (text) => {
    await load();
    if (text) ok(text);
  };

  if (error) {
    return <div className="w-full min-h-screen bg-slate-950 text-rose-300 p-8 text-center text-sm">{error}</div>;
  }
  if (!profile) {
    return <div className="w-full min-h-screen bg-slate-950 text-slate-500 p-8 text-center text-sm">Loading your profile…</div>;
  }

  const name = `${profile.first_name} ${profile.last_name}`.trim() || profile.email;

  return (
    <div className="w-full min-h-screen bg-slate-950 text-slate-100 pb-16">
      <section className="w-full bg-slate-900 border-b border-slate-800 py-6">
        <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row sm:items-center gap-4">
          <Avatar person={profile} size="w-14 h-14 text-lg" />
          <div className="flex-1 min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-white truncate">{name}</h1>
            <p className="text-xs text-slate-400">{profile.email}</p>
          </div>
          {profile.missing.length > 0 && (
            <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/30 text-xs space-y-1">
              <p className="font-bold text-amber-200">Finish your profile</p>
              {profile.missing.map((m) => (
                <button key={m} type="button" onClick={() => setTab(MISSING_TEXT[m]?.[1] || 'about')}
                  className="flex items-center gap-1.5 text-amber-100/80 hover:text-white">
                  <CircleDot className="w-3 h-3 text-amber-400" /> {MISSING_TEXT[m]?.[0] || m}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <main className="w-full max-w-4xl mx-auto px-4 sm:px-6 mt-6 space-y-5">
        <nav className="grid grid-cols-2 sm:flex sm:flex-wrap gap-1 p-1 bg-slate-900 border border-slate-800 rounded-2xl" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={`px-3 py-2 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 transition ${
                tab === t.id ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}>
              <t.icon className="w-4 h-4" /> {t.label}
              {t.badge > 0 && <span className="px-1.5 rounded-full bg-amber-500 text-slate-950 text-[10px]">{t.badge}</span>}
            </button>
          ))}
        </nav>

        {notice && (
          <div className={`p-3 rounded-xl border flex items-start justify-between gap-3 text-sm ${
            notice.type === 'success' ? 'bg-emerald-950/80 border-emerald-700 text-emerald-200' : 'bg-rose-950/80 border-rose-700 text-rose-200'}`}>
            <span className="flex items-start gap-2">
              {notice.type === 'success' ? <Check className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
              {notice.text}
            </span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="p-0.5 rounded hover:bg-white/10"><X className="w-4 h-4" /></button>
          </div>
        )}

        {tab === 'about' && <AboutSection profile={profile} onSaved={afterSave} onError={fail} />}
        {tab === 'availability' && (
          <AvailabilityEditor windows={profile.availability} onError={fail}
            onSaved={(windows, text) => { setProfile((p) => ({ ...p, availability: windows, missing: windows.length ? p.missing.filter((m) => m !== 'availability') : [...new Set([...p.missing, 'availability'])] })); ok(text); }} />
        )}
        {tab === 'time-off' && <TimeOffPanel items={profile.time_off} onChanged={reload} onError={fail} />}
        {tab === 'certificates' && (
          <CertificatesPanel certifications={profile.certifications} types={profile.cert_types} onChanged={reload} onError={fail} />
        )}
        {tab === 'notifications' && (
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-2">
            <p className="text-sm text-slate-300">Choose what gets emailed or texted to you, quiet hours, and who can find you.</p>
            <button type="button" onClick={() => setShowNotif(true)}
              className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold inline-flex items-center gap-1.5">
              <Bell className="w-4 h-4" /> Notification settings
            </button>
          </div>
        )}
      </main>

      {showNotif && <NotificationSettingsModal onClose={() => { setShowNotif(false); load(); }} />}
    </div>
  );
}
