import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const mobileMapShellCss = readFileSync(
  resolve(process.cwd(), "components/mobile/mobileMapShell.css"),
  "utf8",
);
const mobileMapShellSource = readFileSync(
  resolve(process.cwd(), "components/mobile/MobileMapShell.tsx"),
  "utf8",
);
const pubMapSource = readFileSync(
  resolve(process.cwd(), "components/PubMap.tsx"),
  "utf8",
);
const pubMapCanvasSource = readFileSync(
  resolve(process.cwd(), "components/PubMapCanvas.tsx"),
  "utf8",
);

const firstVisitHideBlock =
  mobileMapShellCss.match(
    /body:has\(\.mapArrivalCard\) \.mobileMapUtilityCorner,[\s\S]*?display:\s*none;/,
  )?.[0] ?? "";

describe("mobile map first-visit presentation", () => {
  it("leaves only the top bar and First visit card", () => {
    expect(firstVisitHideBlock, "First visit hide block present").not.toBe("");
    expect(firstVisitHideBlock).toContain(".mobileMapChipRow");
    expect(firstVisitHideBlock).toContain(".mobilePlanActivation");
    expect(firstVisitHideBlock).toContain(".mobileMapUtilityCorner");
    expect(firstVisitHideBlock).toMatch(/display:\s*none/);
  });

  it("locks map and chrome interaction until the arrival choice", () => {
    expect(pubMapSource).toMatch(
      /<PubMapCanvas[\s\S]*?interactionLocked=\{mobileViewport && showMapArrivalCard\}/,
    );
    expect(pubMapSource).toMatch(
      /<MobileMapShell[\s\S]*?interactionLocked=\{showMapArrivalCard\}/,
    );
    expect(pubMapCanvasSource).toMatch(
      /className="mapCanvasWrap"[\s\S]*?inert=\{interactionLocked \|\| undefined\}/,
    );
    expect(mobileMapShellSource).toMatch(
      /className="mobileMapChrome"[\s\S]*?inert=\{interactionLocked \|\| undefined\}/,
    );
  });
});
