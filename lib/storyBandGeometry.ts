import type { Landmark } from "@/lib/landmarks";
import type { StoryBand } from "@/lib/storyBands";

export function bandAnchors(
  band: StoryBand,
  catalog: readonly Landmark[],
): Landmark[] {
  return band.anchorLandmarkIds
    .map((id) => catalog.find((landmark) => landmark.id === id))
    .filter((landmark): landmark is Landmark => Boolean(landmark));
}
