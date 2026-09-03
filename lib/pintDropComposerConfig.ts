import type { Visibility } from "@/lib/spill";

// Honest, one-line copy per visibility lane (issue #24 / PRD "The Spill").
// Order matches VISIBILITIES so the segmented control and the allowlist never
// drift apart.
export const VISIBILITY_COPY: Record<Visibility, { label: string; helper: string }> = {
  public: { label: "Public", helper: "Everyone. The feed, map, and Ledger." },
  friends: { label: "Friends", helper: "People who follow you." },
  legacy: { label: "Legacy", helper: "Kept for the pub's Ledger, off the feed." },
  anonymous: { label: "Anonymous", helper: "Posted as a PUBMAXXER. Your handle is hidden." },
};

export const GENERATION_PRESETS = [
  { label: "Tonight", value: "Tonight" },
  { label: "Old memory", value: "Old memory" },
  { label: "Family story", value: "Family story" },
] as const;
