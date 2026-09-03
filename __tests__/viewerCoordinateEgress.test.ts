import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const VIEWER_COORDINATE_EGRESS_FILES = [
  "components/map/useWhatsOnTonight.ts",
  "app/tonight/TonightConditionsStrip.tsx",
  "app/tonight/TonightGetHomeStrip.tsx",
  "app/today/TodayGetThereStrip.tsx",
  "app/today/TodayTubeCard.tsx",
  "components/transport/DisruptionLine.tsx",
  "components/map/useVenueJourney.ts",
  "lib/venueJourney.ts",
  "lib/lastTrainDestination.ts",
  "lib/whatsOnHandler.ts",
  "app/api/tonight-conditions/route.ts",
  "app/api/tfl-disruption/route.ts",
  "app/api/citymcp/journey/route.ts",
  "lib/lastTrain.server.ts",
  // The locate fix reaches a URL (server logs, history, shareable), so it
  // must coarsen before it leaves the browser (#901 review finding).
  "lib/locateMapDestination.ts",
] as const;

describe("viewer coordinate egress", () => {
  it.each(VIEWER_COORDINATE_EGRESS_FILES)(
    "%s passes coordinates through the shared coarsening seam",
    (file) => {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source).toMatch(/coarsenViewerPoint\s*\(/);
    },
  );
});
