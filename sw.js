/* 音控指南 Media Dept. — Service Worker
 * - PDF：還沒存到裝置的，第一次開啟時不經手，讓瀏覽器直接下載（最快）；背景再慢慢存到裝置，
 *   之後秒開、也能離線閱讀；背景會用 ETag 檢查有沒有新版。
 * - HTML：優先抓網路（確保拿到最新版），沒網路才用快取。
 * 更新網站外觀後，把 SHELL_VERSION 改一下即可。
 */
const SHELL_VERSION = 'shell-2026-10-02e';
const DOC_CACHE = 'docs-v1';
const SHELL_FILES = ['./', './index.html', './checklist-interactive.html', './checklist-stage.html', './checklist-mic.html'];

// 已存到裝置的 PDF（同步查得到，fetch 時要當下決定要不要接手）
const cachedKeys = new Set();
const keysLoaded = caches.open(DOC_CACHE).then((c) => c.keys()).then((reqs) => reqs.forEach((r) => cachedKeys.add(r.url))).catch(() => {});

const jobs = new Map(); // url -> { done, ctrl }（避免同一份 PDF 同時下載兩次）
const viewed = new Set(); // 瀏覽器剛自己下載過的文件（補存時可以直接用瀏覽器暫存）
const queue = [];       // 等著背景預載的文件
let pumping = false;
let pausedUntil = 0;    // 使用者正在看還沒存的文件時，背景預載先暫停到這個時間
const PAUSE_MS = 30000;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_VERSION).then((c) => c.addAll(SHELL_FILES)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // 舊版外觀和用不到的快取（例如之前 PDF.js 版本留下的）都清掉，只留這版的外觀和 PDF
    await Promise.all(keys.filter((k) => k !== SHELL_VERSION && k !== DOC_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function docKey(url) {
  const u = new URL(url, self.location.href);
  u.search = ''; u.hash = '';
  return u.href;
}

// 下載一份 PDF 存到裝置。
// - 檢查新版（revalidate = 裝置上那份）：帶它的 ETag 問伺服器，沒變只回 304，不靠瀏覽器暫存
//   （iPhone 常會清掉瀏覽器暫存，清掉後原本每次開文件都會在背景整份重抓）。
// - 瀏覽器剛自己下載過（viewed）：用瀏覽器暫存，多半只回 304，不必再下載一次。
// - 其他：直接下載，不在瀏覽器暫存多存一份（反正存到 DOC_CACHE）。
function download(key, revalidate = null) {
  if (jobs.has(key)) return jobs.get(key).done;
  const ctrl = new AbortController();
  const done = (async () => {
    const headers = {};
    if (revalidate) {
      const etag = revalidate.headers.get('etag'), modified = revalidate.headers.get('last-modified');
      if (etag) headers['If-None-Match'] = etag;
      else if (modified) headers['If-Modified-Since'] = modified;
    }
    const cache = !revalidate && viewed.has(key) ? 'no-cache' : 'no-store';
    const res = await fetch(key, { cache, headers, signal: ctrl.signal });
    if (res.ok && res.status === 200) {
      await (await caches.open(DOC_CACHE)).put(key, res);
      cachedKeys.add(key);
      viewed.delete(key);
      await notifyCached(key);
    }
  })().catch((e) => {
    throw ctrl.signal.aborted ? new DOMException('被使用者要看的文件打斷', 'AbortError') : e;
  }).finally(() => jobs.delete(key));
  jobs.set(key, { done, ctrl });
  return done;
}

async function serveCached(event, key) {
  const hit = await (await caches.open(DOC_CACHE)).match(key);
  if (hit) {
    event.waitUntil(download(key, hit).catch(() => {})); // 背景檢查新版
    return hit;
  }
  cachedKeys.delete(key);
  return fetch(event.request);
}

// 使用者要看一份還沒存的文件：交給瀏覽器直接下載（跟沒有 Service Worker 時一樣快，
// Safari 也能邊下載邊顯示），背景預載先停下來讓出頻寬，過一陣子再把這份補存起來。
function yieldTo(key) {
  for (const job of jobs.values()) job.ctrl.abort();
  pausedUntil = Date.now() + PAUSE_MS;
  viewed.add(key);
  const i = queue.indexOf(key);
  if (i >= 0) queue.splice(i, 1);
  queue.unshift(key);
  return pump();
}

// 背景預載：一次一份；暫停期間等著；被打斷的那份之後重抓
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    await keysLoaded; // Service Worker 剛啟動時清單還在讀，先等讀完才知道哪些已經存了
    while (queue.length) {
      const wait = pausedUntil - Date.now();
      if (wait > 0) { await new Promise((r) => setTimeout(r, wait)); continue; }
      const key = queue.shift();
      if (cachedKeys.has(key)) continue;
      try { await download(key); }
      catch (e) { if (e && e.name === 'AbortError') queue.push(key); /* 離線或失敗就跳過 */ }
    }
  } finally { pumping = false; }
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_VERSION);
  try {
    const res = await fetch(request);
    if (res.ok && res.type === 'basic') cache.put(docKey(request.url), res.clone()); // 去掉 ?query，同一頁只存一份
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
  if (url.pathname.toLowerCase().endsWith('.pdf')) {
    const key = docKey(req.url);
    if (cachedKeys.has(key) || !self.navigator.onLine) event.respondWith(serveCached(event, key)); // 已存到裝置 / 離線
    else event.waitUntil(yieldTo(key)); // 還沒存：不經手，讓瀏覽器直接下載
    return;
  }
  if (req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    event.respondWith(networkFirst(req));
  }
});

// 頁面要求「先幫我下載這幾份」（閒置時把文件預先存好）
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'warm' || !Array.isArray(data.urls)) return;
  data.urls.map(docKey).forEach((k) => { if (!queue.includes(k)) queue.push(k); });
  event.waitUntil(pump());
});
