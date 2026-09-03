const VERSION = new URL(self.location.href).searchParams.get("v") || "legacy";
const PREFIX = "pubmax-sw-";
const SWR_CACHE = `${PREFIX}swr-${VERSION}`;
const SHELL_CACHE = `${PREFIX}shell-${VERSION}`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.allSettled(
        ["/", "/map"].map((url) =>
          fetch(url, { cache: "no-cache" }).then((response) => {
            if (response.ok) return cache.put(url, response);
            return undefined;
          }),
        ),
      ),
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.hostname !== "tiles.openfreemap.org") return;
  event.respondWith(staleWhileRevalidate(event, request));
});

function isCacheable(response) {
  return Boolean(
    response &&
      response.ok &&
      (response.type === "basic" || response.type === "cors"),
  );
}

async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(SWR_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (isCacheable(response)) {
        return cache
          .put(request, response.clone())
          .then(() => response);
      }
      return response;
    })
    .catch(() => undefined);

  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  const fresh = await network;
  if (fresh) return fresh;
  return Response.error();
}
