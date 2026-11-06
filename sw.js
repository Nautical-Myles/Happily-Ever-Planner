/* 
 Copyright (C) 2026 Nautical-Myles
 Use of this software is govered by the Business Source License included in the LICENSE.md file and at www.mariadb.com/bsl11.
 Change Date: 1 January 2028
 On the date above, in accordance with the Business Source License, use of this software will be governed by the open source license specified in the LICENSE.md file.
*/

const CACHE_NAME = 'happily-ever-planner-v0.3.5'; // Update this version number whenever you make changes to the assets

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './src/styles.css',
  './src/storybook-theme.css',
  './src/theme-toggle.js',
  './src/app.js',
  './src/sw-register.js',
  './src/version-sync.js',
  './manifest.json',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/title-card.png'
];

// 1. Install: Cache the new assets immediately
self.addEventListener('install', (event) => {
  self.skipWaiting(); // Forces the waiting service worker to become active right away
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
});

// 2. Activate: Wipe out old caches from previous versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim()) // Takes control of open windows immediately
  );
});

// 3. Fetch: Serve from cache, fall back to network
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    })
  );
});