// What a cold page is allowed to parse before it paints.
//
// U2 of docs/plans/SITE_SPEED_2026-09-01.md. Two modules were in the eager
// graph for readers who would never reach them:
//
//  1. The ElevenLabs conversation SDK. Measured on production 2026-09-01: a
//     single 603 KB decoded chunk on /pal, 35% of that route's whole 1745 KB,
//     parsed before first paint. Voice is env-gated per deployment and the
//     availability probe already refuses to render anything voice-shaped until
//     it answers, so on a deployment with voice off nothing in it ever ran.
//  2. The command palette. Its provider is mounted at the ROOT on every route,
//     so the dialog, its command table, its filter and its stylesheet rode the
//     shared shell that a phone downloads to read the landing - for a
//     ⌘K affordance a phone has no key to reach.
//
// Both now load on the state change that used to render them, so behaviour is
// identical and only the moment of the download moves.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PERFORMANCE_BUDGETS } from "@/lib/performanceBudgets";

const REPO_ROOT = join(__dirname, "..");

function read(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), "utf8");
}

describe("the voice SDK loads when voice is on, and never before", () => {
  const gate = read("components/pubpal/PubPalVoice.tsx");
  const session = read("components/pubpal/PubPalVoiceSession.tsx");

  it("keeps the SDK out of the gate that every /pal reader mounts", () => {
    expect(gate).not.toContain("@elevenlabs/react");
    expect(gate).not.toContain("ConversationProvider");
  });

  it("puts it in the session module the gate fetches on demand", () => {
    expect(session).toContain('from "@elevenlabs/react"');
    expect(gate).toContain('import("@/components/pubpal/PubPalVoiceSession")');
    expect(gate).toContain("ssr: false");
  });

  it("leaves the tri-state where it was, so no answer changed", () => {
    // asking / unavailable / available, and the muted card beside them.
    expect(gate).toContain('"asking" | "available" | "unavailable"');
    expect(gate).toContain("PAL_VOICE_UNAVAILABLE_LINE");
    expect(gate).toContain("<PubPalVoiceSession");
  });

  it("is the ONLY module that may import the SDK", () => {
    // A second importer would put it back in somebody's eager graph.
    const importers = ["components/pal/PalExperience.tsx", "app/pal/page.tsx"];
    for (const file of importers) {
      expect(read(file), file).not.toContain("@elevenlabs/react");
    }
  });
});

describe("the command palette leaves the shared shell", () => {
  const provider = read("components/command/CommandPaletteProvider.tsx");

  it("fetches the dialog rather than importing it at the root", () => {
    expect(provider).toContain('dynamic(() => import("./CommandPalette")');
    expect(provider).not.toMatch(/^import CommandPalette from/m);
  });

  it("still renders nothing at all until it is open", () => {
    expect(provider).toContain("loading: () => null");
  });
});

describe("the ceiling records the removal", () => {
  it("ratchets /pal down, and raises nothing", () => {
    const pal = PERFORMANCE_BUDGETS.routes.find((route) => route.path === "/pal");
    // Seeded at 1800 against a 1745 measurement that included the SDK.
    expect(pal?.jsDecodedKB).toBeLessThanOrEqual(1300);
    expect(pal?.why).toContain("603");
  });
});
