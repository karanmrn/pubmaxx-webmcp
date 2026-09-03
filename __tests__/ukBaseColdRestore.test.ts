import { describe, expect, it, vi } from "vitest";

import {
  parseUkBaseRestoreResponse,
  resolveUkBaseRestorePub,
} from "@/components/map/pubmap/useUkBaseStreaming";
import type { UkBaseLoader, UkBasePub } from "@/lib/ukBasePubs";

const PUB: UkBasePub = {
  id: "venue-uk-n1",
  name: "The Anchor",
  address: "1 Dock Road",
  lat: 51.42,
  lng: -0.18,
  curatedVenueId: "",
};

function loader(restore: UkBasePub | null): UkBaseLoader {
  return {
    pubsForBounds: async () => ({ status: "ready", pubs: [] }),
    find: () => null,
    restorePub: async () => restore,
  };
}

describe("parseUkBaseRestoreResponse", () => {
  it("accepts a well-formed API payload for the expected id", () => {
    expect(parseUkBaseRestoreResponse({ pub: PUB }, "venue-uk-n1")).toEqual(PUB);
  });

  it("rejects a mismatched id, curated id, or shapeless body", () => {
    expect(parseUkBaseRestoreResponse({ pub: PUB }, "venue-uk-n2")).toBeNull();
    expect(
      parseUkBaseRestoreResponse(
        { pub: { ...PUB, id: "venue-7l4pei" } },
        "venue-7l4pei",
      ),
    ).toBeNull();
    expect(parseUkBaseRestoreResponse(null, "venue-uk-n1")).toBeNull();
    expect(parseUkBaseRestoreResponse({ pub: { id: "venue-uk-n1" } }, "venue-uk-n1")).toBeNull();
  });
});

describe("resolveUkBaseRestorePub", () => {
  it("prefers the hint-scoped loader hit over the network", async () => {
    const fetchById = vi.fn(async () => ({
      pub: null,
      failure: "missing" as const,
    }));
    const result = await resolveUkBaseRestorePub(
      loader(PUB),
      "venue-uk-n1",
      { lat: 51.42, lng: -0.18 },
      fetchById,
    );
    expect(result).toEqual({ pub: PUB, failure: null });
    expect(fetchById).not.toHaveBeenCalled();
  });

  it("falls back to the server lookup and fails closed on a miss", async () => {
    const fetchById = vi.fn(async () => ({
      pub: null,
      failure: "missing" as const,
    }));
    const result = await resolveUkBaseRestorePub(
      loader(null),
      "venue-uk-n1",
      null,
      fetchById,
    );
    expect(result).toEqual({ pub: null, failure: "missing" });
    expect(fetchById).toHaveBeenCalledOnce();
  });

  it("rejects a non-base id without fetching", async () => {
    const fetchById = vi.fn(async () => ({
      pub: null,
      failure: "missing" as const,
    }));
    const result = await resolveUkBaseRestorePub(
      loader(null),
      "venue-7l4pei",
      null,
      fetchById,
    );
    expect(result).toEqual({ pub: null, failure: "missing" });
    expect(fetchById).not.toHaveBeenCalled();
  });
});
