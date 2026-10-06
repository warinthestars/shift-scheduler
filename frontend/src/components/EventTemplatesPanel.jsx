import React, { useEffect, useState } from 'react';
import { LayoutTemplate, Plus, Pencil, Trash2, Send, MapPin, Clock, Users, Moon } from 'lucide-react';
import api from '../api/client';
import ShiftEventFormModal from './ShiftEventFormModal';
import { payText } from './PayLabel';

/**
 * Phase 29.3: Venue Settings → Event templates.
 * A venue's reusable event setups: times, where, notes and positions. "Use" opens Post a Shift filled in.
 * Props: venue, onError(msg), onUseTemplate(template) (optional; hidden when not given, e.g. from the admin console)
 */
export default function EventTemplatesPanel({ venue, onError, onUseTemplate }) {
  const [templates, setTemplates] = useState(null);
  const [editing, setEditing] = useState(null);     // null | { template: obj | null }
  const [confirmId, setConfirmId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [flash, setFlash] = useState('');

  const load = async () => {
    try {
      const res = await api.get(`/venues/${venue.id}/event-templates`);
      setTemplates(res.data || []);
    } catch (err) {
      setTemplates([]);
      onError(err.response?.data?.detail || 'Could not load templates.');
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue.id]);

  const remove = async (tpl) => {
    setBusyId(tpl.id);
    try {
      await api.delete(`/venues/${venue.id}/event-templates/${tpl.id}`);
      setConfirmId(null);
      setFlash(`Deleted “${tpl.name}”.`);
      load();
    } catch (err) {
      onError(err.response?.data?.detail || 'Could not delete the template.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <p className="text-xs text-slate-400 max-w-xl">
          Save the events you run again and again: the name, times, where, notes and shifts with pay. When you post an
          event, pick a template, choose the date, and publish (or save it as a draft). You can also save any posted event
          as a template from its ⋯ menu.
        </p>
        <button type="button" onClick={() => setEditing({ template: null })}
          className="px-3.5 py-2 rounded-xl bg-brand-500 hover:bg-brand-400 text-slate-950 text-xs font-bold inline-flex items-center gap-1.5 flex-shrink-0 self-start">
          <Plus className="w-4 h-4" /> New template
        </button>
      </div>

      {flash && (
        <div className="p-2.5 rounded-xl bg-emerald-950/60 border border-emerald-700 text-emerald-200 text-xs flex justify-between gap-2">
          <span>{flash}</span>
          <button type="button" onClick={() => setFlash('')} className="underline">Dismiss</button>
        </div>
      )}

      {templates === null ? (
        <p className="text-xs text-slate-500">Loading…</p>
      ) : templates.length === 0 ? (
        <div className="text-center py-10 rounded-xl border border-dashed border-slate-700 bg-slate-950/50">
          <LayoutTemplate className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <p className="text-sm text-slate-300 font-semibold">No templates yet</p>
          <p className="text-xs text-slate-500 mt-1">Create one here, or open a posted event's ⋯ menu and choose “Save as template”.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {templates.map((t) => {
            const spots = t.positions.reduce((n, p) => n + (p.capacity || 0), 0);
            return (
              <div key={t.id} className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-white truncate">{t.name}</div>
                    {t.title !== t.name && <div className="text-[11px] text-slate-400 truncate">Posts as “{t.title}”</div>}
                  </div>
                  <LayoutTemplate className="w-4 h-4 text-indigo-300 flex-shrink-0" />
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {t.start_local}–{t.end_local}
                    {t.overnight && <Moon className="w-3 h-3 text-indigo-300" title="Ends the next day" />}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {t.location ? (
                      <span className={t.location.is_archived ? 'text-amber-300' : 'text-emerald-300'}>
                        {t.location.name}{t.location.is_archived ? ' (archived)' : ''}
                      </span>
                    ) : 'Venue address'}
                  </span>
                  <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" /> {spots} spot{spots === 1 ? '' : 's'}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {t.positions.map((p, i) => (
                    <span key={`${p.role_type}-${i}`} className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 text-[10px] font-semibold">
                      {p.capacity}× {p.role_type} · {payText(p.hourly_rate, p.hourly_rate_max)}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-1.5 mt-auto pt-1">
                  {onUseTemplate && (
                    <button type="button" onClick={() => onUseTemplate(t)}
                      className="px-3 py-1.5 rounded-lg bg-brand-500 hover:bg-brand-400 text-slate-950 text-xs font-bold inline-flex items-center gap-1">
                      <Send className="w-3 h-3" /> Use
                    </button>
                  )}
                  <button type="button" onClick={() => setEditing({ template: t })}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold inline-flex items-center gap-1">
                    <Pencil className="w-3 h-3" /> Edit
                  </button>
                  {confirmId === t.id ? (
                    <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-rose-200">
                      Delete?
                      <button type="button" disabled={busyId === t.id} onClick={() => remove(t)}
                        className="px-2 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold disabled:opacity-50">Yes</button>
                      <button type="button" onClick={() => setConfirmId(null)}
                        className="px-2 py-1 rounded-lg bg-slate-800 text-slate-300">No</button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setConfirmId(t.id)} title="Delete template"
                      className="ml-auto p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <ShiftEventFormModal
          mode="template"
          venue={venue}
          template={editing.template}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            setFlash(`Saved “${saved.name}”.`);
            load();
          }}
        />
      )}
    </div>
  );
}
