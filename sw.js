/* 媒體部門 CheckList — Service Worker
 * - PDF：第一次下載後存在裝置上，之後秒開、也能離線閱讀；背景會用 ETag 檢查有沒有新版。
 * - HTML：優先抓網路（確保拿到最新版），沒網路才用快取。
 * 更新網站外觀後，把 SHELL_VERSION 改一下即可。
 */
const SHELL_VERSION = 'shell-2026-10-01';
const DOC_CACHE = 'docs-v1';
const SHELL_FILES = ['./', './index.html', './checklist-interactive.html'];

const inflight = new Map(); // url -> Promise<void>（避免同一份 PDF 同時下載兩次）

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_VERSION).then((c) => c.addAll(SHELL_FILES)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL_VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function docKey(url) {
  const u = new URL(url, self.location.href);
  u.search = ''; u.hash = '';
  return u.href;
}

async function download(key) {
  if (inflight.has(key)) return inflight.get(key);
  const job = (async () => {
    const res = await fetch(key, { cache: 'no-cache' }); // 有 ETag 時只會回 304，不會重新下載整份
    if (res.ok && res.status === 200) {
      const cache = await caches.open(DOC_CACHE);
      await cache.put(key, res);
    }
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

async function serveDoc(event) {
  const key = docKey(event.request.url);
  const cache = await caches.open(DOC_CACHE);
  const hit = await cache.match(key);
  if (hit) {
    event.waitUntil(download(key).catch(() => {})); // 背景檢查新版
    return hit;
  }
  if (inflight.has(key)) { // 預先載入正在進行 → 等它完成，不重複下載
    try { await inflight.get(key); const r = await cache.match(key); if (r) return r; } catch (e) {}
  }
  const res = await fetch(event.request);
  if (res.ok && res.status === 200) event.waitUntil(cache.put(key, res.clone()).then(notifyCached.bind(null, key)).catch(() => {}));
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_VERSION);
  try {
    const res = await fetch(request);
    if (res.ok && res.type === 'basic') cache.put(request, res.clone());
    return res;
  } catch (e) {
    return (await cache.match(request, { ignoreSearch: true })) || (await cache.match('./index.html')) || Response.error();
  }
}

async function notifyCached(key) {
  const all = await self.clients.matchAll({ includeUncontrolled: true });
  all.forEach((c) => c.postMessage({ type: 'cached', url: key }));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return; // Range 請求交給瀏覽器處理
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.toLowerCase().endsWith('.pdf')) { event.respondWith(serveDoc(event)); return; }
  if (req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    event.respondWith(networkFirst(req));
  }
});

// 頁面要求「先幫我下載這幾份」（滑鼠移過去、或閒置時預先存好）
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'warm' || !Array.isArray(data.urls)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(DOC_CACHE);
    for (const u of data.urls) {
      const key = docKey(u);
      if (await cache.match(key)) continue;
      try { await download(key); await notifyCached(key); } catch (e) { /* 離線或失敗就跳過 */ }
    }
  })());
});
