import api from '../api/client';

/**
 * Phase 33.1: download a file from the API (with the sign-in token) and save it.
 * Uses the server's file name from Content-Disposition when there is one.
 */
export async function downloadFile(url, params = {}, fallbackName = 'download.csv') {
  const res = await api.get(url, { params, responseType: 'blob' });
  const header = res.headers?.['content-disposition'] || '';
  const match = /filename="?([^";]+)"?/i.exec(header);
  const name = match ? match[1] : fallbackName;
  const blob = new Blob([res.data], { type: res.headers?.['content-type'] || 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = window.URL.createObjectURL(blob);
  link.setAttribute('download', name);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(link.href);
  return name;
}

/** Phase 33.1: "YYYY-MM-DD" for a local date. */
export const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Phase 33.1: date ranges for downloads (weeks start on Monday, like Hours & pay). */
export function rangePresets(today = new Date()) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const addDays = (x, n) => { const y = new Date(x); y.setDate(x.getDate() + n); return y; };
  const firstOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  const lastMonthEnd = addDays(firstOfMonth, -1);
  return [
    { id: 'week', label: 'This week', start: isoDay(monday), end: isoDay(addDays(monday, 6)) },
    { id: 'last_week', label: 'Last week', start: isoDay(addDays(monday, -7)), end: isoDay(addDays(monday, -1)) },
    { id: 'month', label: 'This month', start: isoDay(firstOfMonth), end: isoDay(new Date(d.getFullYear(), d.getMonth() + 1, 0)) },
    { id: 'last_month', label: 'Last month', start: isoDay(new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1)), end: isoDay(lastMonthEnd) },
    { id: 'all', label: 'Everything', start: null, end: null },
  ];
}
