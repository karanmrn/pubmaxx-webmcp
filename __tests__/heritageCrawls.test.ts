import { describe, expect, it } from "vitest";

import { buildHeritageCrawls } from "@/lib/heritageCrawls";
import type { HistoricPub } from "@/lib/historic";

// Minimal HistoricPub factory — every field the builder reads, sane defaults.
function pub(overrides: Partial<HistoricPub> & { name: string }): HistoricPub {
  const slug = overrides.slug ?? overrides.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const base: HistoricPub = {
    venueId: `venue-${slug}`,
    name: overrides.name,
    slug,
    borough: "Test",
    lat: 51.5,
    lng: 0,
    hook: "",
    facts: [],
    era: null,
    listed: null,
    sourced: true,
  };
  return { ...base, ...overrides };
}

function fact(text: string) {
  return { source: "wikipedia" as const, fact: text, sourceRef: "https://en.wikipedia.org/wiki/Test" };
}

// A fixture engineered so all three themes qualify (>= 3 routable stops each),
// with a couple of deliberately unroutable rows that must be excluded.
const FIXTURE: HistoricPub[] = [
  // Oldest + riverside (wharf in hook) + listed II*
  pub({ name: "Old Wharf Tavern", era: "1520", listed: "II*", lng: -0.05, hook: "An old wharf-side tavern." }),
  // Oldest + listed I
  pub({ name: "Ancient Inn", era: "17th century", listed: "I", lng: -0.12 }),
  // Oldest only (Grade II is NOT highly listed → excluded from listed theme)
  pub({ name: "Georgian Arms", era: "1700", listed: "II", lng: -0.2 }),
  // Oldest only
  pub({ name: "Victorian Vaults", era: "1850", listed: null, lng: -0.15 }),
  // Oldest + listed II* (newest of the dated set)
  pub({ name: "Blackfriar House", era: "1875", listed: "II*", lng: -0.1 }),
  // Riverside only (Thames in a fact), westmost
  pub({ name: "Thames Boozer", era: null, listed: null, lng: -0.25, facts: [fact("On the Thames foreshore.")] }),
  // Riverside only (quay in a fact), eastmost
  pub({ name: "Quay House", era: null, listed: null, lng: -0.03, facts: [fact("Beside the old quay.")] }),
  // Nothing: no era, no keyword, not highly listed
  pub({ name: "Modern Bar", era: null, listed: null, lng: 0.1 }),
  // Unroutable: has era but NO coords → must be excluded from every theme
  pub({ name: "Ghost Alehouse", era: "1600", listed: "II*", lat: null, lng: null, hook: "A riverside wharf pub." }),
  // Unroutable: riverside + era but NO venueId → excluded
  pub({ name: "Nameless Wharf", venueId: null, era: "1400", lng: -0.3, hook: "A wharf tavern." }),
];

const coordsById = new Map(FIXTURE.map((p) => [p.venueId, { lat: p.lat, lng: p.lng }]));
const realVenueIds = new Set(FIXTURE.filter((p) => p.venueId).map((p) => p.venueId));

describe("buildHeritageCrawls", () => {
  const crawls = buildHeritageCrawls(FIXTURE);
  const byId = new Map(crawls.map((c) => [c.id, c]));

  it("emits the three themed crawls with heritage- ids and heritage style", () => {
    expect(byId.has("heritage-oldest-pubs")).toBe(true);
    expect(byId.has("heritage-riverside-taverns")).toBe(true);
    expect(byId.has("heritage-grade-listed")).toBe(true);
    for (const crawl of crawls) {
      expect(crawl.id.startsWith("heritage-")).toBe(true);
      expect(crawl.crawlStyle).toBe("heritage");
      expect(crawl.name.trim().length).toBeGreaterThan(0);
      // Provenance-honest blurb.
      expect(crawl.blurb).toContain("cited from Wikipedia.");
    }
  });

  it("orders 'oldest' by parsed era, earliest first", () => {
    const oldest = byId.get("heritage-oldest-pubs")!;
    expect(oldest.venueIds).toEqual([
      "venue-old-wharf-tavern", // 1520
      "venue-ancient-inn", // 17th century → 1601
      "venue-georgian-arms", // 1700
      "venue-victorian-vaults", // 1850
      "venue-blackfriar-house", // 1875
    ]);
  });

  it("selects riverside by keyword and orders west→east by longitude", () => {
    const riverside = byId.get("heritage-riverside-taverns")!;
    expect(riverside.venueIds).toEqual([
      "venue-thames-boozer", // -0.25 (west)
      "venue-old-wharf-tavern", // -0.05
      "venue-quay-house", // -0.03 (east)
    ]);
  });

  it("keeps only Grade I / II* in the listed theme, grade then era", () => {
    const listed = byId.get("heritage-grade-listed")!;
    expect(listed.venueIds).toEqual([
      "venue-ancient-inn", // Grade I first
      "venue-old-wharf-tavern", // II*, 1520
      "venue-blackfriar-house", // II*, 1875
    ]);
    // The Grade II pub must not appear.
    expect(listed.venueIds).not.toContain("venue-georgian-arms");
  });

  it("skips a theme with fewer than 3 qualifying stops", () => {
    // Only two riverside-capable, routable pubs → no riverside crawl at all.
    const thin = buildHeritageCrawls([
      pub({ name: "Thames One", lng: -0.2, facts: [fact("On the Thames.")] }),
      pub({ name: "Wharf Two", lng: -0.1, hook: "By the wharf." }),
      pub({ name: "Dry Pub", lng: 0 }),
    ]);
    expect(thin.find((c) => c.id === "heritage-riverside-taverns")).toBeUndefined();
    expect(thin.find((c) => c.id === "heritage-grade-listed")).toBeUndefined();
    expect(thin.find((c) => c.id === "heritage-oldest-pubs")).toBeUndefined();
    expect(thin).toEqual([]);
  });

  it("only ever emits real venueIds with real coordinates", () => {
    for (const crawl of crawls) {
      expect(crawl.venueIds.length).toBeGreaterThanOrEqual(3);
      for (const id of crawl.venueIds) {
        expect(realVenueIds.has(id)).toBe(true);
        const coords = coordsById.get(id);
        expect(coords?.lat).not.toBeNull();
        expect(coords?.lng).not.toBeNull();
      }
    }
  });

  it("never includes unroutable pubs (missing venueId or coords)", () => {
    const allEmitted = crawls.flatMap((c) => c.venueIds);
    expect(allEmitted).not.toContain("venue-ghost-alehouse");
    expect(allEmitted).not.toContain(null);
    expect(allEmitted.some((id) => id === "venue-nameless-wharf")).toBe(false);
  });

  it("is deterministic — input order does not change the output", () => {
    const again = buildHeritageCrawls(FIXTURE);
    expect(again).toEqual(crawls);
    // A shuffled (reversed) input must produce byte-identical crawls.
    const shuffled = buildHeritageCrawls([...FIXTURE].reverse());
    expect(shuffled).toEqual(crawls);
  });
});

// The era→year parsing that ordered the crawls above now lives in the shared
// eraStartYear helper (lib/historicFilter), covered by __tests__/historicFilter.test.ts.
