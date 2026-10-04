/*
 * Phase 33: ShiftBoard service worker.
 * - Shows Web Push notifications and opens the right page when one is tapped.
 * - Keeps a tiny offline page for when the phone has no signal.
 * - It NEVER caches the app code or API calls (the dev server serves fresh code on every load),
 *   so an update can't get stuck behind a stale cache.
 * Bump CACHE when offline.html or the icons change.
 */
const CACHE = 'shiftboard-shell-v1';
// Phase 33.0.1: messages arrive either straight from ShiftBoard (Web Push) or through Firebase Cloud Messaging.
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL, '/icons/icon-192.png']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// Only page loads go through here: online = the network, offline = the offline page.
// cache: 'no-store' so a page is never half-loaded from the browser cache while the app code can't load.
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(() => caches.match(OFFLINE_URL)));
});

self.addEventListener('push', (event) => {
  let raw = {};
  try {
    raw = event.data ? event.data.json() : {};
  } catch (e) {
    raw = { title: 'ShiftBoard', body: event.data ? event.data.text() : '' };
  }
  // Firebase wraps our fields: { data: { title, body, url, tag, urgent: "true" }, from, fcmMessageId, ... }
  const data = raw && raw.data && typeof raw.data === 'object' && !raw.title ? raw.data : raw;
  const urgent = data.urgent === true || data.urgent === 'true';
  event.waitUntil(
    self.registration.showNotification(data.title || 'ShiftBoard', {
      body: data.body || '',
      tag: data.tag || undefined,
      renotify: Boolean(data.tag) && urgent,
      requireInteraction: urgent,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        if ('navigate' in client) return client.navigate(url);
        return undefined;
      }
    }
    return self.clients.openWindow(url);
  })());
});
