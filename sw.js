// 출석부 서비스 워커 — 앱 화면 파일만 캐시하고, 데이터(Supabase)는 항상 네트워크로 받는다.
const CACHE = 'attendance-shell-v44';
const SHELL = [
  './',
  'index.html',
  'attendance.css',
  'attendance.js',
  'chat.js',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
];
const SHELL_URLS = new Set(SHELL.map((p) => new URL(p, self.registration.scope).pathname));

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

// 이전 버전 캐시 정리 — local/ 등 다른 앱의 캐시는 건드리지 않도록 자기 접두사만
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('attendance-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 같은 출처의 앱 화면 파일만 처리 — Supabase API·CDN 스크립트·폰트는 건드리지 않는다
  if (url.origin !== self.location.origin || !SHELL_URLS.has(url.pathname)) return;

  // 네트워크 우선, 실패(오프라인)하면 캐시
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(url.pathname, copy));
        }
        return res;
      })
      .catch(() => caches.match(url.pathname).then((hit) => hit || caches.match(new URL('./', self.registration.scope).pathname)))
  );
});
