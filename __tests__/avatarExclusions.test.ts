import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { redactFamilyTableEntries } from "@/lib/ledger";
import { buildSpillPreview } from "@/lib/spillPreview";

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

function expectNoAvatarSurface(source: string, label: string): void {
  expect(source, label).not.toContain("HandleAvatar");
  expect(source, label).not.toContain("avatarResolve");
  expect(source, label).not.toContain("/api/avatar/");
  expect(source, label).not.toMatch(/\bavatarUrl\b/);
}

describe("avatar WP3 exclusions (PRD anti-goals)", () => {
  it("ledger redaction surfaces never expose served avatars", () => {
    const ledgerPage = read("app/ledger/[id]/page.tsx");
    expectNoAvatarSurface(ledgerPage, "ledger page");

    const redacted = redactFamilyTableEntries([
      {
        id: "drop-1",
        createdAt: "2024-01-01T00:00:00.000Z",
        dateLabel: "1 January 2024",
        handle: "secretpub",
        headline: "A pint",
        note: "quiet corner",
        priceLabel: "£4.50",
        era: "2024",
        provenance: "contributor",
      },
    ]);
    expect(redacted[0].handle).toBe("S.");
    expect(redacted[0]).not.toHaveProperty("avatarUrl");
  });

  it("anonymous spills keep initials only, never a served avatar URL", () => {
    const preview = buildSpillPreview({
      handle: "hush",
      visibility: "anonymous",
      price: "5.50",
      note: "",
      withWho: "",
      drink: "pint",
      era: "",
      venueName: "The Lamb",
      hasPhoto: false,
    });
    expect(preview.shownHandle).toBe("@a PUBMAXXER");
    expect(preview).not.toHaveProperty("avatarUrl");
    expect(preview.initial.length).toBe(1);

    const spillPreview = read("lib/spillPreview.ts");
    expect(spillPreview).not.toContain("avatarUrl");
    expect(spillPreview).not.toContain("HandleAvatar");
  });

  it("NightCrawlMode crew free-text names stay avatar-free", () => {
    expectNoAvatarSurface(read("components/plan/NightCrawlMode.tsx"), "NightCrawlMode");
  });

  it("public plan invite pages stay avatar-free", () => {
    expectNoAvatarSurface(read("app/invite/[token]/page.tsx"), "plan invite page");
    expectNoAvatarSurface(read("components/plan/InvitePageView.tsx"), "InvitePageView");
  });

  it("night-story public surfaces stay avatar-free", () => {
    const nightMemoryStore = read("lib/nightMemoryStore.ts");
    expect(nightMemoryStore).toContain("function safeNightStory");
    expect(nightMemoryStore).not.toMatch(/\bavatarUrl\b/);
    expectNoAvatarSurface(read("components/profile/NightMemoryStudio.tsx"), "NightMemoryStudio");
  });
});
