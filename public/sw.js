const CACHE_NAME = "freixo-crm-shell-v5";
const STATIC_ASSETS = [
  "/manifest.webmanifest",
  "/freixo-app-icon-v2-192.png",
  "/freixo-app-icon-v2-512.png",
  "/freixo-app-icon-v2-maskable-192.png",
  "/freixo-app-icon-v2-maskable-512.png",
  "/freixo-apple-touch-icon-v2.png",
  "/freixo-favicon-v2-32.png",
  "/freixo-crm-cover.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate" || url.pathname.startsWith("/auth") || url.pathname.startsWith("/api")) return;
  if (!STATIC_ASSETS.includes(url.pathname)) return;
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
    return response;
  })));
});

// A persistent account marker prevents notifications leaking across logouts on shared devices.
function notificationAccount(value, write = false) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('freixo-notification-device', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('settings');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('settings', write ? 'readwrite' : 'readonly');
      const op = write ? tx.objectStore('settings').put(value, 'user') : tx.objectStore('settings').get('user');
      op.onsuccess = () => resolve(op.result);
      op.onerror = () => reject(op.error);
      tx.oncomplete = () => db.close();
    };
  });
}
self.addEventListener('message', event => {
  if (event.data?.type === 'notification-user') event.waitUntil(notificationAccount(event.data.userId, true));
});
function safeNotificationUrl(href) {
  const url = new URL(href, self.location.origin);
  return url.origin === self.location.origin && ['/tarefas', '/agenda'].includes(url.pathname) ? url.href : self.location.origin + '/dashboard';
}
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let data; try { data = event.data?.json(); } catch { return; }
    if (!data || !data.userId || Date.parse(data.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(data.expiresAt))) return;
    if (await notificationAccount() !== data.userId) return;
    await self.registration.showNotification(data.title, { body: data.body, icon: '/freixo-app-icon-v2-192.png', badge: '/freixo-favicon-v2-32.png', tag: data.tag, data: { href: safeNotificationUrl(data.href), userId: data.userId } });
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    if (await notificationAccount() !== event.notification.data?.userId) return;
    const url = safeNotificationUrl(event.notification.data?.href);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.navigate(url); await existing.focus(); }
    else await self.clients.openWindow(url);
  })());
});
