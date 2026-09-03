import { masteryLedgerDto } from "./dtoValidators";
import { requireOwnerIdentity } from "./lib/auth";
import { toMasteryEventDto, toUnlockDto } from "./lib/dto";
import { findOwnedPal } from "./lib/ownedPal";
import { query } from "./model";

export const getMine = query({
  args: {},
  returns: masteryLedgerDto,
  handler: async (ctx) => {
    const owner = await requireOwnerIdentity(ctx.auth);
    const pal = await findOwnedPal(ctx, owner);
    if (!pal) return { points: 0, events: [], unlocks: [] };
    const [events, unlocks] = await Promise.all([
      ctx.db.query("masteryEvents").withIndex("by_pal_occurred_at", (q) => q.eq("palId", pal._id)).order("desc").take(100),
      ctx.db.query("palUnlocks").withIndex("by_pal_unlocked_at", (q) => q.eq("palId", pal._id)).order("desc").take(100),
    ]);
    return {
      points: pal.masteryPoints,
      events: events.map(toMasteryEventDto),
      unlocks: unlocks.map(toUnlockDto),
    };
  },
});
