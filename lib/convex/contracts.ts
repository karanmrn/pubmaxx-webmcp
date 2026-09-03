import type {
  MasteryEventKind,
  PalUnlock,
  PubPalAppearance,
  PubPalMemoryKind,
  PubPalPersonality,
  PubPalVoice,
} from "@/lib/pubPal";
import type { CrawlEnding } from "@/lib/plan";

export type PubPalDto = Readonly<{
  id: string;
  name: string;
  adultAttestedAt: string;
  appearance: PubPalAppearance;
  personality: PubPalPersonality;
  voice: PubPalVoice;
  muted: boolean;
  hidden: boolean;
  proposalPreferences: Readonly<{ memories: boolean; routes: boolean }>;
  masteryPoints: number;
  createdAt: string;
  updatedAt: string;
}>;

export type PubPalMemoryStatus = "proposed" | "approved" | "rejected";

export type PubPalMemoryProvenance = Readonly<{
  source:
    | "user_confirmed"
    | "completed_plan"
    | "user_correction"
    | "pal_proposal";
  sourceId?: string;
}>;

export type PubPalMemoryDto = Readonly<{
  id: string;
  kind: PubPalMemoryKind;
  value: string;
  status: PubPalMemoryStatus;
  provenance: PubPalMemoryProvenance;
  proposedAt: string;
  resolvedAt: string | null;
  updatedAt: string;
}>;

export type MasteryEventDto = Readonly<{
  id: string;
  kind: MasteryEventKind;
  sourceId: string;
  points: number;
  occurredAt: string;
}>;

export type PalUnlockDto = Readonly<
  Pick<PalUnlock, "id" | "category" | "label"> & {
    unlockedAt: string;
  }
>;

export type MasteryLedgerDto = Readonly<{
  points: number;
  events: readonly MasteryEventDto[];
  unlocks: readonly PalUnlockDto[];
}>;

export type PlanCompletionDto = Readonly<{
  id: string;
  planId: string;
  ending: CrawlEnding;
  terminalVenueId: string | null;
  finalPintDropId: string | null;
  actorMemberId: string;
  completedAt: string;
}>;

export type ConfirmedCommandEnvelope<TPayload> = Readonly<{
  ownerIssuer: string;
  ownerSubject: string;
  confirmationId: string;
  confirmedAt: string;
  payload: TPayload;
}>;

export type ConvexHybridCapability =
  | "pal"
  | "memory"
  | "mastery"
  | "plan_completion";

export type ConvexReadMode = "supabase" | "shadow" | "convex";

export type ConvexHybridFlags = Readonly<
  Record<ConvexHybridCapability, ConvexReadMode>
>;

export const KEYLESS_CONVEX_FLAGS: ConvexHybridFlags = {
  pal: "supabase",
  memory: "supabase",
  mastery: "supabase",
  plan_completion: "supabase",
};
