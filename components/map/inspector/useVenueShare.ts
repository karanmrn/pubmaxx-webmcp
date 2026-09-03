import { useCallback, useState } from "react";

import { formatPriceDay } from "@/lib/communityPrice";
import { buildVenueShareText } from "@/lib/shareArtifacts";
import { shareNightObject } from "@/lib/shareSheet";
import { venueMapUrl } from "@/lib/venueMapUrl";
import type { ShareFeedback } from "@/lib/venueShare";
import type { Venue } from "@/lib/venues";
import { isPubVenue } from "@/lib/venueKindFilters";

/**
 * Optional people-logged pint already on the map-authority signal (merged
 * pint-drop + corroborated community price). Call sites must not pass a
 * sheet-only uncorroborated report — that figure has not earned the pin.
 */
export type VenueShareLoggedPint = {
  priceGbp: number | null | undefined;
  /** Epoch ms of the observation supplying priceGbp. */
  atMs: number | null | undefined;
};

export function useVenueShare(
  venue: Venue,
  loggedPint: VenueShareLoggedPint | null = null,
) {
  const [shareFeedback, setShareFeedback] = useState<ShareFeedback | null>(null);
  const currentShareFeedback =
    shareFeedback?.venueId === venue.id ? shareFeedback : null;

  const shareVenue = useCallback(async () => {
    if (typeof window === "undefined") return;
    const url = new URL(venueMapUrl(venue.id), window.location.origin).toString();
    const title = venue.name;
    const setShareStatus = (tone: ShareFeedback["tone"], text: string) => {
      setShareFeedback({ venueId: venue.id, tone, text });
    };

    const pub = isPubVenue(venue);
    const atMs = loggedPint?.atMs;
    const loggedDay =
      pub && typeof atMs === "number" && Number.isFinite(atMs)
        ? formatPriceDay(atMs)
        : "";
    const loggedPintGbp =
      pub &&
      loggedDay &&
      typeof loggedPint?.priceGbp === "number" &&
      Number.isFinite(loggedPint.priceGbp)
        ? loggedPint.priceGbp
        : null;

    setShareFeedback(null);
    // Native sheet first, wa.me fallback — the shared night-object flow.
    const outcome = await shareNightObject({
      title,
      text: buildVenueShareText({
        name: title,
        cheapestPintGbp: pub ? venue.cheapestPrice : null,
        loggedPintGbp,
        loggedDay: loggedPintGbp !== null ? loggedDay : null,
      }),
      url,
    });
    if (outcome === "shared" || outcome === "cancelled") return;
    if (outcome === "whatsapp") {
      setShareStatus("ok", "Opened WhatsApp to share the link.");
      return;
    }
    // Neither the sheet nor WhatsApp worked — last resort is the clipboard.
    const nav = typeof navigator === "undefined" ? undefined : navigator;
    if (!nav?.clipboard?.writeText) {
      setShareStatus("error", "Sharing and clipboard are unavailable. Copy the page URL.");
      return;
    }
    try {
      await nav.clipboard.writeText(url);
      setShareStatus("ok", "Share failed, but the link was copied.");
    } catch {
      setShareStatus("error", "Couldn't copy the link. Copy it from your browser bar.");
    }
  }, [venue, loggedPint]);

  return { currentShareFeedback, shareVenue };
}
