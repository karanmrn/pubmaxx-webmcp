import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pubMap = readFileSync(join(process.cwd(), "components/PubMap.tsx"), "utf8");
const mobileShell = readFileSync(
  join(process.cwd(), "components/mobile/MobileMapShell.tsx"),
  "utf8",
);
// The sheet title table moved to lib/mobileShell.ts so a node test can hold a
// chrome title apart from the line its body prints (MAP_SHEET_TITLES).
const sheetTitles = readFileSync(
  join(process.cwd(), "lib/mobileShell.ts"),
  "utf8",
);
const mobileCss = readFileSync(
  join(process.cwd(), "components/mobile/mobileMapShell.css"),
  "utf8",
);
const keyCss = readFileSync(
  join(process.cwd(), "components/map/mapKey.css"),
  "utf8",
);
const conciergeCss = readFileSync(
  join(process.cwd(), "components/map/mapConciergeAsk.css"),
  "utf8",
);

describe("mobile map price chrome", () => {
  it("puts the complete key in the existing More sheet", () => {
    expect(pubMap).toContain('useState<"key" | "layers" | "prices" | "events" | "transit">("key")');
    expect(pubMap).toContain('<TabsTrigger value="key">Key</TabsTrigger>');
    expect(pubMap).toContain('<TabsContent value="key"');
    expect(pubMap).toContain("<MapKey");
    expect(sheetTitles).toContain('layers: "Map controls"');
    expect(mobileShell).toContain("MAP_SHEET_TITLES[sheetKind]");
    expect(pubMap).toContain('className="mobileMapControlTabs"');
    expect(mobileCss).toMatch(
      /\.mobileMapControlTabs\s*>\s*\[role="tab"\]\s*{[\s\S]*?flex:\s*1[\s\S]*?min-width:\s*0[\s\S]*?min-height:\s*44px/,
    );
    expect(keyCss).toMatch(
      /\.mapKeyDetails summary\s*{[\s\S]*?min-height:\s*44px/,
    );
    expect(mobileCss).toMatch(
      /body:has\(\.mobileSheetPortal\)[\s\S]*?\.maplibregl-ctrl-top-right\s*{[\s\S]*?visibility:\s*hidden/,
    );
  });

  it("adds no phone top-chrome control for the key", () => {
    expect(mobileShell.match(/aria-label="More map controls"/g)).toHaveLength(1);
  });

  it("keeps the remaining bottom actions clear of primary navigation", () => {
    expect(conciergeCss).toContain(
      "bottom: calc(var(--mobile-tab-clearance, 72px) + 28px)",
    );
  });
});
