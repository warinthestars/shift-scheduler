import api from '../api/client';

/**
 * Phase 33.1: plain-language errors everywhere, from ONE place.
 * Adds a second response handler to the shared API client (client.js itself is unchanged) that rewrites
 * what screens read (`err.response.data.detail` and `err.message`) before any screen sees it:
 *   * 500-level errors: the server's technical text is removed, so each screen's own friendly
 *     fallback ("Could not save your profile.") shows instead. The original stays in `raw_detail`.
 *   * 422 (form checks): the list of field problems becomes one readable sentence.
 *   * No response (offline / server unreachable): a clear "check your connection" message.
 * Installed once from main.jsx.
 */
const FIELD_NAMES = {
  email: 'email address',
  phone: 'mobile number',
  first_name: 'first name',
  last_name: 'last name',
  password: 'password',
  content: 'message',
  note: 'note',
  reason: 'reason',
  name: 'name',
  title: 'title',
  start_time: 'start time',
  end_time: 'end time',
  hourly_rate: 'pay rate',
  capacity: 'number of spots',
};

function fieldName(loc) {
  const key = Array.isArray(loc) ? [...loc].reverse().find((p) => typeof p === 'string' && p !== 'body' && p !== 'query') : null;
  return key ? (FIELD_NAMES[key] || key.replace(/_/g, ' ')) : null;
}

export function friendly422(detail) {
  const first = Array.isArray(detail) ? detail[0] : null;
  if (!first) return 'Please check what you entered and try again.';
  const field = fieldName(first.loc);
  const type = String(first.type || '');
  const limit = first.ctx && (first.ctx.max_length ?? first.ctx.le ?? first.ctx.lt);
  if (['latitude', 'longitude', 'accuracy m'].includes(field)) {   // Phase 34.5: clock-in coordinates the server refused
    return "Your phone sent a location we can't use. Turn location off and on again, then try again.";
  }
  if (type === 'finite_number') return 'Please check the numbers you entered.';   // Phase 34.5: NaN / Infinity refused
  if (type === 'missing') return field ? `Please fill in the ${field}.` : 'Please fill in every required field.';
  if (field === 'email address' || type.includes('email')) return 'Please enter a valid email address.';
  if (type.includes('too_long')) return field ? `The ${field} is too long${limit ? ` (up to ${limit} characters)` : ''}.` : "That's too long.";
  if (type.includes('too_short')) return field ? `The ${field} is too short.` : "That's too short.";
  if (type.includes('greater_than') || type.includes('less_than')) return field ? `Please check the ${field}.` : 'Please check the numbers you entered.';
  if (type.includes('date') || type.includes('datetime')) return field ? `Please enter a valid ${field}.` : 'Please enter a valid date.';
  return field ? `Please check the ${field}.` : 'Please check what you entered and try again.';
}

let installed = false;

export function installFriendlyErrors() {
  if (installed) return;
  installed = true;
  api.interceptors.response.use(
    (response) => response,
    (error) => {
      try {
        const res = error && error.response;
        if (!res) {
          if (error && error.code !== 'ERR_CANCELED') {
            error.message = typeof navigator !== 'undefined' && navigator.onLine === false
              ? "You're offline. Check your connection and try again."
              : "Can't reach ShiftUp right now. Check your connection and try again.";
          }
        } else if (res.status >= 500) {
          if (res.data && typeof res.data === 'object' && !(res.data instanceof Blob)) {
            res.data.raw_detail = res.data.detail;
            delete res.data.detail;
          }
          error.message = 'Something went wrong on our end. Please try again in a moment.';
          console.warn('Server error', res.status, res.data && res.data.raw_detail);
        } else if (res.status === 422 && res.data && Array.isArray(res.data.detail)) {
          res.data.raw_detail = res.data.detail;
          res.data.detail = friendly422(res.data.detail);
          error.message = res.data.detail;
        } else if (res.data && typeof res.data.detail === 'string') {
          error.message = res.data.detail;
        }
      } catch (e) {
        /* never let error handling throw */
      }
      return Promise.reject(error);
    },
  );
}
