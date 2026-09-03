import { describe, it, expect } from "vitest";

import { filterCommands, scoreCommand } from "@/components/command/commandFilter";
import { commands } from "@/components/command/commands";
import type { Command } from "@/components/command/types";

// Minimal fixtures so ranking assertions are deterministic and independent of
// the real registry's exact contents.
const noop = () => {};
const fixtures: Command[] = [
  { id: "map", label: "Map", keywords: ["explore"], group: "Navigate", run: noop },
  { id: "pubs", label: "Pubs", keywords: ["leaderboard", "map view"], group: "Navigate", run: noop },
  { id: "theme", label: "Toggle theme", keywords: ["dark", "light"], group: "Actions", run: noop },
];

describe("filterCommands", () => {
  it("returns every command (original order) for an empty query", () => {
    const out = filterCommands(fixtures, "");
    expect(out).toHaveLength(fixtures.length);
    expect(out.map((c) => c.id)).toEqual(["map", "pubs", "theme"]);
  });

  it("treats a whitespace-only query as empty", () => {
    expect(filterCommands(fixtures, "   ")).toHaveLength(fixtures.length);
  });

  it("matches by label (case-insensitive)", () => {
    const out = filterCommands(fixtures, "PUB");
    expect(out.map((c) => c.id)).toEqual(["pubs"]);
  });

  it("matches by keyword when the label doesn't contain the query", () => {
    const out = filterCommands(fixtures, "dark");
    expect(out.map((c) => c.id)).toEqual(["theme"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterCommands(fixtures, "zzzznope")).toEqual([]);
  });

  it("ranks a label match above a keyword-only match", () => {
    // "map" is the Map command's label but only a keyword ("map view") on Pubs.
    const out = filterCommands(fixtures, "map");
    expect(out.map((c) => c.id)).toEqual(["map", "pubs"]);
  });

  it("ranks an exact label above a prefix above a substring", () => {
    const items: Command[] = [
      { id: "sub", label: "unplanned", group: "Actions", run: noop },
      { id: "exact", label: "plan", group: "Actions", run: noop },
      { id: "prefix", label: "planner", group: "Actions", run: noop },
    ];
    expect(filterCommands(items, "plan").map((c) => c.id)).toEqual(["exact", "prefix", "sub"]);
  });

  it("keeps registry order for equal scores (stable sort)", () => {
    const items: Command[] = [
      { id: "a", label: "Alpha route", group: "Navigate", run: noop },
      { id: "b", label: "Beta route", group: "Navigate", run: noop },
    ];
    // Both are pure substring matches for "route" → same score → input order.
    expect(filterCommands(items, "route").map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("supports subsequence (fuzzy) matches on the label", () => {
    // "tgt" is a subsequence of "Toggle theme" (T…g…t) but not a substring.
    const out = filterCommands(fixtures, "tgt");
    expect(out.map((c) => c.id)).toContain("theme");
  });
});

describe("scoreCommand", () => {
  it("scores an exact label match highest and a non-match at zero", () => {
    const map = fixtures[0]!;
    expect(scoreCommand(map, "map")).toBeGreaterThan(scoreCommand(map, "explore"));
    expect(scoreCommand(map, "nomatch")).toBe(0);
  });
});

describe("real command registry", () => {
  it("returns all registered commands for an empty query", () => {
    expect(filterCommands(commands, "")).toHaveLength(commands.length);
  });

  it("still reaches /pubs for the query a reader types for it", () => {
    // The label is "Chains" (captain 2026-08-17), so the word a reader types
    // has to be carried by the keywords or the destination is unreachable.
    const matches = filterCommands(commands, "pubs");
    const pubs = matches.find((command) => command.id === "nav-pubs");
    expect(pubs, "nav-pubs survives the filter for \"pubs\"").toBeTruthy();

    let navigated: string | null = null;
    pubs?.run({
      navigate: (href: string) => {
        navigated = href;
      },
      close: () => {},
      toggleTheme: () => {},
    });
    expect(navigated).toBe("/pubs");
    expect(filterCommands(commands, "menus").map((c) => c.id)).toContain(
      "nav-pubs",
    );
  });

  it("has a unique id per command", () => {
    const ids = commands.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every navigation command points at an absolute in-app path", () => {
    // Record paths navigated to by each command.
    const recordedPaths: Record<string, string> = {};

    for (const command of commands) {
      // Sanity: no dead relative hrefs slipped into the registry.
      expect(command.label.length).toBeGreaterThan(0);

      // Execute navigation commands and record the paths via a recording context.
      if (command.group === "Navigate" || (command.group === "Actions" && command.id !== "action-toggle-theme")) {
        const recordingContext = {
          navigate: (href: string) => {
            recordedPaths[command.id] = href;
          },
          close: () => {},
          toggleTheme: () => {},
        };
        command.run(recordingContext);
      }
    }

    // Verify all recorded paths are absolute (start with "/") in-app routes.
    for (const path of Object.values(recordedPaths)) {
      expect(path).toMatch(/^\//);
    }

    // Verify the expected navigation commands recorded the expected paths.
    expect(recordedPaths["nav-map"]).toBe("/map");
    expect(recordedPaths["nav-pubs"]).toBe("/pubs");
    expect(recordedPaths["nav-social"]).toBe("/social");
    expect(recordedPaths["nav-discover"]).toBe("/social?tab=discover");
    expect(recordedPaths["nav-borough"]).toBe("/borough");
    expect(recordedPaths["nav-crawls"]).toBe("/crawls");
    expect(recordedPaths["nav-rounds"]).toBe("/rounds");
    expect(recordedPaths["nav-messages"]).toBe("/messages");
    expect(recordedPaths["nav-activity"]).toBe("/activity");
    expect(recordedPaths["nav-profile"]).toBe("/u/you");
    expect(recordedPaths["action-pint-drop"]).toBe("/map?log=1");
    expect(recordedPaths["action-start-plan"]).toBe("/plan");
    expect(recordedPaths["action-build-crawl"]).toBe("/map");
  });
});
