import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});

import { DEFAULT_PAL_DRAFT } from "@/lib/pubPal";
import { addMasteryEvent, createPubPal } from "@/lib/pubPalStore";

describe("Pub Pal mastery authority", () => {
  it("does not let a client award privileged mastery from a claimed source id", async () => {
    const ownerId = crypto.randomUUID();
    await createPubPal(ownerId, { ...DEFAULT_PAL_DRAFT, adultConfirmed: true, name: "Morrow" });
    await expect(addMasteryEvent(ownerId, { kind: "plan_completed", sourceId: crypto.randomUUID() })).resolves.toBeNull();
  });
});
