import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const root = process.cwd();

function sourceFiles(directory: string): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(relative);
    return /\.(css|ts|tsx|js|jsx)$/.test(entry.name) ? [relative] : [];
  });
}

function read(relative: string): string {
  return readFileSync(join(root, relative), "utf8");
}

describe("mobile web polish source contracts", () => {
  test("has no legacy 100vh value in app or component source", () => {
    const legacyFiles = [...sourceFiles("app"), ...sourceFiles("components")]
      .filter((file) => read(file).includes("100vh"));

    expect(legacyFiles).toEqual([]);
  });

  test("keeps all text controls above the iOS zoom threshold through shared CSS", () => {
    const globals = read("app/globals.css");

    expect(globals).toMatch(/:where\(input, textarea, select\)\s*\{[\s\S]*?font-size:\s*max\(16px,\s*1em\)\s*!important;/);
  });

  test("makes shared controls and horizontal lanes safe for touch", () => {
    const globals = read("app/globals.css");
    expect(globals).toMatch(/:where\(button, \[role="button"\], \.pressable, a\[data-pressable\], \.planBtn\)\s*\{[\s\S]*?user-select:\s*none;[\s\S]*?-webkit-user-select:\s*none;/);

    const laneSources = [
      "app/discover/discover.css",
      "app/feed/feed.css",
      "app/pint-index/pint-index.css",
      "app/pal/pal.css",
      "components/drinks/categoryShowcase.css",
      "components/landing/landing.css",
      "components/map/mapToolbar.css",
      "components/map/tonightLane.css",
      "components/mobile/mobileMapShell.css",
      "components/pubs/pubsGallery.css",
    ];

    for (const file of laneSources) {
      expect(read(file), file).toMatch(
        /touch-action:\s*(?:pan-y|pan-x pan-y)|touch-pan-y/,
      );
    }
  });

  test("does not add text selection suppression outside controls", () => {
    const declarations = [...sourceFiles("app"), ...sourceFiles("components")]
      .flatMap((file) => read(file).match(/(?:-webkit-)?user-select\s*:\s*none\s*;/g)?.map(() => file) ?? []);

    expect(declarations).toEqual(expect.arrayContaining(["app/globals.css"]));
    expect(declarations).toEqual(expect.arrayContaining([
      // The crop frame owns a drag, so it suppresses selection. It moved out of
      // the profile page's stylesheet when the cropper got one of its own.
      "components/profile/profileImageCropper.css",
      "components/map/venueSheet.css",
    ]));
    expect(new Set(declarations)).toEqual(new Set([
      "app/globals.css",
      "app/messages/messages.css",
      "components/map/venueSheet.css",
      "components/profile/profileImageCropper.css",
    ]));
  });
});
