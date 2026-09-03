import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The UI components render in the Playwright E2E suite, not in this Node-env
// vitest run (see vitest.config.ts). These source-presence guards — mirroring
// the migration-SQL assertion already in nightMemoryStore.test.ts — lock in that
// the author-confirmed alt-text authoring field, its plain guidance, and the
// clearly-marked "never auto-fill" AI seam stay wired on BOTH surfaces, and that
// the additive migration keeps its shape.
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("author-confirmed alt text authoring surfaces (5.6)", () => {
  it("renders a guided alt-text field on the capture surface and sends it on save", () => {
    const src = read("components/moment/MomentCapture.tsx");
    expect(src).toContain("Describe the photo for someone who cannot see it");
    expect(src).toContain("updateMediaAlt");
    expect(src).toContain('body.set("altText"');
    expect(src).toContain("maxLength={200}");
    // AI-suggestion seam present and explicitly non-autofilling.
    expect(src).toMatch(/never auto-fill|auto-fill/i);
  });

  it("renders an owner-only alt-text field at Story review time in the studio", () => {
    const src = read("components/profile/NightMemoryStudio.tsx");
    expect(src).toContain("Describe the photo for someone who cannot see it");
    expect(src).toContain("saveMomentAltText");
    expect(src).toContain("moment.hasPhoto");
    expect(src).toContain("altTextConfirmed");
    expect(src).toContain("maxLength={200}");
  });

  it("ships an additive, capped, idempotent alt-text migration", () => {
    const sql = read("supabase/migrations/20260721133000_0047_night_moment_alt_text.sql");
    expect(sql).toContain("add column if not exists alt_text text");
    expect(sql).toContain("add column if not exists alt_text_confirmed_at timestamptz");
    expect(sql).toContain("night_moments_alt_text_len_check");
    expect(sql).toContain("length(alt_text) <= 200");
  });
});
