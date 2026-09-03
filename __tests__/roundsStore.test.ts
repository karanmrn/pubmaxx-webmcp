import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it } from "vitest";

// Exercise the in-memory Round store directly — no live Supabase, no env keys. It
// is the backend the route uses when Supabase is unconfigured, and it enforces the
// SAME domain rules as the Supabase path (join idempotency, venue idempotency,
// closed-round guards, member-only add, creator-only close), so the guarantees
// here mirror production.
//
// FORCE the in-memory path: on Vercel vitest runs with the project's env set — if
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are present the store would try the
// Supabase client (network) and cases would fail only in CI. Clearing them in
// beforeEach pins the store to memory everywhere; we also reset the shared memory
// map so cases can't leak Rounds into each other.
import {
  __resetMemoryRounds,
  memoryRoundsStore,
  roundsStore,
} from "@/lib/roundsStore";

const store = memoryRoundsStore;

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryRounds();
});

async function makeRound(handle = "ken") {
  const res = await store.create({ title: "Big night", createdByHandle: handle });
  if (!res.ok) throw new Error("create failed in test setup");
  return res.state;
}

describe("roundsStore() — seam selection", () => {
  it("selects the in-memory store when Supabase env is absent", () => {
    expect(roundsStore()).toBe(memoryRoundsStore);
  });
});

describe("create", () => {
  it("mints a Round with the creator as its first member", async () => {
    const state = await makeRound("ken");
    expect(state.round.code).toHaveLength(6);
    expect(state.round.createdByHandle).toBe("ken");
    expect(state.round.closedAt).toBeNull();
    expect(state.members.map((m) => m.handle)).toEqual(["ken"]);
    expect(state.stops).toEqual([]);
  });

  it("rejects a Round with no creator handle", async () => {
    const res = await store.create({ title: "x", createdByHandle: "" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("invalid");
  });

  it("mints distinct codes for distinct Rounds", async () => {
    const a = await makeRound("ken");
    const b = await makeRound("ale");
    expect(a.round.code).not.toBe(b.round.code);
  });
});

describe("getByCode", () => {
  it("resolves a Round by its code (any casing / spacing)", async () => {
    const { round } = await makeRound("ken");
    const found = await store.getByCode(`  ${round.code.toLowerCase()} `);
    expect(found?.round.id).toBe(round.id);
  });

  it("returns null for an unknown code", async () => {
    expect(await store.getByCode("ZZZZZZ")).toBeNull();
  });
});

describe("join", () => {
  it("adds a new member", async () => {
    const { round } = await makeRound("ken");
    const res = await store.join(round.code, "ale");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.state.members.map((m) => m.handle).sort()).toEqual(["ale", "ken"]);
  });

  it("is idempotent — re-joining with the same handle does not duplicate", async () => {
    const { round } = await makeRound("ken");
    await store.join(round.code, "ale");
    const res = await store.join(round.code, "ale");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.members.filter((m) => m.handle === "ale")).toHaveLength(1);
    }
  });

  it("cannot join an unknown Round", async () => {
    const res = await store.join("ZZZZZZ", "ale");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("not_found");
  });

  it("cannot join a closed Round", async () => {
    const { round } = await makeRound("ken");
    await store.close(round.code, "ken");
    const res = await store.join(round.code, "ale");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("closed");
  });
});

describe("addStop", () => {
  const STOP = { venueId: "venue-1", venueName: "The Ship" };

  it("appends a stop from a member", async () => {
    const { round } = await makeRound("ken");
    const res = await store.addStop(round.code, { ...STOP, addedByHandle: "ken" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.stops).toHaveLength(1);
      expect(res.state.stops[0]).toMatchObject({
        venueId: "venue-1",
        venueName: "The Ship",
        addedByHandle: "ken",
      });
    }
  });

  it("carries a drop_ref when the stop built itself from a drop", async () => {
    const { round } = await makeRound("ken");
    const res = await store.addStop(round.code, {
      ...STOP,
      addedByHandle: "ken",
      dropRef: "drop-42",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.state.stops[0].dropRef).toBe("drop-42");
  });

  it("is idempotent on venue — the same pub is not a second stop", async () => {
    const { round } = await makeRound("ken");
    await store.addStop(round.code, { ...STOP, addedByHandle: "ken" });
    const res = await store.addStop(round.code, { ...STOP, addedByHandle: "ken" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.state.stops).toHaveLength(1);
  });

  it("rejects a stop from a non-member", async () => {
    const { round } = await makeRound("ken");
    const res = await store.addStop(round.code, { ...STOP, addedByHandle: "stranger" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("forbidden");
  });

  it("cannot add a stop to a closed Round", async () => {
    const { round } = await makeRound("ken");
    await store.close(round.code, "ken");
    const res = await store.addStop(round.code, { ...STOP, addedByHandle: "ken" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("closed");
  });

  it("rejects an invalid stop payload", async () => {
    const { round } = await makeRound("ken");
    const res = await store.addStop(round.code, { venueId: "", venueName: "", addedByHandle: "ken" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("invalid");
  });

  it("preserves insert order across multiple pubs", async () => {
    const { round } = await makeRound("ken");
    await store.addStop(round.code, { venueId: "v1", venueName: "One", addedByHandle: "ken" });
    await store.addStop(round.code, { venueId: "v2", venueName: "Two", addedByHandle: "ken" });
    const state = await store.getByCode(round.code);
    expect(state?.stops.map((s) => s.venueId)).toEqual(["v1", "v2"]);
  });
});

describe("recordSpend", () => {
  async function roundAtPub() {
    const state = await makeRound("ken");
    await store.addStop(state.round.code, {
      venueId: "venue-1",
      venueName: "The Ship",
      addedByHandle: "ken",
    });
    return state.round.code;
  }

  const spend = {
    clientRef: "spend-1",
    payerHandle: "ken",
    recordedByHandle: "ken",
    venueId: "venue-1",
    venueName: "The Ship",
    totalGbp: 26.8,
  };

  it("keeps a member's plain-total round with payer, pub, and date", async () => {
    const code = await roundAtPub();
    const res = await store.recordSpend(code, spend);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.spends).toHaveLength(1);
      expect(res.state.spends[0]).toMatchObject({
        clientRef: "spend-1",
        payerHandle: "ken",
        recordedByHandle: "ken",
        venueId: "venue-1",
        venueName: "The Ship",
        totalPence: 2680,
        items: [],
      });
      expect(Number.isNaN(Date.parse(res.state.spends[0].recordedAt))).toBe(false);
    }
  });

  it("derives an itemised total and keeps each dated first-party line", async () => {
    const code = await roundAtPub();
    const res = await store.recordSpend(code, {
      ...spend,
      items: [
        { drinkName: "Guinness", drinkCategory: "beer", priceGbp: 6.2 },
        { drinkName: "Lime and soda", drinkCategory: "soft-drink", priceGbp: 2.4 },
      ],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.spends[0].totalPence).toBe(860);
      expect(res.state.spends[0].items).toEqual([
        {
          drinkName: "Guinness",
          drinkCategory: "beer",
          pricePence: 620,
          source: "round",
          promotionStatus: "diary_only",
        },
        {
          drinkName: "Lime and soda",
          drinkCategory: "soft-drink",
          pricePence: 240,
          source: "round",
          promotionStatus: "diary_only",
        },
      ]);
    }
  });

  it("persists per-line promotion transitions", async () => {
    const code = await roundAtPub();
    const recorded = await store.recordSpend(code, {
      ...spend,
      items: [{ drinkName: "Guinness", drinkCategory: "beer", priceGbp: 6.2 }],
      initialPromotionStatus: "pending",
    });
    expect(recorded.ok).toBe(true);

    await store.claimSpendPromotionOwner(code, spend.clientRef, "profile:ken");
    const ready = await store.transitionSpendPromotions(
      code,
      spend.clientRef,
      "profile:ken",
      [{ index: 0, status: "ready" }],
    );
    expect(ready.ok).toBe(true);
    if (ready.ok) {
      expect(ready.state.spends[0]?.items[0]?.promotionStatus).toBe("ready");
    }
  });

  it("allows one member to record the named payer's turn", async () => {
    const code = await roundAtPub();
    await store.join(code, "ale");
    const res = await store.recordSpend(code, {
      ...spend,
      payerHandle: "ale",
      recordedByHandle: "ken",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.state.spends[0].payerHandle).toBe("ale");
  });

  it("rejects a recorder or payer who is not in the Round", async () => {
    const code = await roundAtPub();
    const outsiderRecorder = await store.recordSpend(code, {
      ...spend,
      recordedByHandle: "stranger",
    });
    expect(outsiderRecorder).toEqual({ ok: false, error: "forbidden" });

    const outsiderPayer = await store.recordSpend(code, {
      ...spend,
      payerHandle: "stranger",
    });
    expect(outsiderPayer).toEqual({ ok: false, error: "forbidden" });
  });

  it("rejects a spend at a pub not already in the Round", async () => {
    const { round } = await makeRound("ken");
    const res = await store.recordSpend(round.code, spend);
    expect(res).toEqual({ ok: false, error: "invalid" });
  });

  it("is idempotent on clientRef so a retry cannot rotate twice", async () => {
    const code = await roundAtPub();
    await store.recordSpend(code, spend);
    const res = await store.recordSpend(code, { ...spend, totalGbp: 30 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.spends).toHaveLength(1);
      expect(res.state.spends[0].totalPence).toBe(2680);
    }
  });

  it("keeps spend history in recorded order", async () => {
    const code = await roundAtPub();
    await store.join(code, "ale");
    await store.recordSpend(code, spend);
    const res = await store.recordSpend(code, {
      ...spend,
      clientRef: "spend-2",
      payerHandle: "ale",
      totalGbp: 24,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.spends.map((row) => row.clientRef)).toEqual(["spend-1", "spend-2"]);
    }
  });

  it("cannot record spending after the Round is closed", async () => {
    const code = await roundAtPub();
    await store.close(code, "ken");
    const res = await store.recordSpend(code, spend);
    expect(res).toEqual({ ok: false, error: "closed" });
  });
});

describe("close", () => {
  it("only the creator can close", async () => {
    const { round } = await makeRound("ken");
    await store.join(round.code, "ale");
    const res = await store.close(round.code, "ale");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("forbidden");
  });

  it("the creator closes the Round", async () => {
    const { round } = await makeRound("ken");
    const res = await store.close(round.code, "ken");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.state.round.closedAt).not.toBeNull();
  });

  it("is idempotent — closing a closed Round is fine", async () => {
    const { round } = await makeRound("ken");
    const first = await store.close(round.code, "ken");
    const second = await store.close(round.code, "ken");
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.state.round.closedAt).toBe(first.state.round.closedAt);
    }
  });
});

describe("Round price key ownership migration", () => {
  it("preserves every diary line while reconciling first-party owners", () => {
    const sql = readFileSync(
      new URL(
        "../supabase/migrations/20260729140000_0064_round_price_key_owners.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(sql).toMatch(/pg_advisory_xact_lock/);
    expect(sql).toMatch(
      /partition by spend\.venue_id, expanded\.item->>'drinkCategory'/,
    );
    expect(sql).toMatch(/expanded\.ordinality desc/);
    expect(sql).toMatch(
      /ranked_round[\s\S]*promotionStatus' in \('pending', 'ready'\)/,
    );
    expect(sql).toMatch(/ownership_rank > 1[\s\S]*superseded/);
    expect(sql).toMatch(/all_items[\s\S]*left join ranked_round/);
    expect(sql).toMatch(/jsonb_agg[\s\S]*order by all_items\.ordinality/);
  });

  it("serialises source ownership and promotion transitions under one actor lock", () => {
    const sql = readFileSync(
      new URL(
        "../supabase/migrations/20260729140000_0064_round_price_key_owners.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(sql).toMatch(/round_spend_id/);
    expect(sql).toMatch(/round_line_index/);
    expect(sql).toMatch(/community_prices_round_source_owner_idx/);
    expect(sql).toMatch(/round-price-actor:/);
    expect(sql).toMatch(/transition_round_price_lines/);
    expect(sql).toMatch(/source_became_owner/);
    expect(sql).toMatch(
      /p_round_spend_id[\s\S]*promotionStatus[\s\S]*promoted/,
    );
    expect(sql).toMatch(
      /community_prices\.submitted_at <= excluded\.submitted_at/,
    );
  });

  it("validates the current ready Round source before changing shared ownership", () => {
    const sql = readFileSync(
      new URL(
        "../supabase/migrations/20260729140000_0064_round_price_key_owners.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const atomicUpsert = sql.slice(
      sql.indexOf(
        "create or replace function public.upsert_attributed_community_price_if_newer",
      ),
    );
    const sharedWrite = atomicUpsert.indexOf(
      "insert into public.community_prices",
    );

    expect(sharedWrite).toBeGreaterThan(0);
    expect(
      atomicUpsert.indexOf(
        "v_source_item->>'promotionStatus' is distinct from 'ready'",
      ),
    ).toBeGreaterThan(0);
    expect(
      atomicUpsert.indexOf(
        "v_source_item->>'promotionStatus' is distinct from 'ready'",
      ),
    ).toBeLessThan(sharedWrite);
    expect(atomicUpsert).toMatch(
      /order by\s+candidate\.recorded_at desc,[\s\S]*candidate\.id::text desc,[\s\S]*expanded\.ordinality desc/,
    );
    expect(atomicUpsert).toMatch(
      /v_candidate_spend_id is distinct from p_round_spend_id[\s\S]*return;/,
    );
    expect(atomicUpsert).toMatch(
      /promotionStatus' = 'promoted'[\s\S]*from public\.community_prices existing[\s\S]*for update;[\s\S]*v_current_spend_id is distinct from p_round_spend_id[\s\S]*true as source_became_owner/,
    );
  });
});
