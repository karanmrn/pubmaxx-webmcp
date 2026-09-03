import { v } from "convex/values";
import { planCompletionDto } from "./dtoValidators";
import { requireOwnerIdentity } from "./lib/auth";
import { toPlanCompletionDto } from "./lib/dto";
import { query } from "./model";

export const listMine = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(planCompletionDto),
  handler: async (ctx, args) => {
    const owner = await requireOwnerIdentity(ctx.auth);
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 25)));
    const records = await ctx.db
      .query("planCompletions")
      .withIndex("by_owner_issuer_subject_completed_at", (q) =>
        q.eq("ownerIssuer", owner.issuer).eq("ownerSubject", owner.subject),
      )
      .order("desc")
      .take(limit);
    return records.map(toPlanCompletionDto);
  },
});
