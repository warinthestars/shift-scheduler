/** Phase 33.1: formatting for Hours & pay. */
export const money = (n) =>
  `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** 0 -> "0 h", 1.5 -> "1.5 h", 12.25 -> "12.25 h" */
export const hoursText = (h) => {
  const v = Math.round(Number(h || 0) * 100) / 100;
  return `${v} h`;
};

/** "2026-09-28" -> "Mon, Sep 28" (a plain date; noon avoids any time-zone shift) */
export const dayText = (iso) => {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
};

export const PERIODS = [
  { id: 'week', label: 'This week' },
  { id: 'last_week', label: 'Last week' },
  { id: 'month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
];
