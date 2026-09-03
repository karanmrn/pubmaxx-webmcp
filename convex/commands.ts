import { v } from "convex/values";
import { boundedControl, masteryPointsFor, requiredText } from "./domain";
import { assertOwner, type OwnerIdentity } from "./lib/auth";
import { findOwnedPal } from "./lib/ownedPal";
import { internalMutation } from "./model";
import {
  crawlEnding,
  masteryEventKind,
  memoryKind,
  memoryProvenance,
  pubPalAppearance,
  palProposalPreferences,
  pubPalPersonality,
  pubPalVoice,
} from "./validators";

const ownerArgs = {
  ownerIssuer: v.string(),
  ownerSubject: v.string(),
};

function ownerFrom(args: { ownerIssuer: string; ownerSubject: string }): OwnerIdentity {
  return {
    issuer: requiredText(args.ownerIssuer, 500),
    subject: requiredText(args.ownerSubject, 200),
  };
}

// These mutations are deliberately internal. A future Next.js BFF bridge must
// verify the Supabase access token and any visible confirmation before invoking
// them. They are not callable by the browser's Convex client.
export const upsertPalFromServer = internalMutation({
  args: {
    ...ownerArgs,
    legacyId: v.optional(v.string()),
    migrationBatchId: v.optional(v.id("migrationBatches")),
    name: v.string(),
    adultAttestedAt: v.number(),
    appearance: pubPalAppearance,
    personality: pubPalPersonality,
    voice: pubPalVoice,
    muted: v.boolean(),
    hidden: v.boolean(),
    proposalPreferences: v.optional(palProposalPreferences),
    now: v.number(),
  },
  returns: v.id("pubPals"),
  handler: async (ctx, args) => {
    const owner = ownerFrom(args);
    const personality = {
      ...args.personality,
      playfulness: boundedControl(args.personality.playfulness),
      energy: boundedControl(args.personality.energy),
      storytelling: boundedControl(args.personality.storytelling),
    };
    const voice = {
      ...args.voice,
      pace: boundedControl(args.voice.pace),
      warmth: boundedControl(args.voice.warmth),
      energy: boundedControl(args.voice.energy),
    };
    const existing = await findOwnedPal(ctx, owner);
    if (existing) {
      await ctx.db.patch(existing._id, {
        name: requiredText(args.name, 32),
        appearance: args.appearance,
        personality,
        voice,
        muted: args.muted,
        hidden: args.hidden,
        proposalPreferences: args.proposalPreferences ?? existing.proposalPreferences ?? { memories: false, routes: true },
        updatedAt: args.now,
        migrationBatchId: args.migrationBatchId,
      });
      return existing._id;
    }
    return ctx.db.insert("pubPals", {
      ownerIssuer: owner.issuer,
      ownerSubject: owner.subject,
      legacyId: args.legacyId,
      migrationBatchId: args.migrationBatchId,
      name: requiredText(args.name, 32),
      adultAttestedAt: args.adultAttestedAt,
      appearance: args.appearance,
      personality,
      voice,
      muted: args.muted,
      hidden: args.hidden,
      proposalPreferences: args.proposalPreferences ?? { memories: false, routes: true },
      masteryPoints: 0,
      createdAt: args.now,
      updatedAt: args.now,
    });
  },
});

export const proposeMemoryFromServer = internalMutation({
  args: {
    ...ownerArgs,
    kind: memoryKind,
    value: v.string(),
    provenance: memoryProvenance,
    proposedAt: v.number(),
  },
  returns: v.id("palMemories"),
  handler: async (ctx, args) => {
    const pal = await findOwnedPal(ctx, ownerFrom(args));
    if (!pal) throw new Error("Pub Pal not found");
    return ctx.db.insert("palMemories", {
      palId: pal._id,
      kind: args.kind,
      value: requiredText(args.value, 500),
      status: "proposed",
      provenance: args.provenance,
      proposedAt: args.proposedAt,
      updatedAt: args.proposedAt,
    });
  },
});

export const resolveMemoryFromServer = internalMutation({
  args: {
    ...ownerArgs,
    memoryId: v.id("palMemories"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    resolvedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const owner = ownerFrom(args);
    const memory = await ctx.db.get(args.memoryId);
    if (!memory) throw new Error("Memory not found");
    const pal = await ctx.db.get(memory.palId);
    if (!pal) throw new Error("Pub Pal not found");
    assertOwner(
      { issuer: pal.ownerIssuer, subject: pal.ownerSubject },
      owner,
    );
    if (memory.status !== "proposed") throw new Error("Memory already resolved");
    await ctx.db.patch(memory._id, {
      status: args.decision,
      resolvedAt: args.resolvedAt,
      updatedAt: args.resolvedAt,
    });
    return null;
  },
});

export const correctMemoryFromServer = internalMutation({
  args: {
    ...ownerArgs,
    memoryId: v.id("palMemories"),
    value: v.string(),
    correctedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const owner = ownerFrom(args);
    const memory = await ctx.db.get(args.memoryId);
    if (!memory) throw new Error("Memory not found");
    const pal = await ctx.db.get(memory.palId);
    if (!pal) throw new Error("Pub Pal not found");
    assertOwner({ issuer: pal.ownerIssuer, subject: pal.ownerSubject }, owner);
    if (memory.status !== "approved") throw new Error("Only approved memory can be corrected");
    await ctx.db.patch(memory._id, {
      value: requiredText(args.value, 500),
      provenance: { source: "user_correction" },
      updatedAt: args.correctedAt,
    });
    return null;
  },
});

export const deleteMemoryFromServer = internalMutation({
  args: { ...ownerArgs, memoryId: v.id("palMemories") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const owner = ownerFrom(args);
    const memory = await ctx.db.get(args.memoryId);
    if (!memory) throw new Error("Memory not found");
    const pal = await ctx.db.get(memory.palId);
    if (!pal) throw new Error("Pub Pal not found");
    assertOwner({ issuer: pal.ownerIssuer, subject: pal.ownerSubject }, owner);
    await ctx.db.delete(memory._id);
    return null;
  },
});

export const deletePalFromServer = internalMutation({
  args: ownerArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const pal = await findOwnedPal(ctx, ownerFrom(args));
    if (!pal) throw new Error("Pub Pal not found");
    const [ownedMemories, masteryEvents, unlocks] = await Promise.all([
      ctx.db.query("palMemories").withIndex("by_pal_proposed_at", (q) => q.eq("palId", pal._id)).collect(),
      ctx.db.query("masteryEvents").withIndex("by_pal_occurred_at", (q) => q.eq("palId", pal._id)).collect(),
      ctx.db.query("palUnlocks").withIndex("by_pal_unlocked_at", (q) => q.eq("palId", pal._id)).collect(),
    ]);
    await Promise.all([
      ...ownedMemories.map((memory) => ctx.db.delete(memory._id)),
      ...masteryEvents.map((event) => ctx.db.delete(event._id)),
      ...unlocks.map((unlock) => ctx.db.delete(unlock._id)),
    ]);
    await ctx.db.delete(pal._id);
    return null;
  },
});

export const recordMasteryFromServer = internalMutation({
  args: {
    ...ownerArgs,
    kind: masteryEventKind,
    sourceId: v.string(),
    occurredAt: v.number(),
    legacyId: v.optional(v.string()),
    migrationBatchId: v.optional(v.id("migrationBatches")),
  },
  returns: v.id("masteryEvents"),
  handler: async (ctx, args) => {
    const pal = await findOwnedPal(ctx, ownerFrom(args));
    if (!pal) throw new Error("Pub Pal not found");
    const sourceId = requiredText(args.sourceId, 160);
    const idempotencyKey = `${args.kind}:${sourceId}`;
    const existing = await ctx.db
      .query("masteryEvents")
      .withIndex("by_pal_idempotency_key", (q) =>
        q.eq("palId", pal._id).eq("idempotencyKey", idempotencyKey),
      )
      .unique();
    if (existing) return existing._id;
    const points = masteryPointsFor(args.kind);
    const eventId = await ctx.db.insert("masteryEvents", {
      palId: pal._id,
      kind: args.kind,
      sourceId,
      idempotencyKey,
      points,
      occurredAt: args.occurredAt,
      legacyId: args.legacyId,
      migrationBatchId: args.migrationBatchId,
    });
    await ctx.db.patch(pal._id, {
      masteryPoints: pal.masteryPoints + points,
      updatedAt: args.occurredAt,
    });
    return eventId;
  },
});

export const recordPlanCompletionFromServer = internalMutation({
  args: {
    ...ownerArgs,
    legacyId: v.optional(v.string()),
    migrationBatchId: v.optional(v.id("migrationBatches")),
    planId: v.string(),
    ending: crawlEnding,
    terminalVenueId: v.optional(v.string()),
    finalPintDropId: v.optional(v.string()),
    actorMemberId: v.string(),
    completedAt: v.number(),
  },
  returns: v.id("planCompletions"),
  handler: async (ctx, args) => {
    const owner = ownerFrom(args);
    const planId = requiredText(args.planId, 160);
    const existing = await ctx.db
      .query("planCompletions")
      .withIndex("by_plan_id", (q) => q.eq("planId", planId))
      .unique();
    if (existing) {
      assertOwner(
        { issuer: existing.ownerIssuer, subject: existing.ownerSubject },
        owner,
      );
      return existing._id;
    }
    return ctx.db.insert("planCompletions", {
      ownerIssuer: owner.issuer,
      ownerSubject: owner.subject,
      legacyId: args.legacyId,
      migrationBatchId: args.migrationBatchId,
      planId,
      ending: args.ending,
      terminalVenueId: args.terminalVenueId,
      finalPintDropId: args.finalPintDropId,
      actorMemberId: requiredText(args.actorMemberId, 200),
      completedAt: args.completedAt,
    });
  },
});

export const grantUnlockFromServer = internalMutation({
  args: {
    ...ownerArgs,
    unlockKey: v.string(),
    category: v.union(
      v.literal("material"),
      v.literal("accessory"),
      v.literal("animation"),
      v.literal("home_object"),
      v.literal("lore"),
    ),
    label: v.string(),
    masteryEventId: v.optional(v.id("masteryEvents")),
    unlockedAt: v.number(),
    migrationBatchId: v.optional(v.id("migrationBatches")),
  },
  returns: v.id("palUnlocks"),
  handler: async (ctx, args) => {
    const pal = await findOwnedPal(ctx, ownerFrom(args));
    if (!pal) throw new Error("Pub Pal not found");
    const unlockKey = requiredText(args.unlockKey, 100);
    const existing = await ctx.db
      .query("palUnlocks")
      .withIndex("by_pal_unlock_key", (q) =>
        q.eq("palId", pal._id).eq("unlockKey", unlockKey),
      )
      .unique();
    if (existing) return existing._id;
    return ctx.db.insert("palUnlocks", {
      palId: pal._id,
      unlockKey,
      category: args.category,
      label: requiredText(args.label, 120),
      masteryEventId: args.masteryEventId,
      unlockedAt: args.unlockedAt,
      migrationBatchId: args.migrationBatchId,
    });
  },
});
