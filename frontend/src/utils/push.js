import { initializeApp, getApp } from 'firebase/app';
import { getMessaging, getToken, deleteToken, isSupported as messagingSupported } from 'firebase/messaging';
import api from '../api/client';

/**
 * Phase 33: the installed app (PWA) and Web Push on THIS device.
 * Phase 33.0.1: when the server has Firebase messaging set up (GET /notifications/push -> provider 'fcm'),
 * devices register a Firebase token instead; otherwise ShiftBoard's own Web Push is used. Either way the
 * messages land in public/sw.js.
 * Nothing here throws at import time; every helper is safe on browsers without push.
 */
const FCM_APP = 'shiftboard-messaging';
const FCM_TOKEN_KEY = 'shiftboard_fcm_token';

function fcmApp(config) {
  try {
    return getApp(FCM_APP);
  } catch (e) {
    return initializeApp(config, FCM_APP);
  }
}

function storedToken() {
  try { return localStorage.getItem(FCM_TOKEN_KEY); } catch (e) { return null; }
}

function storeToken(token) {
  try {
    if (token) localStorage.setItem(FCM_TOKEN_KEY, token);
    else localStorage.removeItem(FCM_TOKEN_KEY);
  } catch (e) { /* private mode */ }
}

export const isStandalone = () =>
  (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
  || (typeof navigator !== 'undefined' && navigator.standalone === true);

export const isIOS = () =>
  typeof navigator !== 'undefined'
  && (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** 'unsupported' | 'needs_install' (iPhone / iPad outside the home-screen app) | 'denied' | 'default' | 'granted' */
export function permissionState() {
  if (isIOS() && !isStandalone()) return 'needs_install';
  if (!pushSupported()) return 'unsupported';
  return Notification.permission;
}

export function deviceLabel() {
  const ua = navigator.userAgent || '';
  const device = /iphone/i.test(ua) ? 'iPhone'
    : /ipad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad'
    : /android/i.test(ua) ? 'Android'
    : /mac os/i.test(ua) ? 'Mac'
    : /windows/i.test(ua) ? 'Windows'
    : 'Computer';
  const browser = /edg\//i.test(ua) ? 'Edge' : /firefox|fxios/i.test(ua) ? 'Firefox'
    : /crios|chrome/i.test(ua) ? 'Chrome' : /safari/i.test(ua) ? 'Safari' : '';
  const app = isStandalone() ? 'app' : browser;
  return app ? `${device} · ${app}` : device;
}

function keyBytes(base64url) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function sameKey(sub, publicKey) {
  try {
    const a = new Uint8Array(sub.options.applicationServerKey);
    const b = keyBytes(publicKey);
    return a.length === b.length && a.every((v, i) => v === b[i]);
  } catch (e) {
    return true;   // browser doesn't expose it: assume it's fine
  }
}

/** The service worker registration, or null after `ms` (e.g. not served over https). */
export async function swRegistration(ms = 4000) {
  if (!('serviceWorker' in navigator)) return null;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await swRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

async function saveSubscription(sub) {
  const json = sub.toJSON();
  const res = await api.post('/notifications/push/subscribe', {
    provider: 'webpush',
    endpoint: json.endpoint,
    keys: json.keys,
    device_label: deviceLabel(),
  });
  return res.data;   // { public_key, devices, provider, ... }
}

/** Phase 33.0.1: register this device with Firebase. Falls back to Web Push if this browser can't use Firebase messaging. */
async function subscribeFcm(reg, cfg) {
  if (!(await messagingSupported().catch(() => false))) {
    return saveSubscription(await subscribeFresh(reg, cfg.public_key));
  }
  // A subscription made with ShiftBoard's own key would block Firebase's: remove it first.
  const existing = await reg.pushManager.getSubscription();
  if (existing && !sameKey(existing, cfg.fcm_vapid_key)) {
    await api.post('/notifications/push/unsubscribe', { endpoint: existing.endpoint }).catch(() => {});
    await existing.unsubscribe().catch(() => {});
  }
  const token = await getToken(getMessaging(fcmApp(cfg.fcm_config)), {
    vapidKey: cfg.fcm_vapid_key,
    serviceWorkerRegistration: reg,
  });
  if (!token) throw new Error("Couldn't turn on notifications on this device. Try again.");
  const old = storedToken();
  if (old && old !== token) await api.post('/notifications/push/unsubscribe', { endpoint: old }).catch(() => {});
  const res = await api.post('/notifications/push/subscribe', { provider: 'fcm', token, device_label: deviceLabel() });
  storeToken(token);
  return res.data;
}

async function subscribeFresh(reg, publicKey) {
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, publicKey)) {   // the server's key changed (e.g. after a database wipe)
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  }
  return sub;
}

/** Ask permission (must be called from a tap), subscribe this device and save it. Returns { public_key, devices }. */
export async function enablePush() {
  const state = permissionState();
  if (state === 'needs_install') throw new Error('Add ShiftBoard to your Home Screen first, then open it from there.');
  if (state === 'unsupported') throw new Error("This browser can't show notifications.");
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? 'Notifications are blocked for ShiftBoard. Allow them in your browser or phone settings.'
      : 'Notifications were not turned on.');
  }
  const reg = await swRegistration();
  if (!reg) throw new Error('Open ShiftBoard from its usual web address (https://…) to turn on notifications.');
  const { data } = await api.get('/notifications/push');
  if (data.provider === 'fcm') return subscribeFcm(reg, data);          // Phase 33.0.1
  const sub = await subscribeFresh(reg, data.public_key);
  return saveSubscription(sub);
}

/** Turn off this device (server + browser). Never throws. */
export async function disablePush() {
  try {
    const token = storedToken();                                          // Phase 33.0.1: Firebase device
    if (token) {
      await api.post('/notifications/push/unsubscribe', { endpoint: token }).catch(() => {});
      try {
        await deleteToken(getMessaging(getApp(FCM_APP)));
      } catch (e) { /* app not started on this page load: unsubscribing below is enough */ }
      storeToken(null);
    }
    const sub = await currentSubscription();
    if (!sub) return;
    await api.post('/notifications/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  } catch (e) {
    /* nothing to undo */
  }
}

/** On app start: if this device already allowed notifications, make sure the server has it (and the right key). */
export async function syncPush() {
  try {
    if (permissionState() !== 'granted') return;
    const reg = await swRegistration();
    if (!reg) return;
    const existing = await reg.pushManager.getSubscription();
    if (!existing) return;                       // they never turned it on here (or turned it off)
    const { data } = await api.get('/notifications/push');
    // Phase 33.0.1: follows the server's route, so devices move to Firebase once it's set up (and back if it's removed)
    if (data.provider === 'fcm') {
      await subscribeFcm(reg, data);
    } else {
      if (storedToken()) {
        await api.post('/notifications/push/unsubscribe', { endpoint: storedToken() }).catch(() => {});
        storeToken(null);
      }
      await saveSubscription(await subscribeFresh(reg, data.public_key));
    }
  } catch (e) {
    /* best effort */
  }
}

export async function sendTestPush() {
  const res = await api.post('/notifications/push/test');
  return res.data;   // { reached, error }
}

// ---- Install ("Add to Home Screen") -----------------------------------------------------------
// Chrome / Edge / Android fire `beforeinstallprompt` once, early. Keep it so a button can use it later.
let deferredInstall = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    window.dispatchEvent(new Event('shiftboard_install_ready'));
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    window.dispatchEvent(new Event('shiftboard_install_ready'));
  });
}

export const canPromptInstall = () => Boolean(deferredInstall);

/** Shows the browser's install dialog. Returns true if they installed. */
export async function promptInstall() {
  if (!deferredInstall) return false;
  const e = deferredInstall;
  deferredInstall = null;
  e.prompt();
  const choice = await e.userChoice.catch(() => null);
  window.dispatchEvent(new Event('shiftboard_install_ready'));
  return choice?.outcome === 'accepted';
}

/** Register the service worker (called once from main.jsx). */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const secure = window.isSecureContext;   // https, or localhost
  if (!secure) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('Service worker not registered:', err));
  });
}
