import { ogCardRateLimitedResponse } from "@/lib/ogCardRateLimit";
import { renderHomeOgCard } from "@/lib/homeOgCard";

export const runtime = "nodejs";

// The homepage share card, drawn by lib/homeOgCard and served from a ROUTE
// rather than from the root `opengraph-image.tsx` file convention.
//
// WHY IT MOVED (perf, and it is not a small one): Next folds a segment's
// opengraph-image into a metadata module that every descendant PAGE's server
// function carries. At the ROOT segment that is every page on the site, so the
// card's imports — next/og with its resvg and yoga wasm, sharp, the brand fonts
// and the 6.7 MB price dataset the pub count is read from — shipped inside the
// deployed function of /map, /privacy and everything else. Measured on this
// repository: 14.5 MB of traced function payload per page, against 3.5 MB with
// the card served from here, and cold start is what that weight buys. A
// dynamic `import()` inside the handler does NOT help; the tracer follows it.
//
// The homepage names this URL in its own metadata (app/page.tsx). Every other
// route keeps the site-wide /og.png fallback set in app/layout.tsx, which is
// what the rest of the codebase already states and restates.
//
// runtime = "nodejs": the pub count is read from the filesystem and the Space
// Grotesk fonts are read from public/fonts, both edge-incompatible.
export async function GET(request: Request) {
  const limited = await ogCardRateLimitedResponse(request, "og:home-card");
  if (limited) return limited;
  return renderHomeOgCard();
}
