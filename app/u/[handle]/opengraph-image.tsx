import { ImageResponse } from "next/og";

import { normalizeHandle } from "@/lib/profiles";
import { OG_CACHE_HEADERS } from "@/lib/ogBrand";
import { clampOgText } from "@/lib/ogCardText";

// Profile / Pint Passport OG share card. Lightweight — no DB read — so every
// /u/[handle] share gets a branded card even when the profile is empty.
// (Profile page is client-only; public stats aren't available here without
// pulling the pint-drops store.)

export const runtime = "nodejs";
export const alt = "Pint passport on PUBMAXXING";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PAPER = "#12100c";
const CREAM = "#ece3d2";
const CREAM_DIM = "#a99f8b";
const BRASS = "#d3a44a";

const serif = 'Georgia, "Times New Roman", serif';
const sans = 'Helvetica, "Helvetica Neue", Arial, sans-serif';

type PageProps = { params: Promise<{ handle: string }> };

export default async function Image({ params }: PageProps) {
  const { handle: raw } = await params;
  const handle = clampOgText(normalizeHandle(raw), 32, "you");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: PAPER,
          color: CREAM,
          fontFamily: sans,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div
              style={{
                fontSize: 22,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: BRASS,
                fontWeight: 700,
              }}
            >
              Pint passport
            </div>
            <div style={{ fontFamily: serif, fontSize: 64, fontWeight: 600, lineHeight: 1.05 }}>
              @{handle}
            </div>
            <div style={{ fontSize: 28, color: CREAM_DIM, marginTop: 8 }}>
              Pint passport on PUBMAXXING
            </div>
            <div style={{ fontSize: 24, color: CREAM_DIM, marginTop: 4 }}>
              Pubs · boroughs · beers · nights
            </div>
          </div>
          <div
            style={{
              border: `2px solid ${BRASS}`,
              color: BRASS,
              padding: "14px 18px",
              fontSize: 20,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              fontWeight: 700,
              transform: "rotate(-6deg)",
            }}
          >
            PUBMAXXING
          </div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            borderTop: `1px solid ${CREAM_DIM}`,
            paddingTop: 28,
            fontSize: 24,
            color: CREAM_DIM,
          }}
        >
          <span>Every pint stamps a page.</span>
          <span style={{ color: BRASS }}>pubmaxxing.com</span>
        </div>
      </div>
    ),
    { ...size, headers: OG_CACHE_HEADERS },
  );
}
