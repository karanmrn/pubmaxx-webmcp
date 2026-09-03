import PintIndexMapArrival from "@/components/pintindex/PintIndexMapArrival";
import PubMaxingShell from "@/components/PubMaxingShell";
import { londonMapMetadata } from "@/lib/londonMapMetadata";
import { readTrustedHandoffFlags } from "@/lib/trustedHandoffFlags.server";

// /map stays London for back-compat bookmarks. Other cities live at /map/[city].
//
// THIS DOCUMENT IS PRERENDERED (captain decision 2026-08-09, recorded in
// proxy.ts): it drops the per-request CSP nonce so the Vercel CDN can hold it,
// which is worth the whole gap between a warm CDN hit and the cold-start
// lottery every page view used to take. Two rules follow, and both are
// enforced by tests:
//
//   1. Nothing per-request may be read here. `force-static` makes that a build
//      error rather than a silent per-request render, and it is also what stops
//      the root layout's nonce read (`headers()`) from pulling this route back
//      into dynamic rendering.
//   2. Nothing personal may reach this document. One prerendered copy is handed
//      to every stranger, so the viewer's handle, session and saved state are
//      fetched by the client after load, never rendered here.
//
// A `/map` request whose DOCUMENT differs - a town arrival, national browse, a
// curated band or crawl share card - cannot be answered by one prerendered
// copy. proxy.ts rewrites those to app/map/arrival, which renders them per
// request with the nonce intact. lib/mapDocumentTwin.ts owns that split.
export const dynamic = "force-static";
// Every input here (the flag env, the shipped city pack) changes only on
// deploy, so an hour is a quiet ceiling rather than a refresh the page needs:
// it bounds how long a stale copy can outlive a change nobody redeployed for.
export const revalidate = 3600;

export const metadata = londonMapMetadata();
const mapWarmVersion = process.env.NEXT_PUBLIC_SW_VERSION?.trim() || "local";

export default function MapPage() {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-sync-scripts */}
      <script src={`/map-first-paint-init.js?v=${encodeURIComponent(mapWarmVersion)}`} />
      <PubMaxingShell cityId="london" flags={readTrustedHandoffFlags()} />
      {/* Records that a Pint Index arrival reached the map. Renders nothing and
          owns no map state; it only reads its own arrival marker off the URL. */}
      <PintIndexMapArrival />
    </>
  );
}
