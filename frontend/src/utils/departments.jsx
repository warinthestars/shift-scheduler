/**
 * Phase 32.2: departments. Keys match backend/src/services/departments.py DEPARTMENTS.
 */
export const DEPARTMENTS = [
  { key: 'foh', label: 'Front of House', short: 'FOH', examples: 'Server, host, runner, busser', cls: 'bg-sky-500/10 text-sky-300 border-sky-500/30' },
  { key: 'bar', label: 'Bar', short: 'Bar', examples: 'Bartender, barback', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
  { key: 'kitchen', label: 'Kitchen / BOH', short: 'Kitchen', examples: 'Cook, prep, dishwasher', cls: 'bg-orange-500/10 text-orange-300 border-orange-500/30' },
  { key: 'tech', label: 'Tech & Production', short: 'Tech', examples: 'AV, audio, lighting, stagehand', cls: 'bg-violet-500/10 text-violet-300 border-violet-500/30' },
  { key: 'security', label: 'Security', short: 'Security', examples: 'Door, security, bag check', cls: 'bg-rose-500/10 text-rose-300 border-rose-500/30' },
  { key: 'ops', label: 'Event Setup & Ops', short: 'Setup & Ops', examples: 'Load-in, setup, coat check, event staff', cls: 'bg-teal-500/10 text-teal-300 border-teal-500/30' },
  { key: 'general', label: 'General', short: 'General', examples: 'Open to anyone', cls: 'bg-slate-700/40 text-slate-300 border-slate-600' },
];
export const WORKER_DEPARTMENTS = DEPARTMENTS.filter((d) => d.key !== 'general');
export const deptOf = (key) => DEPARTMENTS.find((d) => d.key === key) || DEPARTMENTS[DEPARTMENTS.length - 1];

export function DeptChip({ dept, className = '' }) {
  const d = deptOf(dept);
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border whitespace-nowrap ${d.cls} ${className}`}>{d.short}</span>
  );
}
