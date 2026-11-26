'use strict';

// Service worker: luôn lấy bản mới từ mạng, chỉ dùng bộ nhớ đệm khi offline.
// Đổi CACHE khi phát hành bản mới để dọn cache cũ.
const CACHE = 'homemesh-v2.0.0';
const CORE = [  // Danh sách file nạp sẵn để chạy offline
  './',
  'index.html',
  'login.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/app.js',
  'js/api.js',
  'js/auth.js',
  'js/layout.js',
  'js/cct.js',
  'js/data.js',
  'js/mesh.js',
  'js/scanner.js',
  'js/settings.js',
  'js/ui/devices.js',
  'js/ui/settings.js',
  'js/ui/account.js',
  'js/ui/login.js',
  'js/ui/furniture2d.js',
  'js/ui/floorplan3d.js',
  'js/vendor/three.module.min.js',
  'assets/icon.svg',
  'assets/icon-192.png',
  'assets/icon-512.png'
];

self.addEventListener('install', (event) => {  // Cài service worker: nạp CORE vào cache
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {  // Xoá cache cũ
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {  // Lấy từ mạng trước, mất mạng thì lấy cache
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html')))
  );
});
