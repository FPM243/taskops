const CACHE_NAME = 'nexus-shell-v1';

// install: skipWaiting fuerza que el nuevo SW tome control de inmediato
// sin esperar a que el usuario cierre todas las pestañas
self.addEventListener('install', event => {
  self.skipWaiting();
});

// activate: borra caches viejos y reclama todos los clientes abiertos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] Borrando cache viejo:', k);
          return caches.delete(k);
        })
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // NETWORK-FIRST para navegación (index.html)
  // Garantiza que el app shell siempre sea la versión más reciente del deploy
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, copy));
          return res;
        })
        .catch(() =>
          caches.match(event.request).then(r => r || caches.match('/'))
        )
    );
    return;
  }

  // CACHE-FIRST para assets con hash de Vite (son inmutables por diseño)
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, copy));
          return res;
        });
      })
    );
    return;
  }

  // NETWORK-FIRST para el resto (favicon, íconos, manifest, etc.)
  event.respondWith(
    fetch(event.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});

self.addEventListener('push', function(event) {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'NEXUS';
  const options = {
    body: data.body || 'Nueva notificación',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    data: { url: data.url || '/' },
    vibrate: [200, 100, 200],
    requireInteraction: true,
    tag: 'taskops-' + Date.now(),
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      const client = clientList[0];
      if (client) {
        // Navega la ventana existente al deep link y la enfoca,
        // en vez de solo enfocarla sin moverla de donde estaba (mandaba al home).
        if ('navigate' in client) {
          return client.navigate(targetUrl)
            .then(navigated => (navigated || client).focus())
            .catch(() => client.focus());
        }
        return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
