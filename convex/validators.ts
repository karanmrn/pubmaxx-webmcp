import { v } from "convex/values";

export const palSpecies = v.union(
  v.literal("robin"),
  v.literal("greyhound"),
  v.literal("pigeon"),
  v.literal("badger"),
  v.literal("corgi"),
  v.literal("hound"),
  v.literal("raven"),
  v.literal("fox"),
  v.literal("cat"),
  v.literal("rabbit"),
  v.literal("turtle"),
  v.literal("squirrel"),
  v.literal("bot"),
);

export const signalFamily = v.union(
  v.literal("beer"),
  v.literal("gin"),
  v.literal("rum"),
  v.literal("whisky"),
  v.literal("brandy"),
  v.literal("vodka"),
);

export const palMaterial = v.union(
  v.literal("hologram"),
  v.literal("chrome"),
  v.literal("glass"),
);

export const palAccessory = v.union(
  v.literal("none"),
  v.literal("collar"),
  v.literal("monocle"),
  v.literal("signal-ring"),
);

export const relationshipStyle = v.union(
  v.literal("guide"),
  v.literal("sidekick"),
  v.literal("confidant"),
);

export const voiceId = v.union(
  v.literal("ember"),
  v.literal("velvet"),
  v.literal("signal"),
);

export const pubPalAppearance = v.object({
  species: palSpecies,
  signalAffinity: signalFamily,
  material: palMaterial,
  accessory: palAccessory,
});

export const pubPalPersonality = v.object({
  playfulness: v.number(),
  energy: v.number(),
  storytelling: v.number(),
  relationship: relationshipStyle,
});

export const pubPalVoice = v.object({
  id: voiceId,
  pace: v.number(),
  warmth: v.number(),
  energy: v.number(),
});

export const palProposalPreferences = v.object({
  memories: v.boolean(),
  routes: v.boolean(),
});

export const memoryKind = v.union(
  v.literal("venue_preference"),
  v.literal("atmosphere_preference"),
  v.literal("accessibility_preference"),
  v.literal("transport_preference"),
  v.literal("drink_preference"),
  v.literal("night_outcome"),
  v.literal("correction"),
);

export const memoryStatus = v.union(
  v.literal("proposed"),
  v.literal("approved"),
  v.literal("rejected"),
);

export const memoryProvenance = v.object({
  source: v.union(
    v.literal("user_confirmed"),
    v.literal("completed_plan"),
    v.literal("user_correction"),
    v.literal("pal_proposal"),
  ),
  sourceId: v.optional(v.string()),
});

export const masteryEventKind = v.union(
  v.literal("plan_completed"),
  v.literal("venue_discovered"),
  v.literal("pint_drop_verified"),
  v.literal("heritage_read"),
  v.literal("crew_coordinated"),
  v.literal("night_captured"),
);

export const unlockCategory = v.union(
  v.literal("material"),
  v.literal("accessory"),
  v.literal("animation"),
  v.literal("home_object"),
  v.literal("lore"),
);

export const crawlEnding = v.union(
  v.literal("food"),
  v.literal("get_home"),
  v.literal("keep_going"),
);

export const migrationEntity = v.union(
  v.literal("pub_pal"),
  v.literal("memory"),
  v.literal("mastery_event"),
  v.literal("unlock"),
  v.literal("plan_completion"),
);

export const migrationStatus = v.union(
  v.literal("prepared"),
  v.literal("running"),
  v.literal("shadowing"),
  v.literal("verified"),
  v.literal("cut_over"),
  v.literal("rolled_back"),
  v.literal("failed"),
);

export const shadowResult = v.union(
  v.literal("match"),
  v.literal("mismatch"),
  v.literal("missing_source"),
  v.literal("missing_target"),
);
