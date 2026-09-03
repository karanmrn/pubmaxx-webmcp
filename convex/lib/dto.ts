import type { DocumentByName } from "convex/server";
import type {
  MasteryEventDto,
  PalUnlockDto,
  PlanCompletionDto,
  PubPalDto,
  PubPalMemoryDto,
} from "../../lib/convex/contracts";
import type { DataModel } from "../model";

type PubPalDoc = DocumentByName<DataModel, "pubPals">;
type MemoryDoc = DocumentByName<DataModel, "palMemories">;
type MasteryDoc = DocumentByName<DataModel, "masteryEvents">;
type UnlockDoc = DocumentByName<DataModel, "palUnlocks">;
type CompletionDoc = DocumentByName<DataModel, "planCompletions">;

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export function toPubPalDto(doc: PubPalDoc): PubPalDto {
  return {
    id: doc._id,
    name: doc.name,
    adultAttestedAt: iso(doc.adultAttestedAt),
    appearance: doc.appearance,
    personality: doc.personality,
    voice: doc.voice,
    muted: doc.muted,
    hidden: doc.hidden,
    proposalPreferences: doc.proposalPreferences ?? { memories: false, routes: true },
    masteryPoints: doc.masteryPoints,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

export function toMemoryDto(doc: MemoryDoc): PubPalMemoryDto {
  return {
    id: doc._id,
    kind: doc.kind,
    value: doc.value,
    status: doc.status,
    provenance: doc.provenance,
    proposedAt: iso(doc.proposedAt),
    resolvedAt: doc.resolvedAt === undefined ? null : iso(doc.resolvedAt),
    updatedAt: iso(doc.updatedAt ?? doc.resolvedAt ?? doc.proposedAt),
  };
}

export function toMasteryEventDto(doc: MasteryDoc): MasteryEventDto {
  return {
    id: doc._id,
    kind: doc.kind,
    sourceId: doc.sourceId,
    points: doc.points,
    occurredAt: iso(doc.occurredAt),
  };
}

export function toUnlockDto(doc: UnlockDoc): PalUnlockDto {
  return {
    id: doc.unlockKey,
    category: doc.category,
    label: doc.label,
    unlockedAt: iso(doc.unlockedAt),
  };
}

export function toPlanCompletionDto(doc: CompletionDoc): PlanCompletionDto {
  return {
    id: doc._id,
    planId: doc.planId,
    ending: doc.ending,
    terminalVenueId: doc.terminalVenueId ?? null,
    finalPintDropId: doc.finalPintDropId ?? null,
    actorMemberId: doc.actorMemberId,
    completedAt: iso(doc.completedAt),
  };
}
