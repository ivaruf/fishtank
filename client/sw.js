// Makes the tank installable and playable with no network. Solo already runs
// entirely in the tab (client/js/local.js), so the only thing standing between
// a cold start and offline play was fetching the files.
//
// Two strategies, chosen so that going offline never costs freshness:
//
//   Code and markup   network first, falling back to cache. Online you always
//                     get the build that is deployed, which is what the "build
//                     <sha>" line on the menu is for; offline you get the last
//                     one that worked.
//   Assets            cache first, revalidated in the background. Fish models
//                     are megabytes and change only when they are rebuilt, so
//                     serving them instantly and refreshing behind the scenes
//                     costs one stale load after a rebuild and nothing else.
//
// Bump CACHE whenever this file changes: the name is what retires old entries.
const CACHE = "fishtank-v1";
// Enough to boot the menu and start a solo game with no network at all.
const SHELL = [
  "./",
  "index.html",
  "css/style.css",
  "js/main.js",
  "js/local.js",
  "js/peer.js",
  "js/webrtc.js",
  "js/rendezvous.js",
  "js/host-worker.js",
  "js/networking.js",
  "js/world.js",
  "js/fish.js",
  "js/controls.js",
  "js/effects.js",
  "js/filter.js",
  "js/audio.js",
  "js/rendering.js",
  "js/fullscreen.js",
  "../shared/config.js",
  "../shared/movement.js",
  "../shared/world.js",
  "manifest.webmanifest",
];
// Big, rarely-changing things: models, sounds, thumbnails, icons, and the
// Babylon bundles whether they come from the CDN or the /vendor/ fallback.
const isAsset = (url) =>
  /\/(assets|vendor)\//.test(url.pathname) ||
  url.hostname.endsWith("jsdelivr.net");

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // One miss must not fail the whole install, or a single renamed file
      // would leave the game with no offline support at all.
      await Promise.all(
        SHELL.map((url) => cache.add(url).catch(() => undefined)),
      );
      await self.skipWaiting();
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name !== CACHE) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

async function networkFirst(request, cache) {
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const hit = await cache.match(request);
    if (hit) return hit;
    // A navigation with nothing cached still deserves the menu, not a crash.
    if (request.mode === "navigate") {
      const shell = await cache.match("index.html");
      if (shell) return shell;
    }
    throw error;
  }
}

async function cacheFirst(request, cache) {
  const hit = await cache.match(request);
  const update = fetch(request)
    .then((response) => {
      // Only same-origin, non-opaque responses can be stored or trusted.
      if (response.ok && response.type !== "opaque")
        cache.put(request, response.clone());
      return response;
    })
    .catch(() => hit);
  // Serve what we have at once and let the refresh land for next time. If
  // there is no hit we must await the network: returning the bare promise
  // would hand respondWith an undefined when it rejects, which fails the
  // request outright instead of merely missing the cache.
  return hit || (await update) || fetch(request);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Never cache the live build report or anything that is not http(s):
  // /healthz is how the menu proves which build is running.
  // Suffix, not equality: under a project Pages site everything lives beneath
  // /<repo>/, so these are not at the origin root.
  if (url.pathname.endsWith("/healthz") || !url.protocol.startsWith("http"))
    return;
  // WebSockets do not pass through here, but be explicit about intent.
  if (url.pathname.endsWith("/ws")) return;
  if (url.origin !== self.location.origin && !isAsset(url)) return;
  event.respondWith(
    caches
      .open(CACHE)
      .then((cache) =>
        isAsset(url)
          ? cacheFirst(request, cache)
          : networkFirst(request, cache),
      )
      // A worker must never be the reason the game fails to load. Anything
      // unexpected in here falls back to the plain request, which is exactly
      // what would have happened with no worker installed at all.
      .catch(() => fetch(request)),
  );
});
