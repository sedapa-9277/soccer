// 출석부 (내 폰) 서비스 워커 — local/ 폴더 전용. 앱 화면 파일을 캐시해 두고 캐시에서 먼저 연다(오프라인 동작).
// local.css·local.js의 ?v=N을 올리면 아래 SHELL과 VERSION도 함께 올린다.
const VERSION = 12;
const PREFIX = 'soccer-local-shell-';
const CACHE = PREFIX + VERSION;
const FONT_CACHE = 'soccer-local-fonts';
const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
const SHELL = [
  './',
  'local.css?v=9',
  'local.js?v=10',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
];
const SCOPE = self.registration.scope;
const SHELL_URLS = SHELL.map((p) => new URL(p, SCOPE).href);
const INDEX_URL = new URL('./', SCOPE).href;

// 같은 주소의 다른 서비스 워커(온라인 출석부)가 캐시를 지울 수 있으므로, 빠진 파일이 있으면 다시 채운다
async function fillShell() {
  const c = await caches.open(CACHE);
  const have = new Set((await c.keys()).map((r) => r.url));
  const missing = SHELL_URLS.filter((u) => !have.has(u));
  if (missing.length) await c.addAll(missing.map((u) => new Request(u, { cache: 'reload' })));
}

self.addEventListener('install', (e) => {
  e.waitUntil(fillShell().then(() => self.skipWaiting()));
});

// 이 앱의 이전 버전 캐시만 정리한다 (온라인 출석부 캐시는 건드리지 않음)
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function fromCacheOrNet(req, key, cacheName) {
  const hit = await caches.match(key, { cacheName });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') {
    const copy = res.clone();
    caches.open(cacheName).then((c) => c.put(key, copy)).catch(() => {});
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 구글 폰트: 한 번 받은 글꼴은 캐시해 두고 오프라인에서도 쓴다 (실패하면 기본 글꼴)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(fromCacheOrNet(req, req, FONT_CACHE));
    return;
  }
  // 엑셀 내보내기 라이브러리: 한 번 받으면 캐시해 두고 오프라인에서도 쓴다
  if (url.href === XLSX_URL) {
    e.respondWith(fromCacheOrNet(req, XLSX_URL, FONT_CACHE));
    return;
  }
  if (url.origin !== self.location.origin) return; // 공유 DB 가져오기(Supabase)는 항상 네트워크로

  // 화면 열기: 주소 뒤 ?·#와 상관없이 index를 캐시에서
  const page = url.origin + url.pathname;
  if (req.mode === 'navigate' && (page === INDEX_URL || page === INDEX_URL + 'index.html')) {
    e.waitUntil(fillShell().catch(() => {}));
    e.respondWith(fromCacheOrNet(req, INDEX_URL, CACHE).catch(() => Response.error()));
    return;
  }
  if (SHELL_URLS.includes(url.href)) {
    e.respondWith(fromCacheOrNet(req, url.href, CACHE));
  }
});
