import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const boardTsx = readFileSync(
  join(process.cwd(), "components/profile/OutTonightBoard.tsx"),
  "utf8",
);
const profileTsx = readFileSync(
  join(process.cwd(), "app/u/[handle]/ProfilePageClient.tsx"),
  "utf8",
);
const beaconCss = readFileSync(
  join(process.cwd(), "components/profile/outTonightBeacon.css"),
  "utf8",
);

describe("OutTonightBoard (crew tonight slice 4)", () => {
  it("reads friends-gated check-ins through the viewer-scoped API", () => {
    expect(boardTsx).toMatch(/\/api\/check-ins\?viewer=/);
    expect(boardTsx).toMatch(/visibleCheckInsForViewer/);
    expect(boardTsx).not.toMatch(/scope=area/);
    expect(boardTsx).not.toMatch(/checkInStore/);
  });

  it("stays hidden without a viewer handle and names the lot board", () => {
    expect(boardTsx).toMatch(/kind:\s*"hidden"/);
    expect(boardTsx).toMatch(/Your lot tonight/);
    expect(boardTsx).toMatch(/Mutual follows only/);
  });

  it("links each row to the crew mate profile", () => {
    expect(boardTsx).toMatch(/href=\{`\/u\/\$\{encodeURIComponent\(row\.handle\)\}`\}/);
    expect(boardTsx).toMatch(/displayHandle/);
  });

  it("mounts on the signed-in You profile beside the out tonight toggle", () => {
    expect(profileTsx).toMatch(/import OutTonightBoard from "@\/components\/profile\/OutTonightBoard"/);
    expect(profileTsx).toMatch(/<OutTonightToggle handle=\{routeHandle\} \/>/);
    expect(profileTsx).toMatch(/<OutTonightBoard viewerHandle=\{routeHandle\} \/>/);
  });

  it("ships board list styles beside the beacon card tokens", () => {
    expect(beaconCss).toMatch(/\.beaconBoardList/);
    expect(beaconCss).toMatch(/min-height:\s*44px/);
  });

  it("empty state points to Find your lot instead of a dead end", () => {
    expect(boardTsx).toMatch(/Find your lot/);
    expect(boardTsx).toMatch(/href="\/social"/);
  });
});

describe("profiles search privacy (WP7)", () => {
  it("search route never selects private identity columns", () => {
    const searchRoute = readFileSync(
      join(process.cwd(), "app/api/profiles/search/route.ts"),
      "utf8",
    );
    expect(searchRoute).toMatch(/publicApiError/);
    expect(searchRoute).toMatch(/isLimited/);
    expect(searchRoute).toMatch(/toPublicMatch/);
    // Comment may mention email/DOB as excluded; the projection object must not.
    expect(searchRoute).toContain("id: profile.id");
    expect(searchRoute).toContain("handle: profile.handle");
    expect(searchRoute).not.toMatch(/dateOfBirth:|fullName:|gender:|email:/);
  });
});

