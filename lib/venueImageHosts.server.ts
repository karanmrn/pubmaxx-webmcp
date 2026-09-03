import "server-only";

// Server-only allowlist of image hosts the /api/image-proxy may fetch (U4).
//
// The proxy exists because scraped-pub photos live on ~160 pub-website hosts —
// but "open-ended for the CSP" must not mean "open-ended for the proxy": a
// public proxy that fetches arbitrary hostnames is an SSRF primitive (a
// hostname the attacker controls can resolve to internal addresses; blocking
// IP literals alone doesn't help). So the proxy only fetches hosts that
// actually appear in the app's OWN committed datasets — the attacker can't
// influence that set without a reviewed PR.
//
// Built lazily once per process from the same data files the UI reads.

import fs from "node:fs";
import path from "node:path";

import {
  VENUE_IMAGE_HOST_PHOTO_FIELD_FILE,
  VENUE_IMAGE_HOST_WHOLE_FILE_SCAN_FILES,
} from "@/lib/venueImageHostFiles.mjs";

// pint_prices_app_dataset.json is NOT scanned whole: alongside the venue
// photo field it also carries ~hundreds of third-party pub `website`,
// `booking_link`, and `pub_url`/`constructed_pub_url`/`borough_urls` fields
// (plus www.pint-prices.com itself). Those are not app-served image content,
// so a raw-text regex scan of this file would allowlist ~439 pub-website
// hosts for the proxy — turning it into a much broader SSRF surface than
// intended. Only `image_url` (venue.imageUrl, the /pubs card photo — largely
// Google Places photos on lh3.googleusercontent.com, plus scraped pub-site
// photo hosts) is an actual photo URL, so hosts are extracted from that field
// alone, via a real JSON parse rather than a text scan.
const PHOTO_URL_FIELDS = ["image_url"] as const;

let cached: Set<string> | null = null;

function hostnameOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function allowedVenueImageHosts(): Set<string> {
  if (cached) return cached;
  const hosts = new Set<string>();

  for (const rel of VENUE_IMAGE_HOST_WHOLE_FILE_SCAN_FILES) {
    try {
      const raw = fs.readFileSync(
        path.join(/* turbopackIgnore: true */ process.cwd(), rel),
        "utf8",
      );
      // Hostname extraction over the raw JSON is deliberate for these two
      // files: every https URL in them is app-served content, and this
      // avoids hardcoding each file's shape here.
      for (const match of raw.matchAll(/https:\/\/([a-z0-9][a-z0-9.-]*)/gi)) {
        hosts.add(match[1].toLowerCase());
      }
    } catch {
      // A missing data file just contributes no hosts — fail closed.
    }
  }

  try {
    const raw = fs.readFileSync(
      path.join(
        /* turbopackIgnore: true */ process.cwd(),
        VENUE_IMAGE_HOST_PHOTO_FIELD_FILE,
      ),
      "utf8",
    );
    const rows: unknown = JSON.parse(raw);
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        for (const field of PHOTO_URL_FIELDS) {
          const value = (row as Record<string, unknown>)[field];
          if (typeof value !== "string" || !value) continue;
          const host = hostnameOf(value);
          if (host) hosts.add(host);
        }
      }
    }
  } catch {
    // A missing/malformed data file just contributes no hosts — fail closed.
  }

  cached = hosts;
  return hosts;
}

/** Test-only: reset the memoised host set. */
export function __resetVenueImageHosts(): void {
  cached = null;
}
