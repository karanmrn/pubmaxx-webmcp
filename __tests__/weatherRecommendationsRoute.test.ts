import { beforeEach, describe, expect, it, vi } from "vitest";

const venueState = vi.hoisted(() => ({
  unavailable: false,
  kind: "pub" as "pub" | "bar",
}));

vi.mock("@/lib/venueIndex", () => ({
  lookupCanonicalVenue: async (id: string) => {
    const canonicalId = id === "venue-legacy" ? "venue-test" : id;
    if (venueState.unavailable) {
      return { status: "unavailable" as const, canonicalId };
    }
    if (canonicalId !== "venue-test") {
      return { status: "unknown" as const, canonicalId };
    }
    return {
      status: "found" as const,
      canonicalId,
      venue: {
        id: canonicalId,
        name: "The Test Arms",
        borough: "Soho",
        lat: 51.511,
        lng: -0.134,
        kind: venueState.kind,
      },
    };
  },
}));

const weatherState = vi.hoisted(() => ({
  snapshot: null as import("@/lib/weatherSnapshots").WeatherSnapshot | null,
  reads: 0,
}));

const contributionIdentityState = vi.hoisted(() => ({
  resolution: {
    ok: true as const,
    accountId: "night-owl-account",
    actor: "profile:night-owl-profile",
    handle: "night_owl",
  } as import("@/lib/contributionIdentity.server").ContributionIdentityResolution,
}));

vi.mock("@/lib/contributionIdentity.server", () => ({
  resolveContributionIdentity: async () => contributionIdentityState.resolution,
}));

vi.mock("@/lib/weatherSnapshots.server", () => ({
  loadWeatherSnapshot: async () => {
    weatherState.reads += 1;
    return weatherState.snapshot;
  },
}));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
  };
});

import {
  GET,
  POST,
} from "@/app/api/weather-recommendations/route";
import { __resetPintDrops } from "@/lib/pintDrops";
import { __resetWeatherSnapshotMemo } from "@/lib/weatherRecommendationSnapshotMemo.server";
import {
  __resetWeatherRecommendations,
  memoryWeatherRecommendationStore,
} from "@/lib/weatherRecommendationStore";
import type { WeatherSnapshot } from "@/lib/weatherSnapshots";
import { WEATHER_RECOMMENDATION_RESPONSE_BUDGET_BYTES } from "@/lib/weatherRecommendations";

function snapshot(
  overrides: Partial<WeatherSnapshot["observations"][number]> = {},
): WeatherSnapshot {
  return {
    version: 1,
    generatedAt: "2026-07-28T00:00:00.000Z",
    observations: [
      {
        nightArea: "piccadilly-soho",
        observedAt: "2026-07-28T00:00:00.000Z",
        expiresAt: "2099-07-29T00:00:00.000Z",
        condition: "Clear",
        feelsLikeC: 20,
        precipitationProbabilityPct: 5,
        windKph: 8,
        source: {
          sourceUrl: "https://api.open-meteo.com/v1/forecast?test",
          publisher: "Open-Meteo",
          publishedAt: "2026-07-28T00:00:00.000Z",
        },
        ...overrides,
      },
    ],
  };
}

function post(body: unknown, ip = "198.51.100.4"): Request {
  return new Request("http://localhost/api/weather-recommendations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

function get(venueId = "venue-test"): Request {
  return new Request(
    `http://localhost/api/weather-recommendations?venueId=${encodeURIComponent(venueId)}`,
  );
}

beforeEach(() => {
  venueState.unavailable = false;
  venueState.kind = "pub";
  weatherState.snapshot = snapshot();
  weatherState.reads = 0;
  contributionIdentityState.resolution = {
    ok: true,
    accountId: "night-owl-account",
    actor: "profile:night-owl-profile",
    handle: "night_owl",
  };
  __resetPintDrops();
  __resetWeatherRecommendations();
  __resetWeatherSnapshotMemo();
});

describe("POST /api/weather-recommendations", () => {
  it("attributes an attacker's post to the authenticated account, not the claimed victim", async () => {
    contributionIdentityState.resolution = {
      ok: true,
      accountId: "attacker-account",
      actor: "profile:attacker-profile",
      handle: "attacker",
    };

    const response = await POST(
      post({
        venueId: "venue-test",
        condition: "warm",
        reason: "The back garden catches the evening light.",
        contributorHandle: "victim",
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      recommendation: { contributorHandle: "attacker" },
    });
    expect(
      await memoryWeatherRecommendationStore.countForContributor("attacker"),
    ).toEqual({ status: "ready", count: 1 });
    expect(
      await memoryWeatherRecommendationStore.countForContributor("victim"),
    ).toEqual({ status: "ready", count: 0 });
  });

  it("requires the established account prompt without orphaning a legacy unlinked row", async () => {
    await memoryWeatherRecommendationStore.create(
      {
        venueId: "venue-test",
        condition: "cold",
        reason: "The old snug keeps the draught out.",
        contributorHandle: "legacy_writer",
        actorHash: "legacy-device-actor",
      },
      1_000,
    );
    contributionIdentityState.resolution = {
      ok: false,
      body: {
        status: "sign_in_required",
        error: "Sign in to contribute.",
      },
      httpStatus: 401,
    };

    const rejected = await POST(
      post({
        venueId: "venue-test",
        condition: "warm",
        reason: "The back garden catches the evening light.",
        contributorHandle: "legacy_writer",
      }),
    );

    expect(rejected.status).toBe(401);
    expect(await rejected.json()).toMatchObject({
      status: "sign_in_required",
      error: "Sign in to contribute.",
    });
    expect(
      await memoryWeatherRecommendationStore.countForContributor("legacy_writer"),
    ).toEqual({ status: "ready", count: 1 });
  });

  it("stores a validated, canonical, attributed opinion", async () => {
    const response = await POST(
      post({
        venueId: "venue-legacy",
        condition: "warm",
        reason: "The back garden catches the evening light.",
        contributorHandle: "@Night_Owl",
      }),
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      recommendation: Record<string, unknown>;
    };
    expect(body.recommendation).toMatchObject({
      venueId: "venue-test",
      condition: "warm",
      reason: "The back garden catches the evening light.",
      contributorHandle: "night_owl",
      source: "community",
    });
    expect(body.recommendation.submittedAt).toEqual(expect.any(Number));
    expect(JSON.stringify(body)).not.toContain("actor");
  });

  it("ignores client-supplied provenance and clock fields", async () => {
    const response = await POST(
      post({
        venueId: "venue-test",
        condition: "cold",
        reason: "The front snug keeps the draught out.",
        contributorHandle: "night_owl",
        source: "verified",
        submittedAt: 1,
        actorHash: "client-lie",
      }),
    );
    const body = (await response.json()) as {
      recommendation: { source: string; submittedAt: number };
    };

    expect(response.status).toBe(201);
    expect(body.recommendation.source).toBe("community");
    expect(body.recommendation.submittedAt).toBeGreaterThan(1);
    expect(JSON.stringify(body)).not.toContain("client-lie");
  });

  it("rejects unknown conditions, short reasons, and unknown venues", async () => {
    expect(
      (
        await POST(
          post({
            venueId: "venue-test",
            condition: "snowy",
            reason: "Snow settles outside.",
            contributorHandle: "night_owl",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          post({
            venueId: "venue-test",
            condition: "warm",
            reason: "Nice.",
            contributorHandle: "night_owl",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          post({
            venueId: "venue-missing",
            condition: "warm",
            reason: "The garden keeps the evening light.",
            contributorHandle: "night_owl",
          }),
        )
      ).status,
    ).toBe(400);
  });

  it("answers 503 when venue membership cannot be checked", async () => {
    venueState.unavailable = true;
    const response = await POST(
      post({
        venueId: "venue-test",
        condition: "warm",
        reason: "The garden keeps the evening light.",
        contributorHandle: "night_owl",
      }),
    );
    expect(response.status).toBe(503);
  });

  it("answers 503 when account contribution identity cannot be resolved", async () => {
    contributionIdentityState.resolution = {
      ok: false,
      accountId: "night-owl-account",
      body: {
        error: "Contribution identity is unavailable right now.",
      },
      httpStatus: 503,
    };
    const response = await POST(
      post({
        venueId: "venue-test",
        condition: "warm",
        reason: "The garden keeps the evening light.",
        contributorHandle: "night_owl",
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "Contribution identity is unavailable right now.",
    });
  });

  it("requires completed account onboarding", async () => {
    contributionIdentityState.resolution = {
      ok: false,
      accountId: "night-owl-account",
      body: {
        status: "onboarding_required",
        error:
          "Choose a public handle and add your date of birth before contributing.",
      },
      httpStatus: 409,
    };
    const response = await POST(
      post({
        venueId: "venue-test",
        condition: "warm",
        reason: "The garden keeps the evening light.",
        contributorHandle: "night_owl",
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      status: "onboarding_required",
    });
  });

  it("rate-limits one device churning recommendations at one pub", async () => {
    for (let index = 0; index < 6; index += 1) {
      const response = await POST(
        post({
          venueId: "venue-test",
          condition: "warm",
          reason: `The garden is worth choosing, version ${index}.`,
          contributorHandle: "night_owl",
        }),
      );
      expect(response.status, `write ${index + 1}`).toBe(index < 5 ? 201 : 429);
    }
  });

  it("lets a moderator pull and restore a Recommendation without deleting it", async () => {
    const created = await POST(
      post({
        venueId: "venue-test",
        condition: "warm",
        reason: "The garden catches the evening light.",
        contributorHandle: "night_owl",
      }),
    );
    const body = (await created.json()) as {
      recommendation: { id: string };
    };
    const originalToken = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = "moderator-secret";
    try {
      const moderate = (action: "hide" | "restore", token: string) =>
        POST(
          new Request("http://localhost/api/weather-recommendations", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-admin-token": token,
            },
            body: JSON.stringify({
              action,
              id: body.recommendation.id,
            }),
          }),
        );

      expect((await moderate("hide", "wrong")).status).toBe(403);
      expect((await moderate("hide", "moderator-secret")).status).toBe(200);
      expect(
        await memoryWeatherRecommendationStore.countForContributor("night_owl"),
      ).toEqual({ status: "ready", count: 0 });
      expect(
        (
          await memoryWeatherRecommendationStore.listLeaderboardContributions()
        ).records[0],
      ).toMatchObject({
        visible: false,
        quality: { moderation: "hidden" },
      });

      expect((await moderate("restore", "moderator-secret")).status).toBe(200);
      expect(
        await memoryWeatherRecommendationStore.countForContributor("night_owl"),
      ).toEqual({ status: "ready", count: 1 });
    } finally {
      if (originalToken === undefined) delete process.env.ADMIN_TOKEN;
      else process.env.ADMIN_TOKEN = originalToken;
    }
  });
});

describe("GET /api/weather-recommendations", () => {
  async function seed(
    condition: "warm" | "clear" | "raining" | "cold" | "windy",
    contributorHandle: string,
    now: number,
    reason = `A useful ${condition} reason for this pub.`,
  ) {
    await memoryWeatherRecommendationStore.create(
      {
        venueId: "venue-test",
        condition,
        reason,
        contributorHandle,
        actorHash: `actor-${contributorHandle}`,
      },
      now,
    );
  }

  it("surfaces only recommendations matching known current conditions", async () => {
    await seed("cold", "cold_friend", 1_000);
    await seed("warm", "warm_friend", 2_000);
    await seed("clear", "clear_friend", 3_000);

    const response = await GET(get());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      weatherStatus: "available",
      matchingConditions: ["warm", "clear"],
      recommendations: [
        expect.objectContaining({
          condition: "clear",
          contributorHandle: "clear_friend",
        }),
        expect.objectContaining({
          condition: "warm",
          contributorHandle: "warm_friend",
        }),
      ],
      degraded: false,
      truncated: false,
    });
  });

  it("shows authored recommendations unconditionally when weather is unavailable", async () => {
    await seed("cold", "cold_friend", 1_000);
    await seed("warm", "warm_friend", 2_000);
    weatherState.snapshot = null;

    const response = await GET(get());
    expect(await response.json()).toEqual({
      weatherStatus: "unavailable",
      matchingConditions: [],
      recommendations: [
        expect.objectContaining({ condition: "warm" }),
        expect.objectContaining({ condition: "cold" }),
      ],
      degraded: false,
      truncated: false,
    });
  });

  it("returns known weather with no matching opinion as an empty matched read", async () => {
    await seed("cold", "cold_friend", 1_000);

    const response = await GET(get());
    expect(await response.json()).toMatchObject({
      weatherStatus: "available",
      matchingConditions: ["warm", "clear"],
      recommendations: [],
    });
  });

  it("does not re-read the durable weather snapshot on every sheet opened", async () => {
    await seed("warm", "warm_friend", 1_000);

    const first = await GET(get());
    const second = await GET(get());
    await GET(get());

    expect(weatherState.reads).toBe(1);
    expect(await first.json()).toEqual(await second.json());

    __resetWeatherSnapshotMemo();
    await GET(get());
    expect(weatherState.reads).toBe(2);
  });

  it("keeps a maximum unavailable-weather response inside the live payload budget", async () => {
    weatherState.snapshot = null;
    for (let index = 0; index < 20; index += 1) {
      await seed(
        "warm",
        `person_${String(index).padStart(2, "0")}_${"x".repeat(18)}`,
        index,
        "R".repeat(160),
      );
    }

    const response = await GET(get());
    const raw = await response.text();
    expect(Buffer.byteLength(raw, "utf8")).toBeLessThanOrEqual(
      WEATHER_RECOMMENDATION_RESPONSE_BUDGET_BYTES,
    );
    expect(raw).not.toContain("actor-");
  });
});
