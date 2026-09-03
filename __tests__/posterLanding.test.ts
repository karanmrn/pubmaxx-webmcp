import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sanitizeEvent } from "@/lib/analyticsEvents";
import { securityProxy } from "@/proxy";
import {
  clearPosterLandingSession,
  isPosterLandingArrival,
  isPosterLandingSrc,
  posterLandingOrientation,
  posterNearHref,
  POSTER_LANDING_SESSION_KEY,
  POSTER_LANDING_SRC,
  readPosterLandingSession,
  rememberPosterLandingSession,
  shouldKeepPosterLandingParam,
} from "@/lib/posterLanding";

const homePage = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");
const proxySource = readFileSync(join(process.cwd(), "proxy.ts"), "utf8");
const nearClient = readFileSync(
  join(process.cwd(), "components/nearme/NearPageClient.tsx"),
  "utf8",
);
const posterNote = readFileSync(
  join(process.cwd(), "components/nearme/PosterLandingNote.tsx"),
  "utf8",
);
const posterSpec = readFileSync(
  join(process.cwd(), "docs/growth/POSTER_SPEC.md"),
  "utf8",
);

describe("poster landing redirect helpers", () => {
  it("accepts only the closed poster source", () => {
    expect(isPosterLandingSrc(POSTER_LANDING_SRC)).toBe(true);
    expect(isPosterLandingSrc("poster")).toBe(true);
    expect(isPosterLandingSrc("Poster")).toBe(false);
    expect(isPosterLandingSrc("landing")).toBe(false);
    expect(isPosterLandingSrc(null)).toBe(false);
    expect(isPosterLandingSrc(undefined)).toBe(false);
  });

  it("keeps src and utm_* query keys only", () => {
    expect(shouldKeepPosterLandingParam("src")).toBe(true);
    expect(shouldKeepPosterLandingParam("utm_source")).toBe(true);
    expect(shouldKeepPosterLandingParam("utm_campaign")).toBe(true);
    expect(shouldKeepPosterLandingParam("patch")).toBe(false);
    expect(shouldKeepPosterLandingParam("q")).toBe(false);
    expect(shouldKeepPosterLandingParam("note")).toBe(false);
  });

  it("builds /near with src=poster and preserved utm tags", () => {
    expect(posterNearHref({ src: "poster" })).toBe("/near?src=poster");
    expect(
      posterNearHref({
        src: "poster",
        utm_source: "bar-qr",
        utm_medium: "poster",
        junk: "drop-me",
      }),
    ).toBe("/near?src=poster&utm_source=bar-qr&utm_medium=poster");

    const params = new URLSearchParams(
      "src=poster&utm_campaign=soho&fbclid=tracked",
    );
    expect(posterNearHref(params)).toBe(
      "/near?src=poster&utm_campaign=soho",
    );
  });

  it("pins src=poster even when the inbound record omitted it", () => {
    expect(posterNearHref({ utm_source: "mat" })).toBe(
      "/near?utm_source=mat&src=poster",
    );
  });
});

describe("poster landing orientation", () => {
  it("ships one honest VOICE-clean orientation line", () => {
    const line = posterLandingOrientation();
    expect(line).toBe(
      "You scanned a pub poster. Compare listed pint prices near you, cheapest first.",
    );
    expect(line).not.toMatch(/—|–/);
    expect(line).not.toMatch(/!/);
    expect(line.toLowerCase()).not.toMatch(
      /experience|discover|seamless|curated|journey|partners?/,
    );
  });

  it("the proxy redirects poster arrivals through posterNearHref", () => {
    // The decision moved out of the home RSC when `/` became a prerendered
    // document: reading `?src=` there is per-request work, and a prerendered
    // page is handed an empty query. The proxy sees the real one.
    expect(proxySource).toMatch(/from "@\/lib\/posterLanding"/);
    expect(proxySource).toMatch(/isPosterLandingSrc/);
    expect(proxySource).toMatch(/posterNearHref/);
    expect(homePage).not.toMatch(/posterNearHref/);
  });

  it("sends a real poster arrival to /near and leaves an ordinary visit alone", () => {
    const scanned = securityProxy(
      new NextRequest(
        "https://pubmaxxing.com/?src=poster&utm_source=camden&junk=1",
        { headers: { host: "pubmaxxing.com" } },
      ),
    );
    expect(scanned.status).toBe(307);
    expect(scanned.headers.get("location")).toBe(
      "https://pubmaxxing.com/near?src=poster&utm_source=camden",
    );

    for (const url of [
      "https://pubmaxxing.com/",
      "https://pubmaxxing.com/?src=notposter",
      // The redirect belongs to the landing alone; no other route inherits it.
      "https://pubmaxxing.com/map?src=poster",
    ]) {
      expect(
        securityProxy(
          new NextRequest(url, { headers: { host: "pubmaxxing.com" } }),
        ).status,
        url,
      ).toBe(200);
    }
  });

  it("near page mounts the poster orientation note from src", () => {
    expect(nearClient).toMatch(/PosterLandingNote/);
    expect(nearClient).toMatch(/searchParams\.get\("src"\)/);
    expect(nearClient).toMatch(/clearPosterLandingSession/);
    expect(posterNote).toMatch(/posterLandingOrientation/);
    expect(posterNote).toMatch(/clearPosterLandingSession/);
    expect(posterNote).toMatch(/trackEvent\("poster_landing"\)/);
  });

  it("spec points the printed QR at /?src=poster landing on /near", () => {
    expect(posterSpec).toMatch(/\/\?src=poster/);
    expect(posterSpec).toMatch(/\/near/);
    expect(posterSpec).toMatch(/utm_\*/);
  });
});

describe("poster_landing analytics", () => {
  it("registers a closed no-prop event", () => {
    expect(sanitizeEvent("poster_landing")).toEqual({
      name: "poster_landing",
      props: {},
    });
    expect(sanitizeEvent("poster_landing", { note: "free text" })).toEqual({
      name: "poster_landing",
      props: {},
    });
    expect(sanitizeEvent("poster_landing", { src: "poster" })).toEqual({
      name: "poster_landing",
      props: {},
    });
  });
});

describe("poster landing session flag", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("remembers and reads a same-tab session flag", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });

    expect(readPosterLandingSession()).toBe(false);
    expect(isPosterLandingArrival(null)).toBe(false);
    rememberPosterLandingSession();
    expect(store.get(POSTER_LANDING_SESSION_KEY)).toBe("1");
    expect(readPosterLandingSession()).toBe(true);
    expect(isPosterLandingArrival(null)).toBe(true);
    expect(isPosterLandingArrival("poster")).toBe(true);
  });

  it("clears a stale session so organic /near visits are not poster-oriented", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });

    rememberPosterLandingSession();
    expect(isPosterLandingArrival(null)).toBe(true);

    clearPosterLandingSession();
    expect(store.has(POSTER_LANDING_SESSION_KEY)).toBe(false);
    expect(readPosterLandingSession()).toBe(false);
    expect(isPosterLandingArrival(null)).toBe(false);
    expect(isPosterLandingArrival("poster")).toBe(true);
  });
});
