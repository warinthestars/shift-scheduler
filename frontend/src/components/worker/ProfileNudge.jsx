import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserRound, X, ChevronRight } from 'lucide-react';
import api from '../../api/client';

const TEXT = {
  phone: 'mobile number',
  photo: 'photo',
  emergency_contact: 'emergency contact',
  availability: 'weekly availability',
};

/**
 * Phase 31 + 32: a slim "finish your profile" banner on the worker page while something is missing.
 * Hidden for the rest of the visit once dismissed.
 */
export default function ProfileNudge() {
  const [missing, setMissing] = useState([]);
  const [expiring, setExpiring] = useState(0);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .get('/me/profile')
      .then((res) => {
        if (!active) return;
        setMissing(res.data.missing || []);
        setExpiring((res.data.certifications || []).filter((c) => c.expired || c.expiring_soon || c.status === 'rejected').length);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (hidden || (missing.length === 0 && expiring === 0)) return null;
  const parts = missing.map((m) => TEXT[m] || m);
  const text = parts.length
    ? `Add your ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]}.`
    : '';
  const certText = expiring ? `${expiring} certificate${expiring === 1 ? ' needs' : 's need'} attention.` : '';
  const tab = missing.length ? (missing.every((m) => m === 'availability') ? 'availability' : 'about') : 'certificates';

  return (
    <div className="mb-5 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 flex items-center gap-3">
      <UserRound className="w-5 h-5 text-amber-300 flex-shrink-0" />
      <p className="flex-1 min-w-0 text-xs text-amber-100">
        <b className="text-amber-200">Finish your profile.</b> {text} {certText}
        {missing.includes('phone') && ' Managers need a number to reach you.'}
      </p>
      <Link to={`/profile?tab=${tab}`} className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold inline-flex items-center gap-0.5 whitespace-nowrap">
        Open profile <ChevronRight className="w-3.5 h-3.5" />
      </Link>
      <button type="button" aria-label="Hide" onClick={() => setHidden(true)} className="p-1 rounded-lg text-amber-200/70 hover:bg-white/10">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
