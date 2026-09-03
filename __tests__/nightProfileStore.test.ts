import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseRow = vi.hoisted(() => ({
  data: null as Record<string, unknown> | null,
  error: null as { message: string } | null,
}));

vi.mock("@/lib/supabase", () => ({
  requireSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => supabaseRow,
        }),
      }),
    }),
  }),
}));

import {
  __resetNightProfileStore,
  supabaseNightProfileStore,
} from "@/lib/nightProfileStore";

describe("supabaseNightProfileStore", () => {
  beforeEach(() => {
    __resetNightProfileStore();
    supabaseRow.data = null;
    supabaseRow.error = null;
  });

  it("reads legacy night_profiles rows that predate wetherspoonsPreferred", async () => {
    supabaseRow.data = {
      schema_version: 1,
      city_id: "london",
      night_area: null,
      daypart: "evening",
      party_type: "friends",
      group_size: null,
      budget: "standard",
      budget_limit_pence: null,
      zero_proof: false,
      atmosphere: [],
      food_needs: [],
      accessibility: [],
      transport_constraints: [],
      briefing_preferences: { muteAll: false, mutedAreas: [], mutedTopics: [] },
      voice_preference: "off",
      pub_pal_id: null,
      created_at: "2026-07-16T20:00:00.000Z",
      updated_at: "2026-07-16T20:05:00.000Z",
    };

    const profile = await supabaseNightProfileStore.get("owner-1");

    expect(profile).toMatchObject({
      cityId: "london",
      context: { wetherspoonsPreferred: false },
      updatedAt: "2026-07-16T20:05:00.000Z",
    });
  });
});
