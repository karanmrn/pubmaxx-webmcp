import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  NEAR_ME_LOCATION_OPTIONS,
  nearMeLocationFailure,
  nearMeLocationMessage,
} from "@/lib/nearMeLocation";

// The defect this locks: on a phone, a denied or dead Near me changed the chip
// to "Try near me" and said nothing else. The reason existed in state and only
// the desktop rail rendered it. Two halves are pinned here - the honest
// sentence per reason, and the phone actually putting it on screen.

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

const pubMap = read("components/PubMap.tsx");
const mobileShell = read("components/mobile/MobileMapShell.tsx");
const mobileCss = read("components/mobile/mobileMapShell.css");

describe("nearMeLocationFailure", () => {
  it("reads each browser error code as its own reason", () => {
    expect(nearMeLocationFailure({ code: 1 })).toBe("denied");
    expect(nearMeLocationFailure({ code: 2 })).toBe("position");
    expect(nearMeLocationFailure({ code: 3 })).toBe("timeout");
  });

  it("never claims a denial it was not told about", () => {
    expect(nearMeLocationFailure({ code: 99 })).toBe("position");
    expect(nearMeLocationFailure(null)).toBe("position");
    expect(nearMeLocationFailure(undefined)).toBe("position");
  });
});

describe("nearMeLocationMessage", () => {
  it("names the reason and a way on for every failure", () => {
    for (const failure of ["denied", "timeout", "position", "unsupported"] as const) {
      const message = nearMeLocationMessage(failure);
      expect(message.length, `${failure} has copy`).toBeGreaterThan(0);
      expect(message, `${failure} hands the reader somewhere to go`).toMatch(
        /Pick an area|pick an area/,
      );
      expect(message.includes("—"), `${failure} is em-dash free`).toBe(false);
    }
  });

  it("matches the /plan denial sentence, so both surfaces say one thing", () => {
    expect(nearMeLocationMessage("denied")).toBe(
      "Location access was denied. Pick an area or allow location in your browser settings.",
    );
    expect(read("components/plan/PlanIntake.tsx")).toContain("Location access was denied.");
  });

  it("tells a timeout apart from a denial", () => {
    expect(nearMeLocationMessage("timeout")).toBe(
      "We could not get your location in time. Try again or pick an area.",
    );
    expect(nearMeLocationMessage("timeout")).not.toBe(nearMeLocationMessage("denied"));
  });

  it("says so when the browser has no geolocation at all", () => {
    expect(nearMeLocationMessage("unsupported")).toBe(
      "This browser cannot share your location. Pick an area instead.",
    );
  });
});

describe("near me request options", () => {
  it("carries a finite timeout, so a failure arrives instead of hanging", () => {
    expect(Number.isFinite(NEAR_ME_LOCATION_OPTIONS.timeout)).toBe(true);
    expect(NEAR_ME_LOCATION_OPTIONS.timeout).toBeGreaterThan(0);
  });

  it("is the only options object either near me call passes", () => {
    const calls = pubMap.match(/navigator\.geolocation\.getCurrentPosition\(/g) ?? [];
    expect(calls.length, "geolocation calls in PubMap").toBeGreaterThanOrEqual(2);
    expect(
      (pubMap.match(/NEAR_ME_LOCATION_OPTIONS,\n\s*\);/g) ?? []).length,
      "both near me calls share one options object",
    ).toBe(2);
    expect(pubMap, "no bespoke near me options remain").not.toContain(
      "{ enableHighAccuracy: false, timeout: 7000, maximumAge: 60_000 }",
    );
  });

  it("maps every near me failure through the shared reasons", () => {
    expect(
      (pubMap.match(/nearMeLocationMessage\(nearMeLocationFailure\(error\)\)/g) ?? []).length,
    ).toBe(2);
    expect(pubMap).toContain('nearMeLocationMessage("unsupported")');
  });
});

describe("the phone shows the near me failure", () => {
  it("hands the message and its dismissal to the mobile shell", () => {
    expect(pubMap).toContain("nearMeError={nearbyError}");
    expect(pubMap).toContain("onDismissNearMeError={() => setNearbyError(null)}");
    expect(mobileShell).toContain("nearMeError: string | null");
  });

  it("announces it, the same as the desktop rail does", () => {
    expect(mobileShell).toContain('<div className="mobileMapNearMeAlert" role="alert">');
    expect(mobileShell).toContain("{nearMeError}");
    expect(read("components/map/ControlRail.tsx")).toContain('role="alert"');
  });

  it("offers the area picker as the way on", () => {
    expect(mobileShell).toContain("Pick an area");
    expect(mobileShell).toContain('onOverlayChange("choose-area")');
  });

  it("lets the reader clear the message", () => {
    expect(mobileShell).toContain('aria-label="Dismiss the Near me message"');
  });

  it("docks under the one top bar and keeps its controls thumb-sized", () => {
    const alert = mobileCss.match(/\.mobileMapNearMeAlert\s*{([^}]*)}/)?.[1] ?? "";
    expect(alert, ".mobileMapNearMeAlert rule present").not.toBe("");
    expect(alert).toMatch(/position:\s*fixed/);
    expect(alert).toMatch(
      /top:\s*calc\(var\(--mobile-map-chrome-h\) \+ 8px\)/,
    );
    // Same left/right boundary as every other stacked phone surface.
    expect(alert).toMatch(/left:\s*var\(--mobile-map-stack-left\)/);
    expect(alert).toMatch(/right:\s*var\(--mobile-map-stack-right\)/);
    for (const control of ["Area", "Dismiss"]) {
      const rule = mobileCss.match(new RegExp(`\\.mobileMapNearMeAlert${control}\\s*{([^}]*)}`))?.[1] ?? "";
      expect(rule, `.mobileMapNearMeAlert${control} rule present`).not.toBe("");
      expect(rule).toMatch(/min-height:\s*44px/);
    }
    const text = mobileCss.match(/\.mobileMapNearMeAlertText\s*{([^}]*)}/)?.[1] ?? "";
    expect(text).toMatch(/white-space:\s*normal/);
    expect(text, "a reason is never truncated").not.toMatch(/text-overflow:\s*ellipsis/);
  });

  it("stays out of the chrome grid, which the phone keeps at one bar", () => {
    // The chrome is ONE bar (design judgement 2026-08-01, finding 2.3), so a
    // row added inside it would put the reader back in front of a stack.
    const start = mobileShell.lastIndexOf('<div className="mobileMapChrome"');
    const end = mobileShell.indexOf("\n      </div>", start);
    expect(start, "the map chrome container").toBeGreaterThan(-1);
    expect(end, "its closing tag").toBeGreaterThan(start);
    const chrome = mobileShell.slice(start, end);
    expect(chrome, "the chrome still holds the top bar").toContain("mobileMapTopbar");
    expect(chrome, "the alert is a sibling, not a second row").not.toContain(
      "mobileMapNearMeAlert",
    );
  });
});
