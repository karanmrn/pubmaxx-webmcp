import { describe, expect, it } from "vitest";
import { boundedControl, masteryPointsFor, requiredText } from "@/convex/domain";
import {
  canTransitionMigration,
  shadowRecordHash,
} from "@/lib/convex/migration";
import { KEYLESS_CONVEX_FLAGS } from "@/lib/convex/contracts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Convex hybrid foundation", () => {
  it("keeps every capability on Supabase in keyless mode", () => {
    expect(new Set(Object.values(KEYLESS_CONVEX_FLAGS))).toEqual(
      new Set(["supabase"]),
    );
  });

  it("assigns mastery points on the server and never accepts drink quantity", () => {
    expect(masteryPointsFor("plan_completed")).toBe(25);
    expect(masteryPointsFor("heritage_read")).toBe(3);
    expect(Object.keys(KEYLESS_CONVEX_FLAGS)).not.toContain("drink_quantity");
  });

  it("bounds user-controlled personality and voice values", () => {
    expect(boundedControl(-10)).toBe(0);
    expect(boundedControl(52)).toBe(52);
    expect(boundedControl(120)).toBe(100);
    expect(() => boundedControl(Number.NaN)).toThrow();
    expect(requiredText("  Signal  ", 32)).toBe("Signal");
    expect(() => requiredText("", 32)).toThrow();
  });

  it("allows only forward migration states plus explicit rollback", () => {
    expect(canTransitionMigration("prepared", "running")).toBe(true);
    expect(canTransitionMigration("shadowing", "verified")).toBe(true);
    expect(canTransitionMigration("cut_over", "rolled_back")).toBe(true);
    expect(canTransitionMigration("cut_over", "prepared")).toBe(false);
  });

  it("produces stable shadow hashes independent of key order and timestamps", () => {
    const left = shadowRecordHash({ name: "Rook", updated_at: "old", nested: { b: 2, a: 1 } });
    const right = shadowRecordHash({ nested: { a: 1, b: 2 }, name: "Rook", updated_at: "new" });
    expect(left).toBe(right);
    expect(left).toHaveLength(64);
  });

  it("keeps correction, deletion, export, and Pal cleanup available at the Convex seam", () => {
    const commands = readFileSync(join(process.cwd(), "convex/commands.ts"), "utf8");
    const memories = readFileSync(join(process.cwd(), "convex/memories.ts"), "utf8");
    for (const contract of ["correctMemoryFromServer", "deleteMemoryFromServer", "deletePalFromServer"]) {
      expect(commands).toContain(contract);
    }
    expect(commands).toContain('ctx.db.query("palMemories")');
    expect(memories).toContain("exportMine");
    expect(memories).toContain("proposalPreferences");
  });
});
