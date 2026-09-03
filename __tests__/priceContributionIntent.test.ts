import { describe, expect, it } from "vitest";

import {
  clearRememberedPriceContribution,
  hasPriceContributionIntent,
  hasRememberedPriceContribution,
  rememberPriceContribution,
  runPriceContributionRequest,
  runPriceContributionReturn,
  withPriceContributionIntent,
  withoutPriceContributionIntent,
} from "@/lib/priceContributionIntent";

describe("price contribution return intent", () => {
  it("adds the price intent without losing the selected venue or fragment", () => {
    expect(
      withPriceContributionIntent(
        "https://pubmaxxing.com/map?sel=venue-16pnwmm#sheet",
      ),
    ).toBe("/map?sel=venue-16pnwmm&contribute=price#sheet");
  });

  it("consumes only the price intent after sign-in", () => {
    expect(
      withoutPriceContributionIntent(
        "https://pubmaxxing.com/map?sel=venue-16pnwmm&contribute=price&lens=beer",
      ),
    ).toBe("/map?sel=venue-16pnwmm&lens=beer");
  });

  it("recognises only the closed price intent", () => {
    expect(
      hasPriceContributionIntent(
        "https://pubmaxxing.com/map?sel=venue-16pnwmm&contribute=price",
      ),
    ).toBe(true);
    expect(
      hasPriceContributionIntent(
        "https://pubmaxxing.com/map?sel=venue-16pnwmm&contribute=drop",
      ),
    ).toBe(false);
    expect(hasPriceContributionIntent("not a URL")).toBe(false);
  });

  it("leaves malformed input alone when adding or removing intent", () => {
    expect(withPriceContributionIntent("not a URL")).toBe("not a URL");
    expect(withoutPriceContributionIntent("not a URL")).toBe("not a URL");
  });

  it("remembers the venue across an auth reload and expires the intent", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    const startedAt = Date.parse("2026-07-29T18:00:00.000Z");

    rememberPriceContribution(storage, "venue-16pnwmm", startedAt);

    expect(
      hasRememberedPriceContribution(storage, "venue-16pnwmm", startedAt),
    ).toBe(true);
    expect(
      hasRememberedPriceContribution(storage, "venue-other", startedAt),
    ).toBe(false);
    expect(
      hasRememberedPriceContribution(
        storage,
        "venue-16pnwmm",
        startedAt + 60 * 60 * 1000 + 1,
      ),
    ).toBe(false);

    clearRememberedPriceContribution(storage);
    expect(
      hasRememberedPriceContribution(storage, "venue-16pnwmm", startedAt),
    ).toBe(false);
  });

  it("runs the signed-out gate and resumes the same venue after injected sign-in", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    const events: string[] = [];
    let currentUrl =
      "https://pubmaxxing.com/map?sel=venue-16pnwmm";
    const actions = {
      replaceUrl: (url: string) => {
        currentUrl = `https://pubmaxxing.com${url}`;
        events.push(`url:${url}`);
      },
      showSignIn: () => events.push("sign-in"),
      openForm: () => events.push("form"),
    };

    runPriceContributionRequest({
      authConfigured: true,
      userPresent: false,
      venueId: "venue-16pnwmm",
      currentUrl,
      storage,
      actions,
    });

    expect(events).toEqual([
      "url:/map?sel=venue-16pnwmm&contribute=price",
      "sign-in",
    ]);
    expect(
      hasRememberedPriceContribution(storage, "venue-16pnwmm"),
    ).toBe(true);

    events.length = 0;
    runPriceContributionReturn({
      authConfigured: true,
      authLoading: false,
      userPresent: true,
      venueId: "venue-16pnwmm",
      requestedVenueId: null,
      currentUrl,
      storage,
      actions,
    });

    expect(events).toEqual([
      "url:/map?sel=venue-16pnwmm",
      "form",
    ]);
    expect(
      hasRememberedPriceContribution(storage, "venue-16pnwmm"),
    ).toBe(false);
  });

  it("abandons a pending contribution rather than moving it to another venue", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    rememberPriceContribution(storage, "venue-original");
    const events: string[] = [];

    runPriceContributionReturn({
      authConfigured: true,
      authLoading: false,
      userPresent: false,
      venueId: "venue-other",
      requestedVenueId: "venue-original",
      currentUrl:
        "https://pubmaxxing.com/map?sel=venue-other&contribute=price",
      storage,
      actions: {
        replaceUrl: (url) => events.push(`url:${url}`),
        showSignIn: () => events.push("sign-in"),
        openForm: () => events.push("form"),
        abandon: () => events.push("abandon"),
      },
    });

    expect(events).toEqual([
      "url:/map?sel=venue-other",
      "abandon",
    ]);
    expect(
      hasRememberedPriceContribution(storage, "venue-original"),
    ).toBe(false);
  });

  it("does not reopen a sign-in gate already shown for the same venue", () => {
    const events: string[] = [];

    runPriceContributionReturn({
      authConfigured: true,
      authLoading: false,
      userPresent: false,
      venueId: "venue-16pnwmm",
      requestedVenueId: "venue-16pnwmm",
      currentUrl:
        "https://pubmaxxing.com/map?sel=venue-16pnwmm&contribute=price",
      storage: null,
      actions: {
        replaceUrl: (url) => events.push(`url:${url}`),
        showSignIn: () => events.push("sign-in"),
        openForm: () => events.push("form"),
      },
    });

    expect(events).toEqual([]);
  });
});
