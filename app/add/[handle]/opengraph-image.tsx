import { ImageResponse } from "next/og";

import { inviteCardModel } from "@/lib/inviteShare";
import { CrossingMark, OG_CACHE_HEADERS } from "@/lib/ogBrand";

// Share card for the crew-invite link (/add/[handle]). When a friend drops
// their add link in a group chat, this is the preview that lands. Before it
// existed the link fell back to the generic homepage card; now every share
// surface in the loop carries its own tailored card with the Crossing mark, in
// lockstep with the plan-invite and profile cards (the field-guide palette).
//
// Lightweight and I/O-free (no DB read) so the card renders for any handle,
// claimed or not — the copy comes from the pure inviteCardModel helper the page
// itself uses, so the preview and the page never drift.

export const runtime = "nodejs";
export const alt = "Add me to your lot on PUBMAXX";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PAPER = "#12100c"; // deep charcoal-green paper
const CREAM = "#ece3d2"; // warm cream ink
const CREAM_DIM = "#a99f8b"; // secondary ink
const BRASS = "#d3a44a"; // single accent

const serif = 'Georgia, "Times New Roman", serif';
const sans = 'Helvetica, "Helvetica Neue", Arial, sans-serif';

type PageProps = { params: Promise<{ handle: string }> };

export default async function Image({ params }: PageProps) {
  const { handle } = await params;
  const model = inviteCardModel(handle);

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
        {/* Hairline field-guide border */}
        <div
          style={{
            position: "absolute",
            top: 28,
            left: 28,
            right: 28,
            bottom: 28,
            border: "2px solid rgba(211,164,74,0.42)",
            borderRadius: 6,
            display: "flex",
          }}
        />

        {/* Header: Crossing-mark lockup + edition line */}
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
              <CrossingMark ink={PAPER} size={52} />
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
            {model.kicker}
          </div>
        </div>

        {/* Center: eyebrow + the invite headline */}
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
            You have been added
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: serif,
              maxWidth: 1000,
              fontSize: model.title.length > 26 ? 74 : 92,
              lineHeight: 1.02,
              fontWeight: 700,
            }}
          >
            {model.title}
          </div>
          <div
            style={{
              display: "flex",
              maxWidth: 900,
              marginTop: 26,
              fontSize: 28,
              lineHeight: 1.32,
              color: CREAM_DIM,
            }}
          >
            {model.sub}
          </div>
        </div>

        {/* Footer: call to action on the left, URL on the right */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            zIndex: 1,
          }}
        >
          <div
            style={{
              display: "flex",
              fontFamily: serif,
              fontStyle: "italic",
              color: CREAM,
              fontSize: 30,
            }}
          >
            {model.cta}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              color: BRASS,
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: 1,
            }}
          >
            <div
              style={{
                width: 46,
                height: 2,
                background: BRASS,
                marginRight: 18,
              }}
            />
            pubmaxxing.com
          </div>
        </div>
      </div>
    ),
    { ...size, headers: OG_CACHE_HEADERS },
  );
}
