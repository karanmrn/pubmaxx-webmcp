import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  crawlEnding,
  masteryEventKind,
  memoryKind,
  memoryProvenance,
  memoryStatus,
  migrationEntity,
  migrationStatus,
  pubPalAppearance,
  palProposalPreferences,
  pubPalPersonality,
  pubPalVoice,
  shadowResult,
  unlockCategory,
} from "./validators";

const migratedRecord = {
  legacyId: v.optional(v.string()),
  migrationBatchId: v.optional(v.id("migrationBatches")),
};

export default defineSchema({
  pubPals: defineTable({
    ownerIssuer: v.string(),
    ownerSubject: v.string(),
    name: v.string(),
    adultAttestedAt: v.number(),
    appearance: pubPalAppearance,
    personality: pubPalPersonality,
    voice: pubPalVoice,
    muted: v.boolean(),
    hidden: v.boolean(),
    proposalPreferences: v.optional(palProposalPreferences),
    masteryPoints: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    ...migratedRecord,
  })
    .index("by_owner_issuer_subject", ["ownerIssuer", "ownerSubject"])
    .index("by_legacy_id", ["legacyId"])
    .index("by_migration_batch", ["migrationBatchId"]),

  palMemories: defineTable({
    palId: v.id("pubPals"),
    kind: memoryKind,
    value: v.string(),
    status: memoryStatus,
    provenance: memoryProvenance,
    proposedAt: v.number(),
    resolvedAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    ...migratedRecord,
  })
    .index("by_pal_status", ["palId", "status"])
    .index("by_pal_proposed_at", ["palId", "proposedAt"])
    .index("by_legacy_id", ["legacyId"])
    .index("by_migration_batch", ["migrationBatchId"]),

  masteryEvents: defineTable({
    palId: v.id("pubPals"),
    kind: masteryEventKind,
    sourceId: v.string(),
    idempotencyKey: v.string(),
    points: v.number(),
    occurredAt: v.number(),
    ...migratedRecord,
  })
    .index("by_pal_idempotency_key", ["palId", "idempotencyKey"])
    .index("by_pal_occurred_at", ["palId", "occurredAt"])
    .index("by_legacy_id", ["legacyId"])
    .index("by_migration_batch", ["migrationBatchId"]),

  palUnlocks: defineTable({
    palId: v.id("pubPals"),
    unlockKey: v.string(),
    category: unlockCategory,
    label: v.string(),
    masteryEventId: v.optional(v.id("masteryEvents")),
    unlockedAt: v.number(),
    ...migratedRecord,
  })
    .index("by_pal_unlock_key", ["palId", "unlockKey"])
    .index("by_pal_unlocked_at", ["palId", "unlockedAt"])
    .index("by_legacy_id", ["legacyId"])
    .index("by_migration_batch", ["migrationBatchId"]),

  planCompletions: defineTable({
    ownerIssuer: v.string(),
    ownerSubject: v.string(),
    planId: v.string(),
    ending: crawlEnding,
    terminalVenueId: v.optional(v.string()),
    finalPintDropId: v.optional(v.string()),
    actorMemberId: v.string(),
    completedAt: v.number(),
    ...migratedRecord,
  })
    .index("by_plan_id", ["planId"])
    .index("by_owner_issuer_subject_completed_at", [
      "ownerIssuer",
      "ownerSubject",
      "completedAt",
    ])
    .index("by_legacy_id", ["legacyId"])
    .index("by_migration_batch", ["migrationBatchId"]),

  migrationBatches: defineTable({
    entity: migrationEntity,
    status: migrationStatus,
    sourceCursor: v.optional(v.string()),
    sourceCount: v.number(),
    importedCount: v.number(),
    matchedCount: v.number(),
    mismatchCount: v.number(),
    sourceChecksum: v.optional(v.string()),
    targetChecksum: v.optional(v.string()),
    startedAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
    errorSummary: v.optional(v.string()),
  })
    .index("by_status", ["status"])
    .index("by_entity_started_at", ["entity", "startedAt"]),

  shadowReadComparisons: defineTable({
    batchId: v.id("migrationBatches"),
    entity: migrationEntity,
    sourceId: v.string(),
    result: shadowResult,
    sourceHash: v.optional(v.string()),
    targetHash: v.optional(v.string()),
    checkedAt: v.number(),
  })
    .index("by_batch_checked_at", ["batchId", "checkedAt"])
    .index("by_entity_source_id", ["entity", "sourceId"]),
});
