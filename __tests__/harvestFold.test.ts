import { describe, expect, it } from "vitest";

import {
  HarvestFoldError,
  applyHarvestWebsiteMenu,
  canonicalOsmId,
  heritageFactFromOverlay,
  loreMayFold,
  loreNameTownGate,
  overlayLookupKeys,
  parseFoldStatsMarkdown,
  parseOverlayJsonl,
  parseOverlayRow,
  parsePublicOverlay,
  reconcileFoldStats,
  summariseOverlay,
  overlayRowsFromHarvestRecords,
} from "@/lib/harvestFold";
import { parseUkBaseShard } from "@/lib/ukBasePubs";
import { slimVenueToPin } from "@/lib/slimPins";
import { buildSeedMetadata } from "../scripts/harvest/uk-pubs/foldInput.mjs";

const LORE_TEXT =
  "The Red Lion in Clapham has stood on the common since the eighteenth century.";

function row(overrides: Record<string, unknown> = {}) {
  return {
    osmId: "node/123",
    name: "The Red Lion",
    town: "Clapham",
    website: "https://redlion.example/",
    menuUrl: "https://redlion.example/menu",
    matchedLore: {
      text: LORE_TEXT,
      citations: ["https://history.example/red-lion-clapham"],
    },
    sources: ["https://redlion.example/", "https://history.example/red-lion-clapham"],
    ...overrides,
  };
}

describe("loreNameTownGate", () => {
  it("passes only when every name token and the town sit in the lore text", () => {
    expect(loreNameTownGate(LORE_TEXT, "The Red Lion", "Clapham")).toBe("pass");
  });

  it("fails when the OSM town tag is missing", () => {
    expect(loreNameTownGate(LORE_TEXT, "The Red Lion", null)).toBe("town-missing");
    expect(loreNameTownGate(LORE_TEXT, "The Red Lion", "")).toBe("town-missing");
  });

  it("fails when the town tag is present but not in the text", () => {
    expect(loreNameTownGate(LORE_TEXT, "The Red Lion", "Camden")).toBe("town-mismatch");
  });

  it("fails when name tokens are not in the text", () => {
    expect(loreNameTownGate(LORE_TEXT, "The Prospect of Whitby", "Clapham")).toBe(
      "name-mismatch",
    );
  });

  it("does not match a name token inside a longer word", () => {
    expect(
      loreNameTownGate(
        "The Starling pub in York has a star on its sign.",
        "The Star",
        "York",
      ),
    ).toBe("name-mismatch");
  });

  it("does not match a town inside a longer locality name", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in New York has stood since 1750.",
        "The Red Lion",
        "York",
      ),
    ).toBe("town-mismatch");
  });

  it("does not match a foreign locality abbreviation with the same town name", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in York, PA has stood since 1750.",
        "The Red Lion",
        "York",
      ),
    ).toBe("town-mismatch");
  });

  it("does not match a foreign locality short name with the same town name", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in York, Penn. has stood since 1750.",
        "The Red Lion",
        "York",
      ),
    ).toBe("town-mismatch");
  });

  it("does not match a foreign locality after a non-comma separator", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in York - Pennsylvania has stood since 1750.",
        "The Red Lion",
        "York",
      ),
    ).toBe("town-mismatch");
  });

  it("does not match a foreign locality after an en-dash separator", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in York – Pennsylvania has stood since 1750.",
        "The Red Lion",
        "York",
      ),
    ).toBe("town-mismatch");
  });

  it("does not match a foreign locality after an em-dash separator", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in York — Pennsylvania has stood since 1750.",
        "The Red Lion",
        "York",
      ),
    ).toBe("town-mismatch");
  });

  it("does not match an unrecognised locality qualifier", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in York, Germany has stood since 1750.",
        "The Red Lion",
        "York",
      ),
    ).toBe("town-mismatch");
  });

  it("does not match an unrecognised locality after a preposition", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in York in Germany has stood since 1750.",
        "The Red Lion",
        "York",
      ),
    ).toBe("town-mismatch");
  });

  it("does not match an unrecognised locality without punctuation", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in York Germany has stood since 1750.",
        "The Red Lion",
        "York",
      ),
    ).toBe("town-mismatch");
  });

  it("does not accept a conflicting qualifier after a UK qualifier", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in York, UK, Germany has stood since 1750.",
        "The Red Lion",
        "York",
      ),
    ).toBe("town-mismatch");
  });

  it("does not accept a different UK locality qualifier", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in York, London has stood since 1750.",
        "The Red Lion",
        "York",
      ),
    ).toBe("town-mismatch");
  });

  it("does not bind an unrelated town mention to the venue", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in London was founded by a brewer in Clapham.",
        "The Red Lion",
        "Clapham",
      ),
    ).toBe("town-mismatch");
  });

  it("does not accept a later foreign locality qualifier", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in York is in Germany.",
        "The Red Lion",
        "York",
      ),
    ).toBe("town-mismatch");
  });

  it("does not accept a foreign locality after intervening venue prose", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in York is a historic pub in Pennsylvania.",
        "The Red Lion",
        "York",
      ),
    ).toBe("town-mismatch");
  });

  it("does not accept a foreign locality after an operating-from phrase", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in York has been operating from Pennsylvania since 1750.",
        "The Red Lion",
        "York",
      ),
    ).toBe("town-mismatch");
  });

  it("does not accept a foreign branch locality after a has phrase", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in York has a branch in Pennsylvania.",
        "The Red Lion",
        "York",
      ),
    ).toBe("town-mismatch");
  });

  it("does not accept a foreign qualifier after a later expected locality", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in York has been operating in York, Pennsylvania since 1750.",
        "The Red Lion",
        "York",
      ),
    ).toBe("town-mismatch");
  });

  it("does not accept a conflicting venue locality in a later sentence", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in York, England. The Red Lion in York, Pennsylvania.",
        "The Red Lion",
        "York",
      ),
    ).toBe("town-mismatch");
  });

  it("does not accept a conflicting venue-reference locality in a later sentence", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in York, England. It is now located in Pennsylvania.",
        "The Red Lion",
        "York",
      ),
    ).toBe("town-mismatch");
  });

  it("does not accept a moved venue in a later foreign locality", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in York, England. It moved to Pennsylvania.",
        "The Red Lion",
        "York",
      ),
    ).toBe("town-mismatch");
  });

  it("does not accept a venue moved in a later foreign locality statement", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in York, England. This venue is now in Pennsylvania.",
        "The Red Lion",
        "York",
      ),
    ).toBe("town-mismatch");
  });

  it("does not accept a named venue relocated in a later foreign locality statement", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in York, England. The Red Lion was later relocated to York, Pennsylvania.",
        "The Red Lion",
        "York",
      ),
    ).toBe("town-mismatch");
  });

  it("does not accept a named venue in a later foreign locality statement", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in York. The Red Lion was in Clapham.",
        "The Red Lion",
        "York",
      ),
    ).toBe("town-mismatch");
  });

  it("does not accept a later contradictory locality after contextual venue lore", () => {
    expect(
      loreNameTownGate(
        "York's famous pub The Red Lion is in York. The Red Lion was in Clapham.",
        "The Red Lion",
        "York",
      ),
    ).toBe("town-mismatch");
  });

  it("does not accept a later foreign branch locality", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in York. The Red Lion has a branch in Pennsylvania.",
        "The Red Lion",
        "York",
      ),
    ).toBe("town-mismatch");
  });

  it("does not accept a later foreign opened-branch locality", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in Clapham has stood since 1700. The Red Lion opened a branch in Pennsylvania.",
        "The Red Lion",
        "Clapham",
      ),
    ).toBe("town-mismatch");
  });

  it("does not accept a reverse foreign branch locality", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in Clapham has stood since 1700. Pennsylvania is home to a branch of The Red Lion.",
        "The Red Lion",
        "Clapham",
      ),
    ).toBe("town-mismatch");
  });

  it("does not accept a later foreign branch locality in a venue reference", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in Clapham has stood since 1700. It has a branch in Pennsylvania.",
        "The Red Lion",
        "Clapham",
      ),
    ).toBe("town-mismatch");
  });

  it("does not accept a later foreign branch locality in a possessive reference", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in Clapham has stood since 1700. Its branch in Pennsylvania opened in 2010.",
        "The Red Lion",
        "Clapham",
      ),
    ).toBe("town-mismatch");
  });

  it("does not accept a later foreign opened-branch locality in a possessive reference", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in Clapham has stood since 1700. Its new branch opened in Pennsylvania.",
        "The Red Lion",
        "Clapham",
      ),
    ).toBe("town-mismatch");
  });

  it("does not accept a later foreign opened-branch locality in a definite reference", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in Clapham has stood since 1700. The branch opened in Pennsylvania.",
        "The Red Lion",
        "Clapham",
      ),
    ).toBe("town-mismatch");
  });

  it("does not accept a later foreign locality in a demonstrative venue reference", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in Clapham has stood since 1700. That pub is in Pennsylvania.",
        "The Red Lion",
        "Clapham",
      ),
    ).toBe("town-mismatch");
  });

  it("does not accept a later foreign adjectival branch locality", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in Clapham has stood since 1700. A Pennsylvania branch of the pub opened in 2010.",
        "The Red Lion",
        "Clapham",
      ),
    ).toBe("town-mismatch");
  });

  it("does not accept a later foreign branch-of-pub locality", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in Clapham has stood since 1700. A branch of the pub in Pennsylvania opened in 2010.",
        "The Red Lion",
        "Clapham",
      ),
    ).toBe("town-mismatch");
  });

  it("does not accept a foreign locality in a possessive venue branch", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in Clapham has stood since 1700. The Red Lion's branch is in Pennsylvania.",
        "The Red Lion",
        "Clapham",
      ),
    ).toBe("town-mismatch");
  });

  it("does not accept a foreign locality in a named venue second site", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in Clapham has stood since 1700. The Red Lion has a second site in Pennsylvania.",
        "The Red Lion",
        "Clapham",
      ),
    ).toBe("town-mismatch");
  });

  it("does not accept a possessive venue address in a later foreign locality statement", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in York, England. Its current address is Pennsylvania.",
        "The Red Lion",
        "York",
      ),
    ).toBe("town-mismatch");
  });

  it("accepts a comma-separated venue locality", () => {
    expect(
      loreNameTownGate(
        "The Red Lion, Clapham has stood since 1700.",
        "The Red Lion",
        "Clapham",
      ),
    ).toBe("pass");
  });

  it("accepts a confirmed locality before a comma-separated relative clause", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in Clapham, which dates from 1700, has stood on the common.",
        "The Red Lion",
        "Clapham",
      ),
    ).toBe("pass");
  });

  it("does not accept a foreign possessive venue address after a valid locality", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in Clapham has stood since 1700. The Red Lion's current address is Pennsylvania.",
        "The Red Lion",
        "Clapham",
      ),
    ).toBe("town-mismatch");
  });

  it("does not combine venue and town from separate sentences", () => {
    expect(
      loreNameTownGate(
        "The Red Lion is a pub. Clapham has many pubs.",
        "The Red Lion",
        "Clapham",
      ),
    ).toBe("town-mismatch");
  });

  it("does not combine venue and town from separate clauses", () => {
    expect(
      loreNameTownGate(
        "The Red Lion is a pub, and Clapham has many pubs.",
        "The Red Lion",
        "Clapham",
      ),
    ).toBe("town-mismatch");
  });

  it("does not treat an unrelated biographical locality as venue location", () => {
    expect(
      loreNameTownGate(
        "The Red Lion is a pub whose founder was born in Clapham.",
        "The Red Lion",
        "Clapham",
      ),
    ).toBe("town-mismatch");
  });

  it("does not treat a mentioned locality as venue location", () => {
    expect(
      loreNameTownGate(
        "The Red Lion is a pub. It was mentioned in Clapham.",
        "The Red Lion",
        "Clapham",
      ),
    ).toBe("town-mismatch");
  });

  it("does not accept a compound foreign locality", () => {
    expect(
      loreNameTownGate(
        "The Red Lion in York and Pennsylvania has stood since 1750.",
        "The Red Lion",
        "York",
      ),
    ).toBe("town-mismatch");
  });
});

describe("harvest fold seed metadata", () => {
  it("fails loud on duplicate canonical OSM ids", () => {
    expect(() =>
      buildSeedMetadata(
        [
          { osmId: "node/123", name: "The Red Lion", addressTags: {} },
          { osmId: "venue-uk-n123", name: "The Blue Lion", addressTags: {} },
        ],
        "seed.jsonl",
      ),
    ).toThrow(/duplicate harvest seed OSM id: node\/123/);
  });
});

describe("loreMayFold", () => {
  it("requires a name+town match and at least one https citation", () => {
    expect(
      loreMayFold({
        text: LORE_TEXT,
        name: "The Red Lion",
        town: "Clapham",
        citations: ["https://history.example/red-lion-clapham"],
      }),
    ).toBe(true);
  });

  it("refuses uncited lore even when the name and town match", () => {
    expect(
      loreMayFold({
        text: LORE_TEXT,
        name: "The Red Lion",
        town: "Clapham",
        citations: [],
      }),
    ).toBe(false);
  });

  it("refuses http citations", () => {
    expect(
      loreMayFold({
        text: LORE_TEXT,
        name: "The Red Lion",
        town: "Clapham",
        citations: ["http://history.example/red-lion-clapham"],
      }),
    ).toBe(false);
  });

  it("refuses a namesake hit that never names the town", () => {
    expect(
      loreMayFold({
        text: "The Red Lion is a famous coaching inn.",
        name: "The Red Lion",
        town: "Clapham",
        citations: ["https://history.example/red-lion"],
      }),
    ).toBe(false);
  });
});

describe("parseOverlayRow", () => {
  it("keeps https website, menu, and cited lore against the OSM id", () => {
    const parsed = parseOverlayRow(row());
    expect(parsed.osmId).toBe("node/123");
    expect(parsed.osmRef).toBe("n123");
    expect(parsed.website).toBe("https://redlion.example/");
    expect(parsed.menuUrl).toBe("https://redlion.example/menu");
    expect(parsed.matchedLore?.citations).toEqual([
      "https://history.example/red-lion-clapham",
    ]);
  });

  it("fails loud on a malformed row", () => {
    expect(() => parseOverlayRow("nope")).toThrow(HarvestFoldError);
    expect(() => parseOverlayRow({ website: "https://x.example/" })).toThrow(
      HarvestFoldError,
    );
  });

  it("fails loud on an http website or menu URL", () => {
    expect(() => parseOverlayRow(row({ website: "http://redlion.example/" }))).toThrow(
      HarvestFoldError,
    );
    expect(() => parseOverlayRow(row({ menuUrl: "http://redlion.example/menu" }))).toThrow(
      HarvestFoldError,
    );
  });

  it("stores a concatenated https observation but serving drops it from CTAs", () => {
    const parsed = parseOverlayRow(
      row({
        website: "https://theimperialpub.com, https://imperialarmschislehurst.co.uk",
        menuUrl: null,
        matchedLore: null,
      }),
    );
    expect(parsed.website?.startsWith("https://")).toBe(true);
    expect(parsePublicOverlay(parsed)?.website).toBeNull();
  });

  it("fails loud on lore without an https citation", () => {
    expect(() =>
      parseOverlayRow(
        row({
          matchedLore: { text: LORE_TEXT, citations: [] },
        }),
      ),
    ).toThrow(HarvestFoldError);
    expect(() =>
      parseOverlayRow(
        row({
          matchedLore: {
            text: LORE_TEXT,
            citations: ["http://history.example/red-lion-clapham"],
          },
        }),
      ),
    ).toThrow(HarvestFoldError);
  });

  it("fails loud on malformed concatenated website observations", () => {
    expect(() => parseOverlayRow(row({ website: "https://", matchedLore: null }))).toThrow(
      HarvestFoldError,
    );
    expect(() =>
      parseOverlayRow(
        row({ website: "https://good.example/, http://bad.example/", matchedLore: null }),
      ),
    ).toThrow(HarvestFoldError);
  });

  it("fails loud when website or menu points to a social host", () => {
    expect(() =>
      parseOverlayRow(row({ website: "https://www.instagram.com/redlion", matchedLore: null })),
    ).toThrow(HarvestFoldError);
    expect(() =>
      parseOverlayRow(row({ menuUrl: "https://www.facebook.com/redlion", matchedLore: null })),
    ).toThrow(HarvestFoldError);
    expect(() =>
      parseOverlayRow(
        row({ website: "https://www.linkedin.com/company/redlion", matchedLore: null }),
      ),
    ).toThrow(HarvestFoldError);
    expect(() =>
      parseOverlayRow(
        row({ website: "https://www.threads.net/@redlion", matchedLore: null }),
      ),
    ).toThrow(HarvestFoldError);
    expect(() =>
      parseOverlayRow(
        row({ website: "https://instagram.com./redlion", matchedLore: null }),
      ),
    ).toThrow(HarvestFoldError);
  });

  it("fails loud when cited lore has no confirmed name and town match", () => {
    expect(() =>
      parseOverlayRow(
        row({
          name: "The Other Lion",
          matchedLore: {
            text: LORE_TEXT,
            citations: ["https://history.example/red-lion-clapham"],
          },
        }),
      ),
    ).toThrow(HarvestFoldError);
    expect(() =>
      parseOverlayRow(
        row({
          town: null,
          matchedLore: {
            text: LORE_TEXT,
            citations: ["https://history.example/red-lion-clapham"],
          },
        }),
      ),
    ).toThrow(HarvestFoldError);
  });

  it("fails loud when sources is not a clean https string array", () => {
    expect(() => parseOverlayRow(row({ sources: [42] }))).toThrow(HarvestFoldError);
    expect(() => parseOverlayRow(row({ sources: "https://redlion.example/" }))).toThrow(
      HarvestFoldError,
    );
  });

  it("fails loud when a social observation is present", () => {
    expect(() => parseOverlayRow(row({ social: "https://instagram.com/redlion" }))).toThrow(
      HarvestFoldError,
    );
    expect(() =>
      parseOverlayRow(row({ socials: [{ handle: "@redlion" }] })),
    ).toThrow(HarvestFoldError);
  });

  it("fails loud when lore citations or sources use social hosts", () => {
    expect(() =>
      parseOverlayRow(
        row({
          matchedLore: {
            text: LORE_TEXT,
            citations: ["https://instagram.com/redlion"],
          },
        }),
      ),
    ).toThrow(HarvestFoldError);
    expect(() =>
      parseOverlayRow(row({ matchedLore: null, sources: ["https://facebook.com/redlion"] })),
    ).toThrow(HarvestFoldError);
    expect(() =>
      parseOverlayRow(
        row({ matchedLore: null, sources: ["https://instagram.com./redlion"] }),
      ),
    ).toThrow(HarvestFoldError);
  });

  it("accepts a website-only row with social absent or null", () => {
    const parsed = parseOverlayRow(
      row({ matchedLore: null, menuUrl: null, social: null }),
    );
    expect(parsed.website).toBe("https://redlion.example/");
    expect(parsed.matchedLore).toBeNull();
  });
});

describe("canonicalOsmId / overlayLookupKeys", () => {
  it("maps OSM type/id, short ref, and salted venue ids onto one identity", () => {
    expect(canonicalOsmId("node/123")).toBe("node/123");
    expect(canonicalOsmId("n123")).toBe("node/123");
    expect(canonicalOsmId("venue-uk-n123")).toBe("node/123");
    expect(canonicalOsmId("venue-osm-w99")).toBe("way/99");
    expect(canonicalOsmId("venue-7l4pei")).toBeNull();
  });

  it("normalizes leading zeroes so equivalent OSM ids share lookup keys", () => {
    expect(canonicalOsmId("node/000123")).toBe("node/123");
    expect(canonicalOsmId("n000123")).toBe("node/123");
    expect(overlayLookupKeys("node/000123")).toEqual(overlayLookupKeys("node/123"));
  });

  it("rejects zero OSM ids after normalization", () => {
    expect(canonicalOsmId("node/0")).toBeNull();
    expect(canonicalOsmId("venue-uk-n000")).toBeNull();
  });

  it("never uses the pub name as a lookup key", () => {
    const keys = overlayLookupKeys("node/123");
    expect(keys).toEqual(
      expect.arrayContaining(["node/123", "n123", "venue-uk-n123", "venue-osm-n123"]),
    );
    expect(keys.some((key) => /red lion/i.test(key))).toBe(false);
  });
});

describe("fold-stats reconciliation", () => {
  const markdown = `# Fold-ready harvest stats

| Field | Rows | Share of 38484 pubs |
|---|---:|---:|
| Overlay row (any usable field) | 2 | 42.7% |
| https website | 2 | 39.2% |
| https menu URL | 1 | 8.2% |
| Matched lore | 1 | 14.2% |
| Social | 0 | 0.0% |
`;

  it("parses the fold-stats table", () => {
    expect(parseFoldStatsMarkdown(markdown)).toEqual({
      overlayRows: 2,
      httpsWebsite: 2,
      httpsMenuUrl: 1,
      matchedLore: 1,
      social: 0,
    });
  });

  it("fails loud when folded counts disagree with fold-stats.md", () => {
    const rows = parseOverlayJsonl(
      `${JSON.stringify(row())}\n${JSON.stringify(
        row({
          osmId: "node/456",
          menuUrl: null,
          matchedLore: null,
          sources: ["https://redlion.example/"],
        }),
      )}\n`,
    );
    expect(summariseOverlay(rows)).toEqual({
      overlayRows: 2,
      httpsWebsite: 2,
      httpsMenuUrl: 1,
      matchedLore: 1,
      social: 0,
    });
    expect(() =>
      reconcileFoldStats(summariseOverlay(rows), parseFoldStatsMarkdown(markdown)),
    ).not.toThrow();
    expect(() =>
      reconcileFoldStats(
        { overlayRows: 1, httpsWebsite: 2, httpsMenuUrl: 1, matchedLore: 1, social: 0 },
        parseFoldStatsMarkdown(markdown),
      ),
    ).toThrow(HarvestFoldError);
  });

  it("counts one accepted lore row per OSM id", () => {
    const rows = overlayRowsFromHarvestRecords([
      {
        osmId: "node/123",
        name: "The Red Lion",
        town: "Clapham",
        observations: [
          {
            kind: "history",
            value: LORE_TEXT,
            sourceUrl: "https://history.example/red-lion-clapham",
            fetchedAt: "2026-08-28T00:00:00.000Z",
          },
          {
            kind: "history",
            value: "The Red Lion in Clapham was rebuilt in 1900.",
            sourceUrl: "https://history.example/red-lion-rebuilt",
            fetchedAt: "2026-08-28T00:00:00.000Z",
          },
        ],
      },
    ]);

    expect(summariseOverlay(rows)).toMatchObject({
      overlayRows: 1,
      matchedLore: 1,
    });
  });
});

describe("heritageFactFromOverlay / public overlay", () => {
  it("emits source web with the first https citation", () => {
    const fact = heritageFactFromOverlay(parseOverlayRow(row()));
    expect(fact).toEqual({
      source: "web",
      fact: LORE_TEXT,
      sourceRef: "https://history.example/red-lion-clapham",
    });
  });

  it("drops lore from a public overlay when the citation is missing", () => {
    expect(parsePublicOverlay({ website: "https://ok.example/", lore: { fact: LORE_TEXT, source: "web" } })?.lore).toBeNull();
    expect(parsePublicOverlay({ lore: { fact: LORE_TEXT, source: "web", sourceRef: "http://insecure.example/" } })?.lore).toBeNull();
  });

  it("drops lore that loses its stored name and town proof", () => {
    const parsed = parseOverlayRow(row());
    expect(
      heritageFactFromOverlay({ ...parsed, loreName: undefined, loreTown: undefined }),
    ).toBeNull();
  });

  it("fills empty https website and menu, never overwrites an existing https URL, never copies lore", () => {
    const overlay = parseOverlayRow(row());
    const filled = applyHarvestWebsiteMenu({ website: "", menuUrl: "" }, overlay);
    expect(filled.website).toBe("https://redlion.example/");
    expect(filled.menuUrl).toBe("https://redlion.example/menu");
    expect("matchedLore" in filled).toBe(false);

    const kept = applyHarvestWebsiteMenu(
      { website: "https://curated.example/", menuUrl: "https://curated.example/menu" },
      overlay,
    );
    expect(kept.website).toBe("https://curated.example/");
    expect(kept.menuUrl).toBe("https://curated.example/menu");

    const skipped = applyHarvestWebsiteMenu(
      { website: "http://legacy.example/" },
      parseOverlayRow(
        row({
          website: "https://theimperialpub.com, https://other.example/",
          menuUrl: null,
          matchedLore: null,
        }),
      ),
    );
    expect(skipped).not.toHaveProperty("website");
  });

  it("folds completed harvest observations into gated overlay rows", () => {
    const rows = overlayRowsFromHarvestRecords([
      {
        osmId: "node/123",
        name: "The Red Lion",
        town: "Clapham",
        observations: [
          {
            kind: "website",
            value: "https://redlion.example/",
            sourceUrl: "https://redlion.example/",
            fetchedAt: "2026-08-28T00:00:00.000Z",
          },
          {
            kind: "menu",
            value: "https://redlion.example/menu",
            sourceUrl: "https://redlion.example/menu",
            fetchedAt: "2026-08-28T00:00:00.000Z",
          },
          {
            kind: "history",
            value: LORE_TEXT,
            sourceUrl: "https://history.example/red-lion-clapham",
            fetchedAt: "2026-08-28T00:00:00.000Z",
          },
          {
            kind: "social",
            value: "https://instagram.com/redlion",
            sourceUrl: "https://instagram.com/redlion",
            fetchedAt: "2026-08-28T00:00:00.000Z",
          },
        ],
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      osmId: "node/123",
      website: "https://redlion.example/",
      menuUrl: "https://redlion.example/menu",
      matchedLore: { text: LORE_TEXT },
    });
    expect(rows[0].matchedLore?.citations).toEqual([
      "https://history.example/red-lion-clapham",
    ]);
  });

  it("keeps one ordinary CTA from multiple website observations", () => {
    const rows = overlayRowsFromHarvestRecords([
      {
        osmId: "node/123",
        name: "The Red Lion",
        town: "Clapham",
        observations: [
          {
            kind: "website",
            value: "https://redlion.example/",
            sourceUrl: "https://redlion.example/",
            fetchedAt: "2026-08-28T00:00:00.000Z",
          },
          {
            kind: "website",
            value: "https://redlion.example/about",
            sourceUrl: "https://redlion.example/about",
            fetchedAt: "2026-08-28T00:00:00.000Z",
          },
        ],
      },
    ]);

    expect(rows[0].website).toBe("https://redlion.example/");
    expect(parsePublicOverlay(rows[0])?.website).toBe("https://redlion.example/");
  });

  it("preserves an explicit concatenated harvest field for serving to drop", () => {
    const rows = overlayRowsFromHarvestRecords([
      {
        osmId: "node/456",
        name: "The Red Lion",
        town: "Clapham",
        observations: [
          {
            kind: "website",
            value: "https://theimperialpub.com, https://imperialarmschislehurst.co.uk",
            sourceUrl: "https://theimperialpub.com",
            fetchedAt: "2026-08-28T00:00:00.000Z",
          },
        ],
      },
    ]);

    expect(rows[0].website).toBe(
      "https://theimperialpub.com, https://imperialarmschislehurst.co.uk",
    );
    expect(parsePublicOverlay(rows[0])?.website).toBeNull();
  });

  it("excludes social-host website observations", () => {
    expect(() =>
      overlayRowsFromHarvestRecords([
        {
          osmId: "node/123",
          name: "The Red Lion",
          town: "Clapham",
          observations: [
            {
              kind: "website",
              value: "https://www.instagram.com/redlion",
              sourceUrl: "https://www.instagram.com/redlion",
              fetchedAt: "2026-08-28T00:00:00.000Z",
            },
          ],
        },
      ]),
    ).toThrow(HarvestFoldError);
  });

  it("fails loud on malformed social observation source URLs", () => {
    expect(() =>
      overlayRowsFromHarvestRecords([
        {
          osmId: "node/123",
          name: "The Red Lion",
          town: "Clapham",
          observations: [
            {
              kind: "social",
              value: "@redlion",
              sourceUrl: "not-a-url",
              fetchedAt: "2026-08-28T00:00:00.000Z",
            },
          ],
        },
      ]),
    ).toThrow(HarvestFoldError);
  });

  it("fails loud on malformed observation timestamps", () => {
    expect(() =>
      overlayRowsFromHarvestRecords([
        {
          osmId: "node/123",
          name: "The Red Lion",
          town: "Clapham",
          observations: [
            {
              kind: "website",
              value: "https://redlion.example/",
              sourceUrl: "https://redlion.example/",
              fetchedAt: "not-a-timestamp",
            },
          ],
        },
      ]),
    ).toThrow(HarvestFoldError);
  });

  it("fails loud on non-string observation kinds", () => {
    expect(() =>
      overlayRowsFromHarvestRecords([
        {
          osmId: "node/123",
          name: "The Red Lion",
          town: "Clapham",
          observations: [
            {
              kind: ["website"] as unknown as "website",
              value: "https://redlion.example/",
              sourceUrl: "https://redlion.example/",
              fetchedAt: "2026-08-28T00:00:00.000Z",
            },
          ],
        },
      ]),
    ).toThrow(HarvestFoldError);
  });

  it("fails loud on timestamps without the producer ISO format", () => {
    expect(() =>
      overlayRowsFromHarvestRecords([
        {
          osmId: "node/123",
          name: "The Red Lion",
          town: "Clapham",
          observations: [
            {
              kind: "website",
              value: "https://redlion.example/",
              sourceUrl: "https://redlion.example/",
              fetchedAt: "2026",
            },
          ],
        },
      ]),
    ).toThrow(HarvestFoldError);
  });

  it("fails loud on timestamps with invalid calendar dates", () => {
    expect(() =>
      overlayRowsFromHarvestRecords([
        {
          osmId: "node/123",
          name: "The Red Lion",
          town: "Clapham",
          observations: [
            {
              kind: "website",
              value: "https://redlion.example/",
              sourceUrl: "https://redlion.example/",
              fetchedAt: "2026-02-30T00:00:00.000Z",
            },
          ],
        },
      ]),
    ).toThrow(HarvestFoldError);
  });

  it("fails loud before excluding social observations with non-https URLs", () => {
    expect(() =>
      overlayRowsFromHarvestRecords([
        {
          osmId: "node/123",
          name: "The Red Lion",
          town: "Clapham",
          observations: [
            {
              kind: "social",
              value: "http://instagram.com/redlion",
              sourceUrl: "http://instagram.com/redlion",
              fetchedAt: "2026-08-28T00:00:00.000Z",
            },
          ],
        },
      ]),
    ).toThrow(HarvestFoldError);
  });

  it("fails loud on duplicate OSM overlay rows", () => {
    expect(() =>
      parseOverlayJsonl(`${JSON.stringify(row())}\n${JSON.stringify(row({ website: "https://other.example/" }))}`),
    ).toThrow(HarvestFoldError);
  });
});

describe("harvest overlay payload boundary", () => {
  it("keeps harvest fields out of slim pins and UK base payloads", () => {
    const pin = slimVenueToPin({
      id: "venue-uk-n123",
      name: "The Red Lion",
      lat: 51.1,
      lng: -0.1,
      cheapestPrice: null,
      borough: "Clapham",
      website: "https://redlion.example/",
      menuUrl: "https://redlion.example/menu",
      matchedLore: {
        fact: LORE_TEXT,
        source: "web",
        sourceRef: "https://history.example/red-lion-clapham",
      },
    } as never);
    const base = parseUkBaseShard({
      version: 1,
      cell: "51.00_-0.25",
      pubs: [["n123", "The Red Lion", "Clapham", 51.1, -0.1, ""]],
    });

    expect(pin.website).toBe("");
    expect(pin.menuUrl).toBeUndefined();
    expect(base[0]).not.toHaveProperty("website");
    expect(base[0]).not.toHaveProperty("matchedLore");
  });
});
