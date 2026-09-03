// Which `/map` requests need a document rendered for them, and which get the
// prerendered shell the CDN already holds.
//
// `/map` is prerendered (captain decision 2026-08-09, see proxy.ts). A
// prerendered path has ONE document, so any request whose <head> or whose
// server-resolved props differ from the plain London map cannot be answered
// from it. Those requests are rewritten - the address bar keeps `/map` - to the
// twin below, which is the same page rendered per request.
//
// The keys are the ones that really change the DOCUMENT, not the ones that
// change the map. `?sel=`, `?q=`, `?lat=`, `?lng=` and every campaign tag move
// the camera or the selection AFTER load, so they take the shell and cost
// nothing; `?place=` names a town in the title and needs the server-side place
// index; `?uk=1` retitles the page for national browse; `?band=`, `?crawl=` and
// `?pubs=` draw a curated share card. A key added here takes its requests off
// the CDN, so add one only when the document itself differs.
//
// `__tests__/mapDocumentTwin.test.ts` pins the split.

/** The route that renders a `/map` request needing its own document. */
export const MAP_DOCUMENT_TWIN_PATH = "/map/arrival";

/** The public path whose requests the twin answers. */
export const MAP_DOCUMENT_PATH = "/map";

/** Query keys whose value changes the `/map` document itself. */
export const MAP_DOCUMENT_QUERY_KEYS = [
  "place",
  "uk",
  "band",
  "crawl",
  "pubs",
] as const;

/** True when this `/map` query cannot be answered by the prerendered shell. */
export function mapRequestNeedsDocumentTwin(
  search: URLSearchParams | string,
): boolean {
  const params =
    typeof search === "string"
      ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
      : search;
  return MAP_DOCUMENT_QUERY_KEYS.some(
    (key) => (params.get(key) ?? "").trim().length > 0,
  );
}
