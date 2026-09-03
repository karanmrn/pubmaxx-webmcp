import { whatsappShareHref } from "@/lib/shareArtifacts";
import { isUserCancelledShare } from "@/lib/venueShare";

// The one share flow for night objects (Cycle 2 decision 5): native share
// sheet first — the OS picker is where WhatsApp actually lives on phones —
// with a wa.me deep link as the fallback everywhere the Web Share API is
// missing or fails. Callers hand over the pure artifact text (built in
// lib/shareArtifacts.ts) and react to the outcome; all feature detection and
// window plumbing lives here so call sites can't drift apart again.
//
// Deliberate exception: ShareWithFamilyButton keeps its mailto: fallback —
// that flow is explicitly email-shaped (The Family Table) and documented as
// such in the component.

export type ShareOutcome =
  // navigator.share resolved — the user picked an app from the sheet.
  | "shared"
  // The user dismissed the native sheet; not a failure, do nothing loud.
  | "cancelled"
  // No native sheet (or it failed) — a wa.me tab was opened instead.
  | "whatsapp"
  // Nothing worked: no native share and the wa.me window was blocked/threw.
  | "failed";

export type ShareNightObjectInput = {
  title: string;
  // The WhatsApp-first artifact text from lib/shareArtifacts.ts.
  text: string;
  // Absolute URL — callers resolve relative paths against their origin first.
  url: string;
};

// Injectable seams so the flow is unit-testable without a browser: `nav`
// defaults to the real navigator, `openWindow` to window.open (which returns
// null when a popup blocker eats the tab — surfaced as "failed").
export type ShareSheetDeps = {
  nav?: { share?: (data: { title: string; text: string; url: string }) => Promise<void> };
  openWindow?: (href: string) => unknown;
};

export async function shareNightObject(
  input: ShareNightObjectInput,
  deps: ShareSheetDeps = {},
): Promise<ShareOutcome> {
  const nav = deps.nav ?? (typeof navigator === "undefined" ? undefined : navigator);
  const openWindow =
    deps.openWindow ??
    ((href: string) =>
      typeof window === "undefined" ? null : window.open(href, "_blank", "noopener,noreferrer"));

  if (typeof nav?.share === "function") {
    try {
      await nav.share({ title: input.title, text: input.text, url: input.url });
      return "shared";
    } catch (error) {
      if (isUserCancelledShare(error)) return "cancelled";
      // Real share failure — fall through to the wa.me fallback below.
    }
  }

  try {
    const opened = openWindow(whatsappShareHref(input.text, input.url));
    return opened ? "whatsapp" : "failed";
  } catch {
    return "failed";
  }
}
