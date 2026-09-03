import { statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: null, session: null }),
}));
vi.mock("@/components/nav/SiteNav", () => ({
  default: () => null,
}));
vi.mock("@/components/map/useWhatsOnTonight", () => ({
  useWhatsOnTonight: () => ({ rows: [], status: "ready", asOf: null }),
}));
vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
}));

import {
  PAL_MASCOT_SIZES,
  PAL_MASCOT_SLUGS,
  PAL_MASCOT_WEBP_512_BUDGET,
  palMascotSlug,
} from "@/lib/palMascotAssets.mjs";
import { PAL_VISUAL_MANIFEST } from "@/lib/pubPal";
import PalChat from "@/components/pal/PalChat";
import { PubPalMascot } from "@/components/pal/PubPalMascot";

function palChatMarkup(palHandoff: boolean): string {
  return renderToStaticMarkup(createElement(PalChat, { palHandoff }));
}

function pubPalImgs(html: string): string[] {
  return [...html.matchAll(/<img\b[^>]*>/g)]
    .map((match) => match[0])
    .filter((tag) => /alt="Pub Pal"/.test(tag));
}

describe("Pub Pal mascot on the chat surface", () => {
  it("renders the mascot image with alt Pub Pal when the Pal handoff is off", () => {
    const imgs = pubPalImgs(palChatMarkup(false));
    expect(imgs.length).toBeGreaterThan(0);
    expect(imgs[0]).toMatch(/width="\d+"/);
    expect(imgs[0]).toMatch(/height="\d+"/);
  });

  it("renders the same mascot image when the Pal handoff is on", () => {
    const html = palChatMarkup(true);
    const imgs = pubPalImgs(html);
    expect(imgs.length).toBeGreaterThan(0);
    expect(html).toContain("href=\"/pal\"");
    expect(imgs[0]).toMatch(/alt="Pub Pal"/);
  });
});

describe("PubPalMascot", () => {
  it("names Pub Pal, sizes the bitmap, and prefers webp with a png fallback", () => {
    const html = renderToStaticMarkup(
      createElement(PubPalMascot, { size: 32, circular: true }),
    );
    expect(html).toContain("<picture");
    expect(html).toContain('type="image/webp"');
    expect(html).toMatch(/<img\b[^>]*alt="Pub Pal"/);
    expect(html).toMatch(/width="32"/);
    expect(html).toMatch(/height="32"/);
    expect(html).toContain(".webp");
    expect(html).toContain(".png");
  });

  it("defers loading when the mascot sits offscreen", () => {
    const html = renderToStaticMarkup(
      createElement(PubPalMascot, { size: 48, circular: true, lazy: true }),
    );
    expect(html).toMatch(/loading="lazy"/);
  });
});

describe("public mascot renditions", () => {
  const palDir = join(process.cwd(), "public", "pal");

  it("ships the whole rendition set for every species with a master", () => {
    for (const slug of Object.values(PAL_MASCOT_SLUGS)) {
      for (const size of PAL_MASCOT_SIZES) {
        for (const name of [`${slug}-${size}`, `${slug}-avatar-${size}`]) {
          for (const ext of ["webp", "png"]) {
            expect(statSync(join(palDir, `${name}.${ext}`)).size).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("keeps every 512 webp square under the budget", () => {
    for (const slug of Object.values(PAL_MASCOT_SLUGS)) {
      const bytes = statSync(join(palDir, `${slug}-512.webp`)).size;
      expect(bytes).toBeGreaterThan(0);
      expect(bytes).toBeLessThan(PAL_MASCOT_WEBP_512_BUDGET);
    }
  });

  // The manifest is what a surface reads and the slug table is what the generator
  // writes, so a species named in one and not the other would render a broken
  // image or leave a shipped master unreachable.
  it("agrees with the visual manifest about which species are rendered", () => {
    for (const [species, entry] of Object.entries(PAL_VISUAL_MANIFEST)) {
      expect(entry.format).toBe(palMascotSlug(species) ?? "layered-svg");
    }
    for (const species of Object.keys(PAL_MASCOT_SLUGS)) {
      expect(Object.keys(PAL_VISUAL_MANIFEST)).toContain(species);
    }
  });
});
