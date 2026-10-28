const CACHE_NAME = 'fabledom-planner-v1';

// List of all files the PWA needs to work offline
const ASSETS_TO_CACHE = [
  './',
  './index.html', // Make sure your HTML file is named index.html when you upload to Github
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Install Event: Caches all required assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// Fetch Event: Serves files from the cache if available, otherwise goes to the network
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    })
  );
});