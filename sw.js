const CACHE_NAME = 'klif-scan-cache-v9';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './assets/icon.svg',
  './css/styles.css',
  './js/db.js',
  './js/api.js',
  './js/scanner.js',
  './js/auth.js',
  './js/app.js',
  './js/libs/html5-qrcode.min.js'
];

// Instalação do Service Worker e Caching dos Assets estáticos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching app shell assets');
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Ativação e limpeza de caches antigos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Intercepção de requisições - Estratégia Stale-While-Revalidate para assets locais
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // Não cacheia requisições de APIs externas (Open Facts, Barcode Lookup e UPCitemdb)
  if (
    requestUrl.hostname.includes('openfoodfacts.org') ||
    requestUrl.hostname.includes('openbeautyfacts.org') ||
    requestUrl.hostname.includes('openproductsfacts.org') ||
    requestUrl.hostname.includes('openpetfoodfacts.org') ||
    requestUrl.hostname.includes('barcodelookup.com') ||
    requestUrl.hostname.includes('upcitemdb.com')
  ) {
    return; // Deixa o fetch acontecer normalmente da rede
  }

  // Apenas lida com requisições GET
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Tenta atualizar o cache em background de forma assíncrona
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, networkResponse);
              });
            }
          })
          .catch(() => {
            // Silencia falhas de fetch em background quando estiver sem internet
          });

        return cachedResponse;
      }

      // Se não estiver no cache, busca na rede
      return fetch(event.request).then((response) => {
        // Se for uma resposta válida e local, coloca no cache
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      });
    })
  );
});
