import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/font/google", () => {
  const face = () => ({ className: "font-mock", variable: "--font-mock" });
  return {
    Space_Grotesk: face,
    Inter: face,
    JetBrains_Mono: face,
  };
});

import { metadata } from "@/app/layout";

function collectIconUrls(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectIconUrls);
  if (value && typeof value === "object" && "url" in value) {
    return collectIconUrls(value.url);
  }
  return [];
}

const manifestPath = resolve(process.cwd(), "public/manifest.webmanifest");
const appleTouchIcon = resolve(process.cwd(), "public/apple-touch-icon-v2.png");
const currentAppleTouchIcon = resolve(process.cwd(), "public/apple-touch-icon-x.png");

describe("root icon cache-busting metadata", () => {
  it("declares versioned favicon links and an explicit versioned Apple touch icon", () => {
    const metadataIconUrls = Object.values(metadata.icons ?? {}).flatMap(
      collectIconUrls,
    );

    expect(metadataIconUrls).toEqual(
      expect.arrayContaining([
        "/favicon.ico?v=2",
        "/favicon-x.svg?v=2",
        "/icon-x-192.png?v=2",
        "/icon-x-512.png?v=2",
        "/apple-touch-icon-v2.png",
      ]),
    );
    expect(
      metadataIconUrls.every(
        (url) => url.includes("?v=2") || url === "/apple-touch-icon-v2.png",
      ),
    ).toBe(true);
  });

  it("versions every manifest icon source", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      icons: Array<{ src: string }>;
    };

    expect(manifest.icons.length).toBeGreaterThan(0);
    expect(manifest.icons.every(({ src }) => src.includes("?v=2"))).toBe(true);
  });

  it("keeps the renamed Apple touch icon byte-identical", () => {
    expect(readFileSync(appleTouchIcon)).toEqual(
      readFileSync(currentAppleTouchIcon),
    );
  });
});
