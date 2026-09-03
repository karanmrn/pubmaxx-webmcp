import type { Metadata } from "next";

import LandingPage from "@/components/landing/LandingPage";
import AppEntryRoute from "@/components/native/AppEntryRoute";
import { loadAboutStats } from "@/lib/aboutStats";
import { readTrustedHandoffFlag } from "@/lib/trustedHandoffFlags.server";

// The words a forwarded link shows beside the card. They say the same thing the
// page itself says, because a referral link (/r/<code>) lands on /#referral=…
// and so previews THIS head: the description is the landing lede verbatim
// (components/landing/LandingPage), and the map is no longer pint-only, so the
// line invites a reader to pick a drink rather than promising an
// "interactive map".
const HOME_TITLE = "PUBMAXXING: what a pint costs, pub by pub";
const HOME_DESCRIPTION =
  "Choose its form and voice in five steps. Sign in to keep it, then talk or type while it shapes a night from PUBMAXX prices, venues, and events.";

// Self-canonical for the homepage (Wave S1.4). Title/description inherit the
// root layout defaults; this pins the canonical URL and the homepage's own
// share card.
//
// The card is drawn by /api/home-card, not by a root opengraph-image.tsx file
// convention: at the root segment that convention puts the whole card kit
// (next/og, its wasm, sharp, the brand fonts and the price dataset it counts)
// inside the deployed function of EVERY page, which is about 11 MB of
// cold-start weight per route. app/api/home-card/route.tsx carries the
// measurement. Next replaces a parent's openGraph object wholesale rather than
// merging it, so the homepage restates the fields it keeps.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: {
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    url: "https://pubmaxxing.com",
    siteName: "PUBMAXX",
    type: "website",
    images: [
      {
        url: "/api/home-card",
        width: 1200,
        height: 630,
        // No count here: this string is static metadata, so a figure typed in
        // would rot while the card's own figures are derived per render.
        alt: "PUBMAXXING. Listed pint prices on one map, across London and more UK cities",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    images: ["/api/home-card"],
  },
};

// THIS DOCUMENT IS PRERENDERED (captain decision 2026-08-09, recorded in
// proxy.ts): it drops the per-request CSP nonce so the Vercel CDN can hold it.
// Two rules follow, and both are enforced by tests:
//
//   1. Nothing per-request may be read here. `force-static` makes that a build
//      error rather than a silent per-request render, and it is also what stops
//      the root layout's nonce read (`headers()`) from pulling this route back
//      into dynamic rendering.
//   2. Nothing personal may reach this document. One prerendered copy is handed
//      to every stranger, so the viewer's handle, session and saved state are
//      fetched by the client after load, never rendered here.
//
// The physical QR path (PLG Wave 2) used to be answered here: printed codes use
// /?src=poster (+ optional utm_*) and the arrival goes to /near with the
// campaign query kept. Reading that query is per-request work, so proxy.ts now
// redirects it before this route is reached. lib/posterLanding.ts still owns
// where it lands.
export const dynamic = "force-static";
// Every input here (the shipped price dataset loadAboutStats counts, the flag
// env) changes only on deploy, so an hour is a quiet ceiling rather than a
// refresh the page needs: it bounds how long a stale copy can outlive a change
// nobody redeployed for.
export const revalidate = 3600;

export default async function Home() {
  // Real coverage numbers, derived at build/request time from the same bundled
  // pint-price dataset + enabled-city config the rest of the app reads (via the
  // provenance-honest lib/aboutStats). No invented counts — loadAboutStats
  // degrades to zeroed figures on any read failure, and the landing hero falls
  // back to plain copy when a figure is missing. Passed as a plain serialisable
  // prop into the client LandingPage.
  const stats = await loadAboutStats();
  // Soft launch keeps friends-launch unset/off. Thread the same gate the Social
  // APIs use so Memory CTAs never promise "Open Social" while /social still
  // answers "not open yet."
  const socialFriendsLaunchEnabled = readTrustedHandoffFlag("socialFriendsLaunch");

  return (
    <>
      {/* Preload the LCP-adjacent hero (a CSS background on .lpHero::before, so
          the browser would otherwise only discover it after CSS parse).
          type=avif → non-AVIF browsers skip these and fall through to the
          image-set WebP/JPEG; media-scoped → each viewport fetches only its
          width. React hoists these to <head>. */}
      <link rel="preload" as="image" href="/landing/hero-thames-1024.avif" type="image/avif" media="(max-width: 768px)" />
      <link rel="preload" as="image" href="/landing/hero-thames-1600.avif" type="image/avif" media="(min-width: 769px)" />
      {/* The only route the entry decision may rewrite (issue #439): shell
          opens (Capacitor wrap, installed PWA) land on /tonight, a genuine
          native first-run opens the one-time onboarding, browser visits
          stay here. Deep links never mount this. No-op on web/SSR. */}
      <AppEntryRoute />
      <LandingPage
        stats={stats}
        socialFriendsLaunchEnabled={socialFriendsLaunchEnabled}
      />
    </>
  );
}
