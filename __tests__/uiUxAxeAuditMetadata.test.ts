import { describe, expect, it } from "vitest";

describe("UI UX Axe audit metadata", () => {
  it.each(["light", "dark"] as const)("records validated %s theme metadata", async (colorScheme) => {
    const modulePath = "../scripts/lib/" + "uiUxAxeAuditMetadata.mjs";
    const metadata = await import(modulePath).catch(() => null);
    expect(metadata).not.toBeNull();
    if (!metadata) return;

    const validated = metadata.validateUiUxAxeColorScheme(colorScheme);
    expect(metadata.buildUiUxAxeAuditDocument("http://127.0.0.1:3000", validated, [])).toEqual({
      origin: "http://127.0.0.1:3000",
      colorScheme,
      results: [],
    });
  });

  it("rejects an unknown theme", async () => {
    const modulePath = "../scripts/lib/" + "uiUxAxeAuditMetadata.mjs";
    const metadata = await import(modulePath).catch(() => null);
    expect(metadata).not.toBeNull();
    if (!metadata) return;

    expect(() => metadata.validateUiUxAxeColorScheme("sepia")).toThrow(
      "UI_UX_AXE_COLOR_SCHEME must be light or dark",
    );
  });
});
