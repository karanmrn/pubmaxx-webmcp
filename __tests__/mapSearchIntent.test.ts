import { describe, expect, it } from "vitest";

import {
  classifyMapSearchIntent,
  intentLooksLikeVenueSearch,
} from "@/lib/mapSearchIntent";

describe("classifyMapSearchIntent", () => {
  it("labels an exact London borough ahead of a soft venue bucket", () => {
    const intent = classifyMapSearchIntent("Hackney");
    expect(intent.primary).toBe("borough");
    expect(intent.candidates[0]?.label).toBe("Hackney");
  });

  it("labels an enabled city", () => {
    const intent = classifyMapSearchIntent("London");
    expect(intent.primary).toBe("city");
  });

  it("labels a modelled night area", () => {
    const intent = classifyMapSearchIntent("Shoreditch");
    expect(["area", "borough"]).toContain(intent.primary);
    expect(intent.candidates.some((row) => row.label === "Shoreditch")).toBe(
      true,
    );
  });

  it("treats pub-like wording as a venue search", () => {
    const intent = classifyMapSearchIntent("The Philharmonic Dining Rooms");
    expect(intentLooksLikeVenueSearch(intent)).toBe(true);
    expect(intent.candidates.some((row) => row.kind === "venue")).toBe(true);
  });

  it("returns unknown for empty input", () => {
    expect(classifyMapSearchIntent(" ").primary).toBe("unknown");
  });
});
