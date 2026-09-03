import { ImageResponse } from "next/og";

import { ogCardRateLimitedResponse } from "@/lib/ogCardRateLimit";
import { OG_CACHE_HEADERS } from "@/lib/ogBrand";
import { clampOgText, clampOgInt } from "@/lib/ogCardText";
import { formatSavedVenueCount } from "@/lib/savedListPresentation";

export const runtime = "nodejs";

const size = {
  width: 1200,
  height: 630,
};

const PAPER = "#12100c";
const CREAM = "#ece3d2";
const BRASS = "#d3a44a";
const RIVER = "#3f5566";

const serif = 'Georgia, "Times New Roman", serif';
const sans = 'Helvetica, "Helvetica Neue", Arial, sans-serif';

function ListGlyph() {
  return (
    <svg width="58" height="58" viewBox="0 0 58 58" fill="none">
      <path d="M13 12 H45 V46 H13 Z" stroke={PAPER} strokeWidth="3" fill="none" />
      <path d="M22 22 H39" stroke={PAPER} strokeWidth="3" strokeLinecap="round" />
      <path d="M22 29 H39" stroke={PAPER} strokeWidth="3" strokeLinecap="round" />
      <path d="M22 36 H33" stroke={PAPER} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export async function GET(request: Request) {
  const limited = await ogCardRateLimitedResponse(request, "og-list-card");
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const owner = clampOgText(searchParams.get("owner"), 32, "pubmaxxer");
  const list = clampOgText(searchParams.get("list"), 54, "London saved list");
  const venueCount = clampOgInt(
    searchParams.get("venues") ?? searchParams.get("pubs"),
    0,
    999,
    0,
  );
  const followerParam = searchParams.get("followers");
  const followers = followerParam === "unavailable"
    ? null
    : clampOgInt(followerParam, 0, 999, 0);

  const venueLabel = formatSavedVenueCount(venueCount);
  const followerLabel = followers === null
    ? "Followers unavailable"
    : `${followers} follower${followers === 1 ? "" : "s"}`;
  const title = `@${owner}'s ${list}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: PAPER,
          color: CREAM,
          padding: 68,
          fontFamily: sans,
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 28,
            left: 28,
            right: 28,
            bottom: 28,
            border: `2px solid rgba(211,164,74,0.42)`,
            borderRadius: 6,
            display: "flex",
          }}
        />

        <svg
          width="1200"
          height="630"
          viewBox="0 0 1200 630"
          style={{ position: "absolute", top: 0, left: 0 }}
        >
          <path
            d="M-40 430 C 260 360, 360 520, 640 470 S 980 380, 1260 460"
            stroke={RIVER}
            strokeWidth="26"
            fill="none"
            opacity="0.25"
            strokeLinecap="round"
          />
          <path
            d="M140 506 C 280 440, 410 552, 560 492 S 790 364, 1040 436"
            stroke={BRASS}
            strokeWidth="3"
            strokeDasharray="2 14"
            strokeLinecap="round"
            fill="none"
            opacity="0.9"
          />
          <circle cx="242" cy="468" r="8" fill={BRASS} />
          <circle cx="560" cy="492" r="8" fill={BRASS} />
          <circle cx="1004" cy="426" r="8" fill={BRASS} />
        </svg>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            zIndex: 1,
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                width: 76,
                height: 76,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 14,
                background: BRASS,
                marginRight: 26,
              }}
            >
              <ListGlyph />
            </div>
            <div
              style={{
                fontFamily: serif,
                fontSize: 42,
                fontWeight: 700,
                letterSpacing: 0.5,
              }}
            >
              PUBMAXXING
            </div>
          </div>
          <div
            style={{
              fontFamily: serif,
              fontStyle: "italic",
              color: BRASS,
              fontSize: 24,
              letterSpacing: 2,
            }}
          >
            A Saved List
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", zIndex: 1 }}>
          <div
            style={{
              color: BRASS,
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 6,
              textTransform: "uppercase",
              marginBottom: 22,
              display: "flex",
            }}
          >
            Authored London venues
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: serif,
              maxWidth: 980,
              fontSize: title.length > 34 ? 76 : 92,
              lineHeight: 1.02,
              fontWeight: 700,
            }}
          >
            {title}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            zIndex: 1,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            <div
              style={{
                display: "flex",
                fontFamily: serif,
                fontStyle: "italic",
                color: CREAM,
                fontSize: 30,
              }}
            >
              {venueLabel}
            </div>
            <div
              style={{
                display: "flex",
                color: BRASS,
                fontSize: 26,
              }}
            >
              {followerLabel}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              color: BRASS,
              fontSize: 26,
              fontWeight: 700,
            }}
          >
            pubmaxxing.com
          </div>
        </div>
      </div>
    ),
    { ...size, headers: OG_CACHE_HEADERS },
  );
}
