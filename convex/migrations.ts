import { v } from "convex/values";
import type { GenericId } from "convex/values";
import type { GenericMutationCtx } from "convex/server";
import type { DataModel } from "./model";
import { internalMutation } from "./model";
import { migrationEntity, migrationStatus, shadowResult } from "./validators";
import { canTransitionMigration } from "../lib/convex/migrationTransitions";

export const beginBatch = internalMutation({
  args: {
    entity: migrationEntity,
    sourceCount: v.number(),
    sourceChecksum: v.optional(v.string()),
    startedAt: v.number(),
  },
  returns: v.id("migrationBatches"),
  handler: (ctx, args) => ctx.db.insert("migrationBatches", {
    entity: args.entity,
    status: "prepared",
    sourceCount: args.sourceCount,
    importedCount: 0,
    matchedCount: 0,
    mismatchCount: 0,
    sourceChecksum: args.sourceChecksum,
    startedAt: args.startedAt,
    updatedAt: args.startedAt,
  }),
});

export const updateBatch = internalMutation({
  args: {
    batchId: v.id("migrationBatches"),
    status: migrationStatus,
    sourceCursor: v.optional(v.string()),
    importedCount: v.number(),
    matchedCount: v.number(),
    mismatchCount: v.number(),
    targetChecksum: v.optional(v.string()),
    errorSummary: v.optional(v.string()),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch) throw new Error("Migration batch not found");
    if (!canTransitionMigration(batch.status, args.status)) {
      throw new Error(`Invalid migration transition: ${batch.status} -> ${args.status}`);
    }
    if (
      args.importedCount < batch.importedCount ||
      args.matchedCount < batch.matchedCount ||
      args.mismatchCount < batch.mismatchCount
    ) throw new Error("Migration counters cannot decrease");
    await ctx.db.patch(args.batchId, {
      status: args.status,
      sourceCursor: args.sourceCursor,
      importedCount: args.importedCount,
      matchedCount: args.matchedCount,
      mismatchCount: args.mismatchCount,
      targetChecksum: args.targetChecksum,
      errorSummary: args.errorSummary,
      updatedAt: args.updatedAt,
      completedAt: args.completedAt,
    });
    return null;
  },
});

export const recordShadowComparison = internalMutation({
  args: {
    batchId: v.id("migrationBatches"),
    entity: migrationEntity,
    sourceId: v.string(),
    result: shadowResult,
    sourceHash: v.optional(v.string()),
    targetHash: v.optional(v.string()),
    checkedAt: v.number(),
  },
  returns: v.id("shadowReadComparisons"),
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch || batch.entity !== args.entity) throw new Error("Invalid migration batch");
    return ctx.db.insert("shadowReadComparisons", args);
  },
});

async function removeBatchPage(
  ctx: GenericMutationCtx<DataModel>,
  table: "pubPals" | "palMemories" | "masteryEvents" | "palUnlocks" | "planCompletions",
  batchId: GenericId<"migrationBatches">,
  limit: number,
) {
  const records = await ctx.db
    .query(table)
    .withIndex("by_migration_batch", (q) => q.eq("migrationBatchId", batchId))
    .take(Math.max(1, Math.min(100, Math.floor(limit))));
  await Promise.all(records.map((record) => ctx.db.delete(record._id)));
  return records.length;
}

export const rollbackPubPalsBatch = internalMutation({
  args: { batchId: v.id("migrationBatches"), limit: v.number() },
  returns: v.number(),
  handler: (ctx, args) => removeBatchPage(ctx, "pubPals", args.batchId, args.limit),
});

export const rollbackMemoriesBatch = internalMutation({
  args: { batchId: v.id("migrationBatches"), limit: v.number() },
  returns: v.number(),
  handler: (ctx, args) => removeBatchPage(ctx, "palMemories", args.batchId, args.limit),
});

export const rollbackMasteryBatch = internalMutation({
  args: { batchId: v.id("migrationBatches"), limit: v.number() },
  returns: v.number(),
  handler: (ctx, args) => removeBatchPage(ctx, "masteryEvents", args.batchId, args.limit),
});

export const rollbackUnlocksBatch = internalMutation({
  args: { batchId: v.id("migrationBatches"), limit: v.number() },
  returns: v.number(),
  handler: (ctx, args) => removeBatchPage(ctx, "palUnlocks", args.batchId, args.limit),
});

export const rollbackCompletionsBatch = internalMutation({
  args: { batchId: v.id("migrationBatches"), limit: v.number() },
  returns: v.number(),
  handler: (ctx, args) => removeBatchPage(ctx, "planCompletions", args.batchId, args.limit),
});
