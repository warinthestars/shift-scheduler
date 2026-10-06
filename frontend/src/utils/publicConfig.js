import api from '../api/client';

/**
 * Phase 36: settings the web app needs before anyone signs in (GET /api/public/config, no token needed).
 *   public_board       true = the home page is the public board of posted shifts
 *   self_registration  true = people can create their own worker account
 * Asked once per page load and remembered. If the server can't be reached, the board is treated as off,
 * so the home page falls back to the sign-in page.
 */
const OFF = { public_board: false, self_registration: false };
let pending = null;

export function getPublicConfig() {
  if (!pending) {
    pending = api
      .get('/public/config')
      .then((res) => ({ ...OFF, ...(res.data || {}) }))
      .catch(() => {
        pending = null;          // try again next time
        return OFF;
      });
  }
  return pending;
}

/** The event someone tapped on the public board; the worker dashboard opens it after they sign in. */
const KEY = 'shiftboard_public_event';

export function rememberPublicEvent(eventId) {
  try {
    if (eventId) sessionStorage.setItem(KEY, String(eventId));
  } catch (e) { /* private mode: they just land on the dashboard */ }
}

export function takePublicEvent() {
  try {
    const id = sessionStorage.getItem(KEY);
    if (id) sessionStorage.removeItem(KEY);
    return id || null;
  } catch (e) {
    return null;
  }
}
