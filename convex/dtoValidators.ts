import { v } from "convex/values";
import {
  crawlEnding,
  masteryEventKind,
  memoryKind,
  memoryProvenance,
  memoryStatus,
  pubPalAppearance,
  palProposalPreferences,
  pubPalPersonality,
  pubPalVoice,
  unlockCategory,
} from "./validators";

export const pubPalDto = v.object({
  id: v.string(),
  name: v.string(),
  adultAttestedAt: v.string(),
  appearance: pubPalAppearance,
  personality: pubPalPersonality,
  voice: pubPalVoice,
  muted: v.boolean(),
  hidden: v.boolean(),
  proposalPreferences: palProposalPreferences,
  masteryPoints: v.number(),
  createdAt: v.string(),
  updatedAt: v.string(),
});

export const memoryDto = v.object({
  id: v.string(),
  kind: memoryKind,
  value: v.string(),
  status: memoryStatus,
  provenance: memoryProvenance,
  proposedAt: v.string(),
  resolvedAt: v.union(v.string(), v.null()),
  updatedAt: v.string(),
});

export const masteryEventDto = v.object({
  id: v.string(),
  kind: masteryEventKind,
  sourceId: v.string(),
  points: v.number(),
  occurredAt: v.string(),
});

export const unlockDto = v.object({
  id: v.string(),
  category: unlockCategory,
  label: v.string(),
  unlockedAt: v.string(),
});

export const masteryLedgerDto = v.object({
  points: v.number(),
  events: v.array(masteryEventDto),
  unlocks: v.array(unlockDto),
});

export const planCompletionDto = v.object({
  id: v.string(),
  planId: v.string(),
  ending: crawlEnding,
  terminalVenueId: v.union(v.string(), v.null()),
  finalPintDropId: v.union(v.string(), v.null()),
  actorMemberId: v.string(),
  completedAt: v.string(),
});
