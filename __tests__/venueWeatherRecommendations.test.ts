import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import VenueWeatherRecommendations, {
  WeatherRecommendationList,
  readWeatherRecommendationVenueLoad,
} from "@/components/map/VenueWeatherRecommendations";
import type { WeatherRecommendation } from "@/lib/weatherRecommendations";

const authState = vi.hoisted(() => ({
  user: { id: "account-1" } as { id: string } | null,
  session: {
    access_token: "session-token",
    user: { id: "account-1" },
  } as { access_token: string; user: { id: string } } | null,
  handle: "night_owl" as string | null,
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: authState.user,
    session: authState.session,
    handle: authState.handle,
  }),
}));

beforeEach(() => {
  authState.user = { id: "account-1" };
  authState.session = {
    access_token: "session-token",
    user: { id: "account-1" },
  };
  authState.handle = "night_owl";
});

function recommendation(
  overrides: Partial<WeatherRecommendation> = {},
): WeatherRecommendation {
  return {
    id: "recommendation-1",
    venueId: "venue-1",
    condition: "warm",
    reason: "The back garden catches the evening light.",
    contributorHandle: "night_owl",
    submittedAt: Date.parse("2026-07-28T19:00:00.000Z"),
    source: "community",
    ...overrides,
  };
}

type WeatherRecommendationListProps = Parameters<
  typeof WeatherRecommendationList
>[0];

function listMarkup(
  props: Partial<WeatherRecommendationListProps> = {},
): string {
  return renderToStaticMarkup(
    createElement(WeatherRecommendationList, {
      venueName: "The Crown",
      recommendations: [],
      weatherStatus: "available",
      matchingConditions: ["warm"],
      degraded: false,
      truncated: false,
      ...props,
    }),
  );
}

describe("WeatherRecommendationList", () => {
  it("renders each row as a named Pubmaxxer's opinion", () => {
    const html = listMarkup({ recommendations: [recommendation()] });

    expect(html).toContain("Fits tonight");
    expect(html).toContain("@night_owl");
    expect(html).toContain("recommends this when it’s warm");
    expect(html).toContain("The back garden catches the evening light.");
    expect(html).not.toContain("verified");
    expect(html).not.toContain("score");
    expect(html).not.toContain("rank");
  });

  it("names the grouping on an element assistive tech reads", () => {
    expect(listMarkup({ recommendations: [recommendation()] })).toContain(
      '<section class="weatherRecRead" aria-label="Recommendations for The Crown">',
    );
  });

  it("states weather failure and still renders authored rows", () => {
    const html = listMarkup({
      recommendations: [recommendation({ condition: "cold" })],
      weatherStatus: "unavailable",
      matchingConditions: [],
    });

    expect(html).toContain("We couldn’t check the weather here just now.");
    expect(html).toContain("shown without a weather match");
    expect(html).toContain("The back garden catches the evening light.");
  });

  it("never promises recommendations it has none of when weather fails", () => {
    const html = listMarkup({
      weatherStatus: "unavailable",
      matchingConditions: [],
    });

    expect(html).toContain("We couldn’t check the weather here just now.");
    expect(html).not.toContain("shown without a weather match");
    expect(html).toContain("Nobody has recommended this pub yet.");
    expect(html).not.toContain("tonight’s weather");
  });

  it("invites the first opinion when tonight is a condition anyone can author", () => {
    const html = listMarkup({ matchingConditions: ["warm", "clear"] });

    expect(html).toContain(
      "Nobody has recommended this pub for tonight’s weather yet. Be the first.",
    );
    expect(html).not.toContain("couldn’t check the weather");
  });

  it("reports weather outside the five conditions as our gap, with no invitation", () => {
    const html = listMarkup({ matchingConditions: [] });

    expect(html).toContain(
      "We don’t have recommendations for today’s conditions.",
    );
    expect(html).not.toContain("Nobody has recommended");
    expect(html).not.toContain("Be the first");
    expect(html).not.toContain("couldn’t check the weather");
  });

  it("keeps a degraded recommendation read distinct from no opinions", () => {
    const html = listMarkup({ degraded: true, matchingConditions: [] });

    expect(html).toContain(
      "We couldn’t read every recommendation here just now.",
    );
    expect(html).not.toContain("No recommendations");
    expect(html).not.toContain("Nobody has recommended");
    expect(html).not.toContain("We don’t have recommendations");
  });
});

describe("VenueWeatherRecommendations", () => {
  it("keeps Recommendation drafts account-scoped and rejects expired sessions", () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        "components/map/VenueWeatherRecommendations.tsx",
      ),
      "utf8",
    );

    expect(source).toContain("useAccountScopedDraft");
    expect(source).toContain("accountComposerAuth");
    expect(source).toContain("rejectedContributionAuth");
    expect(source).not.toContain("setRejectedAuth");
  });

  it("asks a signed-out visitor to sign in before rendering authoring fields", () => {
    authState.user = null;
    authState.session = null;
    authState.handle = null;

    const html = renderToStaticMarkup(
      createElement(VenueWeatherRecommendations, {
        venueId: "venue-1",
        venueName: "The Crown",
      }),
    );

    expect(html).toContain("Sign in to contribute");
    expect(html).not.toContain('name="condition"');
    expect(html).not.toContain('name="reason"');
  });

  it("renders the five-condition authoring flow with labelled bounded fields", () => {
    const html = renderToStaticMarkup(
      createElement(VenueWeatherRecommendations, {
        venueId: "venue-1",
        venueName: "The Crown",
      }),
    );

    expect(html).toContain('role="radiogroup"');
    expect(html.match(/type="radio"/g) ?? []).toHaveLength(5);
    expect(html.match(/name="condition"/g) ?? []).toHaveLength(5);
    expect(html).toContain("Clear skies");
    expect(html).not.toContain('name="contributorHandle"');
    expect(html).not.toContain("Your Pubmaxx handle");
    expect(html).toContain('aria-label="Why The Crown suits this weather"');
    expect(html).toContain('name="reason"');
    expect(html).toContain('maxLength="160"');
    expect(html).toContain("Recommend it");
  });
});

describe("readWeatherRecommendationVenueLoad", () => {
  it("accepts the bounded server payload and drops no attribution", () => {
    expect(
      readWeatherRecommendationVenueLoad({
        weatherStatus: "available",
        matchingConditions: ["warm", "clear"],
        recommendations: [recommendation()],
        degraded: false,
        truncated: false,
      }),
    ).toEqual({
      status: "ready",
      value: {
        weatherStatus: "available",
        matchingConditions: ["warm", "clear"],
        recommendations: [recommendation()],
        degraded: false,
        truncated: false,
      },
    });
  });

  it("rejects a malformed envelope instead of rendering it as an empty venue", () => {
    expect(
      readWeatherRecommendationVenueLoad({
        matchingConditions: ["warm"],
        recommendations: [],
      }),
    ).toEqual({ status: "invalid" });
    expect(
      readWeatherRecommendationVenueLoad({
        weatherStatus: "available",
        matchingConditions: ["snowy"],
        recommendations: [],
      }),
    ).toEqual({ status: "invalid" });
  });

  it("drops one unreadable row, keeps the rest, and says the read was partial", () => {
    expect(
      readWeatherRecommendationVenueLoad({
        weatherStatus: "available",
        matchingConditions: ["warm"],
        recommendations: [{ condition: "snowy" }, recommendation()],
        degraded: false,
        truncated: false,
      }),
    ).toEqual({
      status: "ready",
      value: {
        weatherStatus: "available",
        matchingConditions: ["warm"],
        recommendations: [recommendation()],
        degraded: true,
        truncated: false,
      },
    });
  });
});
