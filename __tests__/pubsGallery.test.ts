import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { pubsCountLabel } from "@/components/pubs/PubsGallery";

const source = readFileSync(join(process.cwd(), "components/pubs/PubsGallery.tsx"), "utf8");
const css = readFileSync(join(process.cwd(), "components/pubs/pubsGallery.css"), "utf8");

describe("pubs gallery secondary surface", () => {
  it("does not present an incomplete venue read as an authoritative count", () => {
    expect(
      pubsCountLabel({
        matchingPubs: 3,
        filter: "all",
        zone: "all",
        page: 1,
        totalPages: 1,
        complete: false,
      }),
    ).toBe("3 pubs available · Some chain data is unavailable");
  });

  it("does not mount a gradient art tile when a pub has no photo", () => {
    expect(source).toContain("const hasPhoto = Boolean(pub.photoUrl);");
    expect(source).toContain('pubsCard--no-art');
    expect(source).toContain("hasPhoto ? (");
  });

  it("keeps borough chips inside the gallery viewport", () => {
    const jumpNav = css.match(/\.pubsJumpNav\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(jumpNav).toMatch(/min-width:\s*0/);
    expect(jumpNav).toMatch(/max-width:\s*100%/);
    expect(jumpNav).toMatch(/touch-action:\s*(?:auto|pan-x pan-y)/);
  });

  it("lets no-art cards use their content height", () => {
    expect(css).toMatch(/\.pubsCard--no-art\s*\{[^}]*grid-template-rows:\s*auto/);
  });
});
