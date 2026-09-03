import { describe, expect, it } from "vitest";

import { trimCityBuzz } from "@/lib/citymcp/buzz";

describe("trimCityBuzz", () => {
  it("returns null for non-objects and missing buzz", () => {
    expect(trimCityBuzz(undefined)).toBeNull();
    expect(trimCityBuzz(null)).toBeNull();
    expect(trimCityBuzz("nope")).toBeNull();
    expect(trimCityBuzz({})).toBeNull();
    expect(trimCityBuzz({ name: "The George" })).toBeNull();
    expect(trimCityBuzz({ buzz: {} })).toBeNull();
    expect(trimCityBuzz({ buzz: { value: {} } })).toBeNull();
  });

  it("trims summary and https mentions, dropping everything else", () => {
    const out = trimCityBuzz({
      name: "The George",
      buzz: {
        value: {
          summary: "Praised for its galleried yard; queues on weekends.",
          mentions: [
            { label: "The Infatuation", url: "https://www.theinfatuation.com/x" },
            { label: "Dodgy", url: "http://insecure.example.com" },
            { label: "Relative", url: "/reviews/george" },
            { label: "", url: "https://empty-label.example.com" },
            { url: "https://www.tripadvisor.co.uk/y", name: "Tripadvisor" },
          ],
          extraneous: "dropped",
        },
        source: "CityMCP",
      },
    });
    expect(out).not.toBeNull();
    expect(out?.summary).toMatch(/galleried yard/);
    expect(out?.mentions).toEqual([
      { label: "The Infatuation", url: "https://www.theinfatuation.com/x" },
      { label: "empty-label.example.com", url: "https://empty-label.example.com" },
      { label: "Tripadvisor", url: "https://www.tripadvisor.co.uk/y" },
    ]);
    expect(out as object).not.toHaveProperty("extraneous");
  });

  it("reads a dossier nested under `place`", () => {
    const out = trimCityBuzz({
      place: {
        buzz: { value: { summary: "Nested summary." } },
      },
    });
    expect(out?.summary).toBe("Nested summary.");
    expect(out?.mentions).toEqual([]);
  });

  it("caps mentions at 6", () => {
    const mentions = Array.from({ length: 10 }, (_, i) => ({
      label: `Press ${i}`,
      url: `https://press${i}.example.com`,
    }));
    const out = trimCityBuzz({ buzz: { value: { mentions } } });
    expect(out?.mentions).toHaveLength(6);
  });

  it("returns a mentions-only block when there is no summary", () => {
    const out = trimCityBuzz({
      buzz: {
        value: {
          mentions: [{ label: "Infatuation", url: "https://a.example.com" }],
        },
      },
    });
    expect(out?.summary).toBeUndefined();
    expect(out?.mentions).toHaveLength(1);
  });

  it("truncates absurdly long summaries with an ellipsis", () => {
    const out = trimCityBuzz({
      buzz: { value: { summary: "x".repeat(5000) } },
    });
    expect(out?.summary?.length).toBeLessThanOrEqual(1200);
    expect(out?.summary?.endsWith("…")).toBe(true);
  });

  it("returns null when every mention is non-https and there is no summary", () => {
    const out = trimCityBuzz({
      buzz: {
        value: {
          mentions: [{ label: "Http only", url: "http://a.example.com" }],
        },
      },
    });
    expect(out).toBeNull();
  });
});
