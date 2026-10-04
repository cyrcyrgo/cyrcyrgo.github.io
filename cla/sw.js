/* YJS offline shell — service worker.
 *
 * Scope: the /cla/ folder on GitHub Pages (or "/" when run locally).
 * Caches the page shell + vendored inference engine/wasm so the local-mode
 * UI opens with NO internet. API calls and cross-origin weight downloads
 * are never intercepted.
 */
const VERSION = "yjs-shell-v20261003n";
const BASE = self.registration.scope;

const PRECACHE = [
  "./",
  "./index.html",
  "./assets/style.css",
  "./assets/app.js",
  "./assets/local.js",
  "./assets/vendor/transformers.min.js",
  "./assets/vendor/ort-wasm-simd-threaded.jsep.wasm",
].map((p) => new URL(p, BASE).href);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.all(PRECACHE.map((u) =>
      cache.add(u).catch(() => undefined)));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // mirrors/API: ignore
  if (url.pathname.includes("/api/")) return;           // backend API: online only

  // Static assets: cache-first, refresh in the background.
  if (url.pathname.includes("/assets/")) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const hit = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => hit);
      return hit || network;
    })());
    return;
  }

  // Navigations / config / everything else same-origin: network-first,
  // fall back to the cached shell when fully offline.
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = await fetch(req);
      if (res.ok && (req.mode === "navigate" || url.pathname.endsWith("index.html"))) {
        cache.put(new URL("./index.html", BASE).href, res.clone());
      }
      return res;
    } catch (_) {
      if (req.mode === "navigate") {
        const shell = await cache.match(new URL("./index.html", BASE).href)
          || await cache.match(new URL("./", BASE).href);
        if (shell) return shell;
      }
      return cache.match(req, { ignoreSearch: true });
    }
  })());
});
