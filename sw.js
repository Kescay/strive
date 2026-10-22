// Service worker: shows the demo notifications the page schedules, and opens
// the right zone when one is tapped. A real version would also handle `push`
// events sent from a server.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// The page posts { type: 'schedule', delay, title, body, tag, zone }.
// waitUntil keeps the worker alive through the delay, so the notification
// still appears if the user switches apps or locks the phone meanwhile.
self.addEventListener('message', (event) => {
  const n = event.data;
  if (!n || n.type !== 'schedule') return;
  event.waitUntil(
    new Promise((resolve) => setTimeout(resolve, Math.max(0, n.delay)))
      .then(() => self.registration.showNotification(n.title, {
        body: n.body,
        tag: n.tag,
        icon: 'icons/icon-192.png',
        badge: 'icons/badge-96.png',
        data: { zone: n.zone },
      })),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const zone = event.notification.data && event.notification.data.zone;
  const url = new URL(zone ? `./?zone=${encodeURIComponent(zone)}` : './?zones', self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((c) => 'focus' in c);
    if (open) {
      open.postMessage({ type: 'open-zone', zone });
      return open.focus();
    }
    return self.clients.openWindow(url);
  })());
});
