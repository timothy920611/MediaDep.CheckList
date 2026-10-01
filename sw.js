/* 音控指南 Media Dept. — Service Worker
 * - PDF：第一次下載後存在裝置上，之後秒開、也能離線閱讀；背景會用 ETag 檢查有沒有新版。
 *   第一次開啟時邊下載邊顯示，並回報進度；背景預載會讓路給使用者正在等的那份。
 * - HTML：優先抓網路（確保拿到最新版），沒網路才用快取。
 * 更新網站外觀後，把 SHELL_VERSION 改一下即可。
 */
const SHELL_VERSION = 'shell-2026-10-01j';
const DOC_CACHE = 'docs-v1';
const SHELL_FILES = ['./', './index.html', './checklist-interactive.html', './checklist-stage.html', './checklist-mic.html'];

// url -> 下載工作 { ready, done, ctrl, bg, copy, taken }（同一份 PDF 不會同時下載兩次）
const jobs = new Map();
const queue = [];   // 等著背景預載的文件
let pumping = false;
let focus = null;   // 使用者正在等的那份文件下載完成前，背景預載先暫停

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

// 下載一份 PDF 存進快取。回應同時分一份給正在等的畫面（copy），不必等整份存完才開始顯示。
function download(key, { bg = false, revalidate = false } = {}) {
  const running = jobs.get(key);
  if (running) { if (!bg) running.bg = false; return running; }
  const job = { bg, ctrl: new AbortController(), copy: null, taken: false };
  let setReady;
  job.ready = new Promise((r) => { setReady = r; });
  job.done = (async () => {
    try {
      const res = await fetch(key, { cache: 'no-cache', signal: job.ctrl.signal }); // 有 ETag 時只會回 304，不會重新下載整份
      if (res.status !== 200) { setReady(null); return false; }
      const counted = countBytes(res, job, key);
      if (!revalidate) job.copy = counted.clone();
      setReady(job);
      await (await caches.open(DOC_CACHE)).put(key, counted);
      return true;
    } catch (e) { setReady(null); throw e; }
  })().finally(() => { jobs.delete(key); job.copy = null; });
  jobs.set(key, job);
  return job;
}

// 計算已下載的位元組；使用者正在等這份時回報進度（loader 顯示「已下載 45%」，不會看起來像當機）
function countBytes(res, job, key) {
  const total = res.headers.has('content-encoding') ? 0 : Number(res.headers.get('content-length')) || 0;
  let loaded = 0, last = 0;
  const report = (done) => {
    if (job.bg) return;
    self.clients.matchAll({ type: 'window' })
      .then((all) => all.forEach((c) => c.postMessage({ type: 'progress', url: key, loaded, total, done })));
  };
  const body = res.body.pipeThrough(new TransformStream({
    transform(chunk, ctl) {
      loaded += chunk.byteLength;
      ctl.enqueue(chunk);
      const now = Date.now();
      if (now - last > 150) { last = now; report(false); }
    },
    flush() { report(true); },
  }));
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

async function serveDoc(event) {
  const key = docKey(event.request.url);
  const cache = await caches.open(DOC_CACHE);
  const hit = await cache.match(key);
  if (hit) {
    event.waitUntil(download(key, { bg: true, revalidate: true }).done.catch(() => {})); // 背景檢查新版
    return hit;
  }

  // 使用者在等這份 → 其他背景預載先停下來，頻寬全部讓給它（之後會自動接著抓）
  for (const [k, j] of jobs) if (k !== key && j.bg && !j.taken) j.ctrl.abort();
  const job = download(key);
  const f = focus = job.done.then((ok) => ok && notifyCached(key), () => {}).then(() => { if (focus === f) focus = null; });
  event.waitUntil(f);

  const ready = await job.ready;
  if (ready && ready.copy && !ready.taken) { ready.taken = true; return ready.copy; }
  // 副本已被別的分頁拿走，或下載失敗 → 等存好再給；不行就直接抓網路
  try { if (await job.done) { const r = await cache.match(key); if (r) return r; } } catch (e) {}
  return fetch(event.request);
}

// 背景預載：一次一份；使用者打開文件時暫停，被打斷的那份之後重抓
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    const cache = await caches.open(DOC_CACHE);
    while (queue.length) {
      if (focus) { await focus; continue; }
      const key = queue.shift();
      if (await cache.match(key)) continue;
      const job = download(key, { bg: true });
      try { if (await job.done) await notifyCached(key); }
      catch (e) { if (job.ctrl.signal.aborted) queue.push(key); /* 離線或失敗就跳過 */ }
    }
  } finally { pumping = false; }
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

// 頁面要求「先幫我下載這幾份」（滑鼠移過去 / 手指按下的那份排最前面；閒置時把其他文件也存好）
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'warm' || !Array.isArray(data.urls)) return;
  const keys = data.urls.map(docKey).filter((k) => !queue.includes(k));
  if (data.front) queue.unshift(...keys); else queue.push(...keys);
  event.waitUntil(pump());
});
