import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("shared vibe chip skin", () => {
  it("TonightClient imports the shared VibeChips component", () => {
    const src = readFileSync(join(root, "app/tonight/TonightClient.tsx"), "utf8");
    expect(src).toContain('@/components/vibe/VibeChips');
    expect(src).toContain("VibeChips");
    expect(src).toContain("VibeChipButton");
    expect(src).toContain("VibeChipLink");
    expect(src).not.toContain("tonightVibeChip");
  });

  it("PalChat imports the shared VibeChips component", () => {
    const src = readFileSync(join(root, "components/pal/PalChat.tsx"), "utf8");
    expect(src).toContain('@/components/vibe/VibeChips');
    expect(src).toContain("VibeChips");
    expect(src).toContain("VibeChipButton");
    expect(src).not.toContain("palChatChip--vibe");
  });

  it("defines one canonical vibeChip class with the house stamp recipe", () => {
    const css = readFileSync(join(root, "components/vibe/vibeChips.css"), "utf8");
    expect(css).toMatch(/\.vibeChip\s*\{/);
    expect(css).toMatch(/min-height:\s*44px/);
    expect(css).not.toMatch(/text-transform:\s*uppercase/);
    expect(css).toMatch(/font-family:\s*var\(--font-display\)/);
    // Bungee has cap-height glyphs only, so the party face would render the
    // sentence-case label as ALL CAPS whatever text-transform said.
    expect(css).not.toMatch(/--font-party/);
    expect(css).toMatch(/\.vibeChip\[data-active="true"\]/);
  });
});
