import React, { useState } from 'react';
import { BadgeCheck, ShieldAlert, Clock3, Paperclip, FileText, Trash2, Pencil, Plus, Save, X, Award } from 'lucide-react';
import api from '../../api/client';
import ConfirmDialog from '../ConfirmDialog';
import { uploadFile, openProtectedFile } from '../../utils/files';
import { fmtDay } from '../../utils/availability';

const inputCls = 'mt-1 w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500';

export function certState(c) {
  if (!c) return ['Not added', 'bg-slate-800 text-slate-400 border-slate-700', null];
  if (c.status === 'rejected') return ['Not accepted', 'bg-rose-500/10 text-rose-300 border-rose-500/30', ShieldAlert];
  if (c.expired) return ['Expired', 'bg-rose-500/10 text-rose-300 border-rose-500/30', ShieldAlert];
  if (c.expiring_soon) return ['Expires soon', 'bg-amber-500/10 text-amber-300 border-amber-500/30', Clock3];
  if (c.status === 'verified') return ['Verified', 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30', BadgeCheck];
  return ['Added · not verified yet', 'bg-sky-500/10 text-sky-300 border-sky-500/30', null];
}

/**
 * Phase 32: The worker's certificates. Some venue positions need one (e.g. Bartender needs an
 * alcohol server card); requests for those positions are blocked until it's here and in date.
 * Changing a certificate sends it back to "not verified".
 * Props: certifications (CertificationItem[]), types (CertTypeInfo[]), onChanged(message), onError(message)
 */
export default function CertificatesPanel({ certifications = [], types = [], onChanged, onError }) {
  const [editing, setEditing] = useState(null);   // cert type key
  const [confirm, setConfirm] = useState(null);
  const byType = Object.fromEntries(certifications.map((c) => [c.cert_type, c]));

  const askDelete = (t) => setConfirm({
    title: `Remove your ${t.label.toLowerCase()}?`,
    message: 'Shifts that need it will be locked for you until you add it again.',
    confirmLabel: 'Remove',
    danger: true,
    onConfirm: async () => {
      await api.delete(`/me/certifications/${t.key}`);
      onChanged('Removed.');
    },
  });

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400 bg-slate-900/60 border border-slate-800 rounded-xl p-3 flex gap-2">
        <Award className="w-4 h-4 flex-shrink-0 text-slate-500" />
        <span>
          Some positions need a certificate, like an alcohol server card for bartending. Add yours with the expiry date and a
          photo or PDF of the card. A manager checks it and marks it verified. You'll get a reminder 30 days before one expires.
        </span>
      </p>
      {types.map((t) => {
        const c = byType[t.key];
        const [label, cls, Icon] = certState(c);
        return (
          <div key={t.key} className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
            <div className="flex flex-col sm:flex-row sm:items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-white">{t.label}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border inline-flex items-center gap-1 ${cls}`}>
                    {Icon && <Icon className="w-3 h-3" />} {label}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">{t.hint}</p>
                {c && (
                  <p className="text-xs text-slate-300 mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                    {c.number && <span>No. {c.number}</span>}
                    {c.expires_on && <span className={c.expired ? 'text-rose-300' : ''}>Expires {fmtDay(c.expires_on)}</span>}
                    {c.status === 'verified' && c.verified_by_name && (
                      <span className="text-emerald-300">Checked by {c.verified_venue_name || c.verified_by_name}</span>
                    )}
                    {c.file_id && (
                      <button type="button" onClick={() => openProtectedFile(c.file_id).catch(() => onError('Could not open the file.'))}
                        className="text-sky-300 hover:underline inline-flex items-center gap-0.5">
                        <FileText className="w-3 h-3" /> View file
                      </button>
                    )}
                  </p>
                )}
                {c?.status === 'rejected' && c.review_note && (
                  <p className="text-xs text-rose-200 bg-rose-500/5 border border-rose-500/30 rounded-lg px-2 py-1 mt-1.5">
                    {c.verified_venue_name || 'A manager'}: “{c.review_note}”. Update it and it goes back for checking.
                  </p>
                )}
              </div>
              {editing !== t.key && (
                <div className="flex gap-2">
                  <button type="button" onClick={() => setEditing(t.key)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold inline-flex items-center gap-1">
                    {c ? <Pencil className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />} {c ? 'Update' : 'Add'}
                  </button>
                  {c && (
                    <button type="button" onClick={() => askDelete(t)} aria-label={`Remove ${t.label}`}
                      className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-rose-300 hover:border-rose-500/40">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
            {editing === t.key && (
              <CertForm type={t} cert={c} onCancel={() => setEditing(null)} onError={onError}
                onSaved={(msg) => { setEditing(null); onChanged(msg); }} />
            )}
          </div>
        );
      })}
      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}

function CertForm({ type, cert, onCancel, onSaved, onError }) {
  const [number, setNumber] = useState(cert?.number || '');
  const [issued, setIssued] = useState(cert?.issued_on || '');
  const [expires, setExpires] = useState(cert?.expires_on || '');
  const [fileId, setFileId] = useState(cert?.file_id || null);
  const [fileName, setFileName] = useState(cert?.file_id ? 'Current file' : '');
  const [busy, setBusy] = useState(false);

  const attach = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    try {
      const res = await uploadFile('/me/files', f);
      setFileId(res.data.id);
      setFileName(f.name);
    } catch (err) {
      onError(err.response?.data?.detail || 'Could not upload that file.');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/me/certifications/${type.key}`, {
        number: number.trim() || null,
        issued_on: type.expires ? issued || null : null,
        expires_on: type.expires ? expires || null : null,
        file_id: fileId,
        remove_file: !fileId,
      });
      onSaved(`${type.label} saved. A manager will check it.`);
    } catch (err) {
      onError(err.response?.data?.detail || 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-slate-800 space-y-3">
      {type.expires ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block text-xs font-semibold text-slate-300">Card / certificate number
            <input value={number} onChange={(e) => setNumber(e.target.value)} className={inputCls} />
          </label>
          <label className="block text-xs font-semibold text-slate-300">Issued (optional)
            <input type="date" value={issued} onChange={(e) => setIssued(e.target.value)} className={inputCls} />
          </label>
          <label className="block text-xs font-semibold text-slate-300">Expires <span className="text-rose-300">(required)</span>
            <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className={inputCls} />
          </label>
        </div>
      ) : (
        <p className="text-xs text-slate-400">Bring your ID to your first shift. A manager checks it and marks this verified. Nothing to fill in.</p>
      )}
      {type.expires && (
        <div className="flex flex-wrap items-center gap-2">
          <label className={`px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
            <Paperclip className="w-3.5 h-3.5" /> {fileId ? 'Replace photo / PDF' : 'Attach a photo or PDF'}
            <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={attach} />
          </label>
          {fileId && (
            <span className="text-xs text-slate-300 inline-flex items-center gap-1">
              <FileText className="w-3.5 h-3.5 text-sky-300" /> {fileName}
              <button type="button" aria-label="Remove file" onClick={() => { setFileId(null); setFileName(''); }} className="text-slate-500 hover:text-rose-300">
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          )}
          <span className="text-[11px] text-slate-500">Max 5 MB. Only you and managers you work with can open it.</span>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300 hover:bg-slate-700">Cancel</button>
        <button type="button" onClick={save} disabled={busy || (type.expires && !expires)}
          className="px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50">
          <Save className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
