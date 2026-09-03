import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const TONIGHT_CLIENT = join(process.cwd(), "app/tonight/TonightClient.tsx");

describe("/tonight desktop rail dedup (UI_UX_FIX_PRD #1)", () => {
  it("does not mount full Deals/Music lanes in tonightContext", () => {
    const source = readFileSync(TONIGHT_CLIENT, "utf8");

    const contextBlock = source.match(
      /<aside className="tonightContext"[\s\S]*?<\/aside>/,
    )?.[0];
    expect(contextBlock).toBeTruthy();
    expect(contextBlock).not.toContain("DealsTonightLane");
    expect(contextBlock).not.toContain("MusicTonightLane");
    expect(contextBlock).toContain("TonightOnTonightSummary");
  });

  it("keeps full Deals/Music lanes on phones only when grouping is on", () => {
    const source = readFileSync(TONIGHT_CLIENT, "utf8");

    expect(source).toContain("function mobileSecondaryLanes(");
    expect(source).toContain("tonightSecondaryLanes--mobile");
    expect(source).not.toContain("function placeSecondaryLanes(");
    expect(source).not.toContain("lanePlacement.above");
    expect(source).not.toContain("lanePlacement.below");
  });

  it("anchors the main list for the rail handoff", () => {
    const client = readFileSync(TONIGHT_CLIENT, "utf8");
    const summary = readFileSync(
      join(process.cwd(), "app/tonight/TonightOnTonightSummary.tsx"),
      "utf8",
    );

    expect(client).toContain('id="tonight-list"');
    expect(summary).toContain('href="#tonight-list"');
  });
});
