import { describe, it, expect } from "vitest";

import { landmarks, type LandmarkImage } from "@/lib/landmarks";
import { buildLandmarkCredit } from "@/lib/landmarkCredit";

// The compliant-attribution obligation for Wikimedia Commons landmark photos
// (docs/IMAGE_RIGHTS_AUDIT_2026-07-21.md finding 2): every rendered Commons
// image must carry author + licence + a link to the file page, not just the
// platform name.

describe("landmark image attribution data", () => {
  const withPhotos = landmarks.filter((l) => l.image);

  it("every landmark photo carries the Wikimedia platform credit", () => {
    expect(withPhotos.length).toBeGreaterThan(0);
    for (const landmark of withPhotos) {
      expect(landmark.image!.credit, `${landmark.id} credit`).toBe("Wikimedia Commons");
    }
  });

  it("every landmark photo carries compliant author + licence + file-page link", () => {
    // Backfilled from the committed Commons attribution table. If a new landmark
    // is added without re-running the enrich script, this fails loudly rather
    // than shipping an unattributed CC image.
    for (const landmark of withPhotos) {
      const image = landmark.image!;
      expect(image.author, `${landmark.id} author`).toBeTruthy();
      expect(image.licenseShortName, `${landmark.id} licence`).toBeTruthy();
      expect(image.sourcePageUrl, `${landmark.id} file page`).toMatch(
        /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/,
      );
    }
  });
});

describe("buildLandmarkCredit", () => {
  const base: LandmarkImage = {
    url: "https://commons.wikimedia.org/wiki/Special:FilePath/Example.jpg?width=800",
    credit: "Wikimedia Commons",
  };

  it("builds a full attributed line when author + licence + file page are present", () => {
    const credit = buildLandmarkCredit({
      ...base,
      author: "Jane Photographer",
      licenseShortName: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Example.jpg",
    });
    expect(credit.kind).toBe("attributed");
    if (credit.kind !== "attributed") throw new Error("expected attributed");
    expect(credit.author).toBe("Jane Photographer");
    expect(credit.licence).toEqual({
      text: "CC BY-SA 4.0",
      href: "https://creativecommons.org/licenses/by-sa/4.0",
    });
    expect(credit.via).toEqual({
      text: "Wikimedia Commons",
      href: "https://commons.wikimedia.org/wiki/File:Example.jpg",
    });
  });

  it("renders the licence as plain text (no link) for a public-domain file", () => {
    const credit = buildLandmarkCredit({
      ...base,
      author: "Old Uploader",
      licenseShortName: "Public domain",
      licenseUrl: "",
      sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Example.jpg",
    });
    if (credit.kind !== "attributed") throw new Error("expected attributed");
    expect(credit.licence).toEqual({ text: "Public domain" });
    expect(credit.licence?.href).toBeUndefined();
  });

  it("has no licence part when the licence name is absent", () => {
    const credit = buildLandmarkCredit({ ...base, author: "Someone" });
    if (credit.kind !== "attributed") throw new Error("expected attributed");
    expect(credit.licence).toBeNull();
  });

  it("falls back to a platform-only credit when the author is unknown", () => {
    const credit = buildLandmarkCredit({
      ...base,
      sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Example.jpg",
    });
    expect(credit.kind).toBe("platform");
    if (credit.kind !== "platform") throw new Error("expected platform");
    expect(credit.via).toEqual({
      text: "Wikimedia Commons",
      href: "https://commons.wikimedia.org/wiki/File:Example.jpg",
    });
  });

  it("omits the file-page link when no source page is known", () => {
    const credit = buildLandmarkCredit(base);
    if (credit.kind !== "platform") throw new Error("expected platform");
    expect(credit.via).toEqual({ text: "Wikimedia Commons" });
    expect(credit.via.href).toBeUndefined();
  });
});
