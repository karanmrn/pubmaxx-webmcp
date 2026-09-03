import type { MetadataRoute } from "next";

import { PRODUCTION_SITE_ORIGIN } from "@/lib/siteUrlConfig.mjs";

// Wave S1.1 — robots policy. PUBMAXX WANTS to be crawled, by search engines and
// by AI assistants alike: our moat is unique, dated, provenance-first facts
// (3,000+ tracked pint prices, 346 cited historic pubs), and the growth thesis
// (see docs/PRD_SEARCH_GROWTH_2026-07-16.md) is that both Google AND the AI
// engines reward extractable structured facts. So we allow all crawlers, and
// name the major AI crawlers explicitly to DOCUMENT that intent — an allow entry
// for GPTBot/ClaudeBot/etc. is functionally the same as the wildcard, but makes
// "yes, index and cite us" unambiguous to anyone reading robots.txt.
//
// Disallow list — only surfaces that are private, member-tokened, or
// user-generated-ephemeral, never the public data surfaces:
//   /api/        JSON/al endpoints, not documents.
//   /admin       moderation console.
//   /p/          Pint Drop permalinks — friends-gated UGC keyed by an opaque id
//                (app/p/[id] withholds hidden/friends drops); not a public page.
//   /rounds/     live "Round" sessions keyed by a member round code (a shared
//                token) — app/rounds/[code] is a private crew presence surface.
//   /plan/       private crawl-planning sessions (per-user working state).
//   /bar-tab/    ephemeral per-visit tab; app/bar-tab/[id] is already noindex.
//   /ledger,     kept CRAWLABLE on purpose — /ledger/[id] is the canonical,
//                token-free venue permalink (the price + heritage moat), so it is
//                deliberately NOT disallowed.
//   /messages,   private user surfaces.
//   /profile,
//   /activity,
//   /auth
//   /map/arrival the per-request half of /map (lib/mapDocumentTwin.ts). Every
//                document it renders is canonically /map, so it is a render
//                target rather than an address; its pages say noindex too.
//
// Preview / development deployments (anything other than VERCEL_ENV=production)
// are NOT the product. They get a total disallow plus X-Robots-Tag from
// proxy.ts so a share link or lifted deployment protection cannot create a
// second indexed copy of pubmaxxing.com. The check is the Vercel env var, not
// the hostname — preview hosts change every deployment.
//
// The nonce CSP (proxy.ts) forces dynamic rendering, so this file is served
// per-request rather than statically — fine for a robots response.

// Explicitly-named AI + search crawlers we welcome. Listing them documents the
// "be AI-visible" decision; the policy each gets is the same as the wildcard.
const NAMED_AI_CRAWLERS = [
  "GPTBot", // OpenAI (ChatGPT browsing + training)
  "ClaudeBot", // Anthropic (Claude training crawler)
  "Claude-User", // Anthropic (Claude live user-initiated fetch)
  "PerplexityBot", // Perplexity
  "Google-Extended", // Google Gemini / Vertex data control token
  "Bingbot", // Bing / Copilot (ChatGPT search reads Bing)
] as const;

// Private / member-tokened / ephemeral-UGC surfaces kept out of every crawler.
const DISALLOW = [
  "/api/",
  "/admin",
  "/p/",
  "/rounds/",
  "/plan/",
  "/bar-tab/",
  "/messages",
  "/profile",
  "/activity",
  "/auth",
  "/map/arrival",
];

function isProductionDeployment(
  vercelEnv: string | undefined = process.env.VERCEL_ENV,
): boolean {
  return vercelEnv === "production";
}

export default function robots(): MetadataRoute.Robots {
  // Non-production: block every path. No sitemap, no host, no AI allow list —
  // a preview must never look crawlable even if protection is off.
  if (!isProductionDeployment()) {
    return {
      rules: {
        userAgent: "*",
        disallow: "/",
      },
    };
  }

  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: DISALLOW },
      // Named allow entries for the AI crawlers — same disallow set, explicit
      // welcome (documents intent to be AI-visible and citable).
      ...NAMED_AI_CRAWLERS.map((userAgent) => ({
        userAgent,
        allow: "/",
        disallow: DISALLOW,
      })),
    ],
    sitemap: `${PRODUCTION_SITE_ORIGIN}/sitemap.xml`,
    host: PRODUCTION_SITE_ORIGIN,
  };
}
