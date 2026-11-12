const CACHE_NAME = 'hesab-shell-v19';
const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.all(APP_FILES.map(f => cache.add(new Request(f, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith('hesab-shell-') || key.startsWith('hesab-v'))
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Version check requests (?v=...) must always reach the network.
  if (url.searchParams.has('v')) return;

  // Page navigations: serve the cached app shell immediately (works with VPN,
  // slow or no network), and refresh the cache in the background.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = (await cache.match('./index.html')) || (await cache.match('./'));

      // Network first (bypasses the HTTP cache) so new versions arrive at once;
      // fall back to the cached shell if the network is slow or offline.
      const network = fetch(request.url, { cache: 'reload' })
        .then(response => {
          if (response && response.ok) {
            cache.put('./index.html', response.clone());
          }
          return response;
        })
        .catch(() => null);

      if (cached) {
        const timeout = new Promise(resolve => setTimeout(() => resolve(null), 3000));
        const fresh = await Promise.race([network, timeout]);
        event.waitUntil(network);
        return fresh || cached;
      }

      const response = await network;
      return response ||
        new Response('برای اجرای برنامه، یک‌بار آن را در حالت آنلاین باز کنید.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    })());
    return;
  }

  // Other app resources: cache first, refresh the cache in the background.
  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true });

    const refresh = fetch(request)
      .then(async response => {
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      })
      .catch(() => null);

    if (cached) {
      event.waitUntil(refresh);
      return cached;
    }

    const response = await refresh;
    return response || new Response('', { status: 504, statusText: 'Offline' });
  })());
});

/* ---------- هشدار سررسید در پس‌زمینه (Android/Chrome، برنامهٔ نصب‌شده) ---------- */

function hesabReadDues() {
  return new Promise(resolve => {
    try {
      const open = indexedDB.open('hesab-alarm', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('kv');
      open.onerror = () => resolve([]);
      open.onsuccess = () => {
        try {
          const db = open.result;
          const get = db.transaction('kv').objectStore('kv').get('dues');
          get.onsuccess = () => { db.close(); resolve(get.result || []); };
          get.onerror = () => { db.close(); resolve([]); };
        } catch (e) {
          resolve([]);
        }
      };
    } catch (e) {
      resolve([]);
    }
  });
}

async function hesabCheckDue() {
  const list = await hesabReadDues();
  const n = new Date();
  const today = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());

  for (const x of list) {
    const left = Math.round((x.g - today) / 864e5);
    if (left <= 0 || left <= x.rem) {
      const title = x.who ? (x.k === 'r' ? 'سررسید طلب از ' : 'سررسید بدهی به ') + x.who : (x.k === 'r' ? 'سررسید طلب دارید' : 'سررسید بدهی دارید');
      const existing = await self.registration.getNotifications({ tag: 'hesab-' + x.id });
      if (existing.length) continue;

      const when = left < 0 ? (-left) + ' روز گذشته'
                 : left === 0 ? 'امروز'
                 : left + ' روز مانده';

      await self.registration.showNotification(title, {
        body: (x.a ? x.a.toLocaleString('fa-IR') + ' تومان · ' : '') + when,
        tag: 'hesab-' + x.id,
        requireInteraction: true,
        vibrate: [300, 150, 300, 150, 300]
      });
    }
  }
}

self.addEventListener('periodicsync', event => {
  if (event.tag === 'hesab-due') event.waitUntil(hesabCheckDue());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(list =>
      list.length ? list[0].focus() : clients.openWindow('./')
    )
  );
});
