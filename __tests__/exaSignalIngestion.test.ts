import { describe, expect, it } from "vitest";
import { NIGHT_AREA_SLUGS } from "@/lib/nightAreas";
import { validateNightSignalClaim } from "@/lib/nightSignalClaims";
// The Exa ingestion is JavaScript by design (it mirrors the scheduled refresh
// importer). Its pure normalisers are exercised here against fixture payloads;
// the network call itself is never touched.
// @ts-expect-error no declaration file for the scheduled ingestion script
import { NIGHT_AREA_MATCHERS, EXA_QUERY_SET, normalizeSourceUrl, publisherFromUrl, isVagueTitle, matchNightArea, exaResultToCandidate, buildCandidates } from "@/scripts/ingest_night_signal_candidates.mjs";

const NOW = Date.parse("2026-07-18T12:00:00.000Z");

const goodResult = {
  title: "The Camden Arms reopens as a late-night taproom on Chalk Farm Road",
  url: "https://www.theinfatuation.com/london/reviews/camden-arms?utm_source=newsletter#top",
  publishedDate: "2026-07-10T09:00:00.000Z",
  text: "The Camden pub pours a rotating list of cask ale and stays open until 1am.",
};

describe("Exa night-signal candidate ingestion", () => {
  it("keeps the area matchers in lockstep with lib/nightAreas.ts", () => {
    const matcherSlugs = NIGHT_AREA_MATCHERS.map((area: { slug: string }) => area.slug).sort();
    expect(matcherSlugs).toEqual([...NIGHT_AREA_SLUGS].sort());
    for (const area of NIGHT_AREA_MATCHERS) {
      expect(area.terms.length).toBeGreaterThan(0);
    }
  });

  it("only queries buzz classes the claim contract can carry", () => {
    expect(EXA_QUERY_SET.length).toBeGreaterThan(0);
    for (const entry of EXA_QUERY_SET) {
      expect(["opening", "event"]).toContain(entry.kind);
      expect(entry.query.length).toBeGreaterThan(10);
    }
  });

  it("strips tracking params and rejects non-https or credentialled URLs", () => {
    expect(normalizeSourceUrl("https://www.example.com/a/b/?utm=1#x")).toBe("https://www.example.com/a/b");
    expect(normalizeSourceUrl("https://example.com/")).toBe("https://example.com/");
    expect(normalizeSourceUrl("http://example.com/a")).toBeNull();
    expect(normalizeSourceUrl("https://user:pass@example.com/a")).toBeNull();
    expect(normalizeSourceUrl("not a url")).toBeNull();
    expect(publisherFromUrl("https://www.theinfatuation.com/london")).toBe("theinfatuation.com");
  });

  it("treats thin or generic headlines as vague", () => {
    expect(isVagueTitle("")).toBe(true);
    expect(isVagueTitle("Pub news")).toBe(true);
    expect(isVagueTitle("!!!! ---- ???? ....")).toBe(true);
    expect(isVagueTitle("A new craft-beer taproom opens in Shoreditch this week")).toBe(false);
  });

  it("matches the most specific night area and ignores non-areas", () => {
    expect(matchNightArea("A new bar near Clapham Junction station")).toBe("clapham");
    expect(matchNightArea("Drinks around Clapham Common")).toBe("clapham");
    expect(matchNightArea("A pub in Manchester's Northern Quarter")).toBeNull();
  });

  it("normalises a real dated attributable result into a pending contract-valid claim", () => {
    const candidate = exaResultToCandidate(goodResult, { kind: "opening", now: NOW });
    expect(candidate).not.toBeNull();
    expect(candidate.entity).toEqual({ type: "night_area", id: "camden" });
    expect(candidate.claim).toBe(goodResult.title);
    expect(candidate.sourceUrl).toBe("https://www.theinfatuation.com/london/reviews/camden-arms");
    expect(candidate.reviewState).toBe("pending");
    expect(candidate.verification).toBe("single_source");
    expect(candidate.routeEffect).toBe("none");
    expect(candidate.reviewedAt).toBeNull();
    // The runtime contract used by the route must accept it verbatim.
    expect(validateNightSignalClaim(candidate)).not.toBeNull();
  });

  it("drops results that are undated, future-dated, vague, off-area or not pub-relevant", () => {
    expect(exaResultToCandidate({ ...goodResult, publishedDate: undefined }, { kind: "opening", now: NOW })).toBeNull();
    expect(exaResultToCandidate({ ...goodResult, publishedDate: "2026-08-01T00:00:00.000Z" }, { kind: "opening", now: NOW })).toBeNull();
    expect(exaResultToCandidate({ ...goodResult, title: "News" }, { kind: "opening", now: NOW })).toBeNull();
    expect(exaResultToCandidate({ ...goodResult, url: "http://example.com/x" }, { kind: "opening", now: NOW })).toBeNull();
    // Mentions a London area but nothing pub-related.
    expect(exaResultToCandidate(
      { title: "Camden Council approves a new cycle lane on the high street", url: "https://news.example.com/camden-cycle", publishedDate: "2026-07-10T09:00:00.000Z", text: "Transport plan for Camden." },
      { kind: "event", now: NOW },
    )).toBeNull();
    // Pub-relevant but names no covered area.
    expect(exaResultToCandidate(
      { title: "A brilliant new craft-beer pub opens in Leeds this week", url: "https://news.example.com/leeds-pub", publishedDate: "2026-07-10T09:00:00.000Z", text: "Great ale in Leeds." },
      { kind: "opening", now: NOW },
    )).toBeNull();
  });

  it("dedupes by id, caps output and yields only contract-valid claims", () => {
    const groups = [
      { kind: "opening", results: [goodResult, goodResult] },
      { kind: "event", results: [{
        title: "This Shoreditch boozer just won London Pub of the Year at the awards",
        url: "https://www.timeout.com/london/pubs/shoreditch-winner",
        publishedDate: "2026-07-12T10:00:00.000Z",
        text: "The Old Street pub took the top prize for its cask ale.",
      }] },
    ];
    const candidates = buildCandidates(groups, { now: NOW });
    expect(candidates).toHaveLength(2);
    const ids = candidates.map((c: { id: string }) => c.id);
    expect(new Set(ids).size).toBe(2);
    for (const candidate of candidates) {
      expect(validateNightSignalClaim(candidate)).not.toBeNull();
      expect(candidate.reviewState).toBe("pending");
    }
    expect(buildCandidates(groups, { now: NOW, max: 1 })).toHaveLength(1);
  });
});
