import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ANALYTICS_EVENTS,
  isKnownEvent,
  sanitizeEvent,
  WEEKLY_MEANINGFUL_CORE_ACTIONS,
} from "@/lib/analyticsEvents";

const METRICS_FUNNEL_DOC = readFileSync(
  join(process.cwd(), "docs/METRICS_FUNNEL.md"),
  "utf8",
);
const INVITE_SCOREBOARD_DOC = readFileSync(
  join(process.cwd(), "docs/growth/V1_INVITE_SCOREBOARD.md"),
  "utf8",
);
const CREW_NIGHT_LOOP_DOC = readFileSync(
  join(process.cwd(), "docs/plans/CREW_NIGHT_LOOP.md"),
  "utf8",
);

describe("isKnownEvent", () => {
  it("accepts registry names and rejects everything else", () => {
    expect(isKnownEvent("tonight_screen_view")).toBe(true);
    expect(isKnownEvent("event_chip_view")).toBe(true);
    expect(isKnownEvent("__proto__")).toBe(false);
    expect(isKnownEvent("made_up")).toBe(false);
  });
});

describe("sanitizeEvent", () => {
  it("sanitizes near answer and open events to closed, coarse props", () => {
    expect(sanitizeEvent("near_answer_ready", {
      source: "picked-area",
      resultBand: "4+",
      venueId: "venue-private",
      latitude: 51.5,
      note: "private words",
    })).toEqual({
      name: "near_answer_ready",
      props: { source: "picked-area", resultBand: "4+" },
    });
    expect(sanitizeEvent("near_venue_opened", {
      source: "location",
      positionBand: "2-3",
      venueName: "Private pub",
      price: 4.5,
      coordinates: "51.5,-0.1",
    })).toEqual({
      name: "near_venue_opened",
      props: { source: "location", positionBand: "2-3" },
    });
  });

  it("rejects invented near sources and incomplete near opens", () => {
    expect(sanitizeEvent("near_answer_ready", {
      source: "exact-postcode",
      resultBand: "4+",
    })).toBeNull();
    expect(sanitizeEvent("near_venue_opened", { source: "location" })).toBeNull();
  });

  it("returns null for an unknown event", () => {
    expect(sanitizeEvent("nope", { kind: "gig" })).toBeNull();
  });

  it("keeps only allow-listed props for the event", () => {
    const ev = sanitizeEvent("event_chip_view", { kind: "gig", secret: "x" });
    expect(ev).toEqual({ name: "event_chip_view", props: { kind: "gig" } });
  });

  it("drops props on an event that carries none", () => {
    const ev = sanitizeEvent("tonight_screen_view", { kind: "gig" });
    expect(ev).toEqual({ name: "tonight_screen_view", props: {} });
  });

  it("keeps one closed event for each message attachment target", () => {
    expect(ANALYTICS_EVENTS.message_attach_selected).toEqual(["kind"]);
    for (const kind of ["photos", "camera", "document"]) {
      expect(sanitizeEvent("message_attach_selected", { kind })).toEqual({
        name: "message_attach_selected",
        props: { kind },
      });
    }
    expect(sanitizeEvent("message_attach_selected", { kind: "other" })).toBeNull();
    expect(sanitizeEvent("message_attach_selected")).toBeNull();
  });

  it("keeps open-plan events closed: place kind and decision only", () => {
    expect(ANALYTICS_EVENTS.open_plan_posted).toEqual(["placeKind"]);
    expect(ANALYTICS_EVENTS.open_plan_join_requested).toEqual([]);
    expect(ANALYTICS_EVENTS.open_plan_join_decided).toEqual(["decision"]);
    expect(sanitizeEvent("open_plan_posted", {
      placeKind: "venue",
      crewId: "secret",
      handle: "@alice",
    })).toEqual({ name: "open_plan_posted", props: { placeKind: "venue" } });
    expect(sanitizeEvent("open_plan_posted", { placeKind: "place" })).toEqual({
      name: "open_plan_posted",
      props: { placeKind: "place" },
    });
    expect(sanitizeEvent("open_plan_posted", { placeKind: "event" })).toBeNull();
    expect(sanitizeEvent("open_plan_join_requested", { crewId: "x" })).toEqual({
      name: "open_plan_join_requested",
      props: {},
    });
    expect(sanitizeEvent("open_plan_join_decided", { decision: "accept" })).toEqual({
      name: "open_plan_join_decided",
      props: { decision: "accept" },
    });
    expect(sanitizeEvent("open_plan_join_decided", { decision: "maybe" })).toBeNull();
  });

  it("rejects unsafe values: emails, over-long strings, non-finite numbers", () => {
    expect(sanitizeEvent("event_chip_view", { kind: "a@b.com" })?.props).toEqual({});
    expect(sanitizeEvent("event_chip_view", { kind: "x".repeat(41) })?.props).toEqual({});
    expect(sanitizeEvent("plan_created", { count: Number.NaN })?.props).toEqual({});
    expect(sanitizeEvent("plan_created", { count: Infinity })?.props).toEqual({});
  });

  it("accepts only reviewed enum strings plus bounded numbers", () => {
    expect(sanitizeEvent("plan_created", { count: 5 })?.props).toEqual({ count: 5 });
    expect(sanitizeEvent("poster_shared", { surface: "borough" })?.props).toEqual({
      surface: "borough",
    });
    expect(sanitizeEvent("poster_shared", { surface: "someone's private note" })?.props).toEqual({});
    expect(sanitizeEvent("booking_click", { venueId: "person-or-private-id", tier: "direct" })?.props)
      .toEqual({ tier: "direct" });
  });

  it("keeps only bounded performance fields for web vitals", () => {
    // `route` is required (a known template); an unknown `attribution` key is
    // dropped — only the sanitized `target` selector is allowed through.
    expect(sanitizeEvent("web_vital", {
      metric: "INP",
      value: 143,
      rating: "good",
      route: "/near",
      attribution: "button#private-account-control",
    })?.props).toEqual({ metric: "INP", value: 143, rating: "good", route: "/near" });
  });

  describe("crew north star metric (crew_committed participants)", () => {
    it("registers participants on crew_committed", () => {
      expect(ANALYTICS_EVENTS.crew_committed).toEqual([
        "source",
        "participants",
        "routeReady",
      ]);
    });

    it("accepts integer participants from 1 through 100 inclusive", () => {
      for (const participants of [1, 2, 50, 100]) {
        expect(
          sanitizeEvent("crew_committed", {
            source: "shared-plan",
            participants,
            routeReady: true,
          }),
        ).toEqual({
          name: "crew_committed",
          props: { source: "shared-plan", participants, routeReady: true },
        });
      }
    });

    it("rejects participants outside 1–100 or non-integers", () => {
      expect(
        sanitizeEvent("crew_committed", {
          source: "shared-plan",
          participants: 0,
          routeReady: true,
        }),
      ).toBeNull();
      expect(
        sanitizeEvent("crew_committed", {
          source: "shared-plan",
          participants: 101,
          routeReady: true,
        }),
      ).toBeNull();
      expect(
        sanitizeEvent("crew_committed", {
          source: "shared-plan",
          participants: 2.5,
          routeReady: true,
        }),
      ).toBeNull();
    });

    it("documents the north-star filter participants >= 2 in funnel and scoreboard docs", () => {
      expect(METRICS_FUNNEL_DOC).toMatch(/participants\s*>=\s*2/);
      expect(METRICS_FUNNEL_DOC).toMatch(/crew_committed/);
      expect(INVITE_SCOREBOARD_DOC).toMatch(/participants\s*>=\s*2/);
      expect(INVITE_SCOREBOARD_DOC).toMatch(/crew_committed/);
    });
  });

  describe("loop north star (next_night_committed)", () => {
    it("registers only windowDays and source on next_night_committed", () => {
      expect(ANALYTICS_EVENTS.next_night_committed).toEqual(["windowDays", "source"]);
    });

    it("accepts both closed reinvite sources and strips a free-text one", () => {
      for (const source of ["crew-reinvite", "completed_plan"]) {
        expect(sanitizeEvent("next_night_committed", { windowDays: 3, source })).toEqual({
          name: "next_night_committed",
          props: { windowDays: 3, source },
        });
      }
      expect(sanitizeEvent("next_night_committed", {
        windowDays: 3,
        source: "told a mate at the bar",
      })).toEqual({
        name: "next_night_committed",
        props: { windowDays: 3 },
      });
    });

    // The three reinvite surfaces are the whole emitter list. A fourth that
    // builds its own props inline would be free to attach a name or a venue
    // id, so every emitter is held to the one `nextNightCommittedProps` seam.
    const REINVITE_SURFACES = [
      "components/plan/LastCrewInvite.tsx",
      "components/plan/CompletedPlanUsualLot.tsx",
      "components/night/MorningReentryCard.tsx",
    ];
    // MorningReentryCard wraps its call across lines, so the emitter is matched
    // whitespace-tolerantly rather than as one flat substring.
    const emitsNextNightCommitted = (source: string): boolean =>
      /trackEvent\(\s*(['"`])next_night_committed\1\s*,/.test(source);
    const emitsNextNightCommittedThroughPropsSeam = (source: string): boolean =>
      /trackEvent\(\s*(['"`])next_night_committed\1\s*,\s*nextNightCommittedProps\(/.test(source);

    it("is emitted by every usual-lot reinvite surface through the one props seam", () => {
      for (const path of REINVITE_SURFACES) {
        const source = readFileSync(join(process.cwd(), path), "utf8");
        expect(emitsNextNightCommitted(source)).toBe(true);
        expect(emitsNextNightCommittedThroughPropsSeam(source)).toBe(true);
      }
    });

    it("has no emitter outside that list", () => {
      const found: string[] = [];
      const scan = (directory: string): void => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const path = join(directory, entry.name);
          if (entry.isDirectory()) {
            scan(path);
            continue;
          }
          if (![".ts", ".tsx"].includes(extname(entry.name))) continue;
          if (emitsNextNightCommitted(readFileSync(path, "utf8"))) {
            found.push(relative(process.cwd(), path).replaceAll("\\", "/"));
          }
        }
      };
      for (const directory of ["app", "components", "lib"]) {
        scan(join(process.cwd(), directory));
      }

      expect(found.sort()).toEqual([...REINVITE_SURFACES].sort());
    });

    it("is documented as the loop north star in the plan doc and funnel doc", () => {
      expect(CREW_NIGHT_LOOP_DOC).toMatch(/Loop north star:\*{0,2}\s*`next_night_committed`/);
      expect(CREW_NIGHT_LOOP_DOC).toContain("crew-reinvite");
      expect(CREW_NIGHT_LOOP_DOC).toContain("completed_plan");
      expect(METRICS_FUNNEL_DOC).toContain("next_night_committed");
      expect(METRICS_FUNNEL_DOC).toMatch(/north star/i);
    });
  });

  it("keeps the activation and retention funnel free of identity and free text", () => {
    expect(sanitizeEvent("crew_committed", {
      source: "shared-plan",
      participants: 3,
      routeReady: true,
      handle: "night_owl",
      note: "meet us by the bar",
    })).toEqual({
      name: "crew_committed",
      props: { source: "shared-plan", participants: 3, routeReady: true },
    });

    expect(sanitizeEvent("next_night_committed", {
      windowDays: 18,
      source: "crew-reinvite",
      email: "private@example.com",
    })).toEqual({
      name: "next_night_committed",
      props: { windowDays: 18, source: "crew-reinvite" },
    });
  });

  it.each(["morning", "afternoon", "evening", "night"])(
    "keeps the landing daypart %s",
    (daypart) => {
      expect(sanitizeEvent("discovery_viewed", { surface: "landing", daypart })?.props)
        .toEqual({ surface: "landing", daypart });
    },
  );

  it("tolerates missing/invalid props objects", () => {
    expect(sanitizeEvent("tonight_screen_view")).toEqual({
      name: "tonight_screen_view",
      props: {},
    });
    expect(sanitizeEvent("tonight_screen_view", null)).toEqual({
      name: "tonight_screen_view",
      props: {},
    });
  });

  it("allows district telemetry only from the reviewed catalogue and gate enums", () => {
    expect(sanitizeEvent("district_route_blocked", {
      district: "barnes",
      coverageStatus: "reviewed",
      demandWave: 0,
      reason: "opening_hours",
      coordinates: "51.474,-0.239",
      note: "free text is never telemetry",
    })).toEqual({
      name: "district_route_blocked",
      props: {
        district: "barnes",
        coverageStatus: "reviewed",
        demandWave: 0,
        reason: "opening_hours",
      },
    });

    expect(sanitizeEvent("route_ready_gate_failed", {
      district: "not-a-district",
      coverageStatus: "available",
      demandWave: 99,
      reason: "a custom reviewer note",
      gateVersion: 2,
    })?.props).toEqual({});
  });

  it("every registered event's prop list is an array (registry shape)", () => {
    for (const keys of Object.values(ANALYTICS_EVENTS)) {
      expect(Array.isArray(keys)).toBe(true);
    }
  });

  it("does not expose streak or alcohol-quantity progression events", () => {
    expect(isKnownEvent("streak_increment")).toBe(false);
    expect(isKnownEvent("streak_view")).toBe(false);
    expect(sanitizeEvent("streak_increment", { days: 4 })).toBeNull();
  });

  describe("PostHog wizard events", () => {
    it.each(["google", "apple", "email"])(
      "keeps only fixed provider enum %s for sign-in initiation",
      (provider) => {
        expect(sanitizeEvent("sign_in_initiated", {
          provider,
          email: "person@example.com",
          callbackUrl: "/auth/callback?code=secret",
        })).toEqual({
          name: "sign_in_initiated",
          props: { provider },
        });
      },
    );

    it.each(["microsoft", "oauth", "private", "person@example.com"])(
      "rejects provider value %s outside the sign-in button enum",
      (provider) => {
        expect(sanitizeEvent("sign_in_initiated", { provider })?.props).toEqual({});
      },
    );

    it.each([
      "user_signed_in",
      "user_signed_out",
      "check_in_created",
    ])("drops every property from %s", (name) => {
      expect(sanitizeEvent(name, {
        userId: "supabase-user-id",
        handle: "private_handle",
        email: "person@example.com",
        areaSlug: "exact-place",
      })).toEqual({ name, props: {} });
    });
  });

  describe("metrics funnel events (Wave M)", () => {
    it("accepts a UUID-shaped inviteId for invite_created and invite_redeemed", () => {
      const inviteId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
      expect(sanitizeEvent("invite_created", { inviteId })).toEqual({
        name: "invite_created",
        props: { inviteId },
      });
      expect(sanitizeEvent("invite_redeemed", { inviteId })).toEqual({
        name: "invite_redeemed",
        props: { inviteId },
      });
    });

    it("rejects a non-UUID inviteId (free text can never reach telemetry via this key)", () => {
      expect(sanitizeEvent("invite_created", { inviteId: "not-a-uuid" })?.props).toEqual({});
      expect(sanitizeEvent("invite_created", { inviteId: "jane.doe@example.com" })?.props).toEqual({});
      expect(sanitizeEvent("invite_created", { inviteId: 12345 })?.props).toEqual({});
    });

    it("accepts a bounded numeric dayBucket for activity_pulse", () => {
      expect(sanitizeEvent("activity_pulse", { dayBucket: 20_285 })?.props).toEqual({ dayBucket: 20_285 });
      expect(sanitizeEvent("activity_pulse", { dayBucket: Number.NaN })?.props).toEqual({});
      expect(sanitizeEvent("activity_pulse", { dayBucket: -1 })?.props).toEqual({});
    });

    it("carries no props for the A2HS install funnel events", () => {
      expect(sanitizeEvent("pwa_install_prompt_available", { extra: "x" })).toEqual({
        name: "pwa_install_prompt_available",
        props: {},
      });
      expect(sanitizeEvent("pwa_install_completed")).toEqual({
        name: "pwa_install_completed",
        props: {},
      });
      expect(sanitizeEvent("pwa_standalone_launch")).toEqual({
        name: "pwa_standalone_launch",
        props: {},
      });
    });
  });

  describe("loop metrics (Wave 0.5)", () => {
    it("registers every requested loop outcome with privacy-minimised props", () => {
      expect(sanitizeEvent("plan_generated", {
        stops: 3,
        grounded: true,
        query: "quiet near my home",
        coordinates: "51.5,-0.1",
      })).toEqual({ name: "plan_generated", props: { stops: 3, grounded: true } });
      expect(sanitizeEvent("plan_accepted", {
        stops: 3,
        grounded: true,
        anchored: true,
        routeReady: true,
        source: "near",
        planId: "private-plan",
      })).toEqual({
        name: "plan_accepted",
        props: { stops: 3, grounded: true, anchored: true, routeReady: true, source: "near" },
      });
      expect(sanitizeEvent("plan_saved", { stops: 3, grounded: false, title: "Friday with Jamie" }))
        .toEqual({ name: "plan_saved", props: { stops: 3, grounded: false } });
      expect(sanitizeEvent("claim_started", { source: "auth", handle: "private_handle" }))
        .toEqual({ name: "claim_started", props: { source: "auth" } });
      expect(sanitizeEvent("claim_completed", { source: "auth", email: "private@example.com" }))
        .toEqual({ name: "claim_completed", props: { source: "auth" } });
      expect(sanitizeEvent("plan_completed", { ending: "food", finalVenueId: "private-venue" }))
        .toEqual({ name: "plan_completed", props: { ending: "food" } });
      expect(sanitizeEvent("memory_reviewed", { source: "inline_recap", caption: "private words" }))
        .toEqual({ name: "memory_reviewed", props: { source: "inline_recap" } });
      expect(sanitizeEvent("memory_reviewed", { source: "full_recap" }))
        .toEqual({ name: "memory_reviewed", props: { source: "full_recap" } });
      expect(sanitizeEvent("story_published", {
        visibility: "unlisted",
        contributors: 3,
        moments: 4,
        storyId: "private-story",
      })).toEqual({
        name: "story_published",
        props: { visibility: "unlisted", contributors: 3, moments: 4 },
      });
    });

    it("enforces exact loop prop types and ranges", () => {
      expect(sanitizeEvent("plan_generated", { stops: 51, grounded: 1 })?.props).toEqual({});
      expect(sanitizeEvent("plan_accepted", {
        stops: 0,
        grounded: "true",
        anchored: true,
        routeReady: true,
        source: "near",
      })).toBeNull();
      expect(sanitizeEvent("plan_saved", { stops: 3, grounded: true })?.props)
        .toEqual({ stops: 3, grounded: true });
      expect(sanitizeEvent("claim_started", { source: "you" })?.props).toEqual({});
      expect(sanitizeEvent("plan_completed", { ending: true })?.props).toEqual({});
      expect(sanitizeEvent("memory_reviewed", { source: 51 })?.props).toEqual({});
      expect(sanitizeEvent("story_published", {
        visibility: "private",
        contributors: 3.5,
        moments: 101,
      })?.props).toEqual({});
    });

    it("defines Weekly Meaningful Pubmaxxers from explicit core actions only", () => {
      expect(WEEKLY_MEANINGFUL_CORE_ACTIONS).toEqual([
        "plan_accepted",
        "plan_saved",
        "plan_completed",
        "memory_reviewed",
        "story_published",
      ]);
      for (const action of WEEKLY_MEANINGFUL_CORE_ACTIONS) {
        expect(sanitizeEvent("meaningful_core_action", { action, note: "never sent" }))
          .toEqual({ name: "meaningful_core_action", props: { action } });
      }
      expect(sanitizeEvent("meaningful_core_action", { action: "plan_generated" })).toBeNull();
      expect(sanitizeEvent("meaningful_core_action", { action: "claim_completed" })).toBeNull();
      expect(sanitizeEvent("meaningful_core_action", { action: "arrived" })).toBeNull();
      expect(sanitizeEvent("meaningful_core_action")).toBeNull();
    });
  });
});

describe("community-price funnel events", () => {
  it("registers submission and required-identity funnel steps", () => {
    expect(isKnownEvent("price_submit_viewed")).toBe(true);
    expect(isKnownEvent("price_submitted")).toBe(true);
    expect(isKnownEvent("price_submit_failed")).toBe(true);
    expect(isKnownEvent("price_impact_opened")).toBe(true);
    expect(isKnownEvent("contribution_gate")).toBe(true);
  });

  it("keeps the drink category and the failure reason", () => {
    expect(sanitizeEvent("price_submit_viewed", { category: "beer" })).toEqual({
      name: "price_submit_viewed",
      props: { category: "beer" },
    });
    expect(sanitizeEvent("price_submitted", { category: "cocktail" })).toEqual({
      name: "price_submitted",
      props: { category: "cocktail" },
    });
    expect(
      sanitizeEvent("price_submit_failed", { category: "wine", reason: "rejected" }),
    ).toEqual({
      name: "price_submit_failed",
      props: { category: "wine", reason: "rejected" },
    });
    expect(sanitizeEvent("price_impact_opened", {
      handle: "night_owl",
      venueId: "venue-private",
      priceGbp: 4.2,
    })).toEqual({
      name: "price_impact_opened",
      props: {},
    });
  });

  it("never carries the venue, the price, or the error sentence", () => {
    const ev = sanitizeEvent("price_submitted", {
      category: "beer",
      venueId: "the-lamb",
      venueName: "The Lamb",
      priceGbp: 4.2,
    });
    expect(ev).toEqual({ name: "price_submitted", props: { category: "beer" } });
  });

  it("fails closed on an off-taxonomy category or an unknown reason", () => {
    expect(sanitizeEvent("price_submitted", { category: "absinthe" })).toBeNull();
    expect(sanitizeEvent("price_submitted", {})).toBeNull();
    expect(
      sanitizeEvent("price_submit_failed", { category: "beer", reason: "server_said_no" }),
    ).toBeNull();
  });

  it("does not leak its vocabulary into the pal-memory category key", () => {
    // Same prop NAME, a different closed set - the price check must be scoped
    // to the funnel events, not to the key.
    expect(
      sanitizeEvent("pub_pal_memory_changed", { action: "create", category: "preference" }),
    ).toEqual({
      name: "pub_pal_memory_changed",
      props: { action: "create", category: "preference" },
    });
  });

  it("keeps only closed, identity-free contribution gate states", () => {
    for (const step of ["sign_in_required", "onboarding_required"]) {
      expect(sanitizeEvent("contribution_gate", { step })).toEqual({
        name: "contribution_gate",
        props: { step },
      });
    }
    for (const step of [
      "age_assessment_required",
      "age_assessment_passed",
      "age_restricted",
    ]) {
      expect(sanitizeEvent("contribution_gate", { step })).toBeNull();
    }
    expect(sanitizeEvent("contribution_gate", { step: "user@example.com" })).toBeNull();
    expect(sanitizeEvent("contribution_gate", {})).toBeNull();
  });
});

describe("price evidence mission events", () => {
  it("registers the closed mission funnel", () => {
    expect(isKnownEvent("mission_viewed")).toBe(true);
    expect(isKnownEvent("mission_opened")).toBe(true);
    expect(isKnownEvent("mission_dismissed")).toBe(true);
    expect(isKnownEvent("mission_submitted")).toBe(true);
    expect(isKnownEvent("mission_newly_trusted")).toBe(true);
    expect(isKnownEvent("mission_impact_opened")).toBe(true);
    expect(ANALYTICS_EVENTS.mission_impact_opened).toEqual(["surface"]);
  });

  it("keeps surface, reason, category, and outcome only", () => {
    expect(sanitizeEvent("mission_viewed", {
      surface: "near",
      reason: "provisional",
      category: "beer",
      venueId: "venue-secret",
      handle: "night_owl",
      priceGbp: 4.2,
    })).toEqual({
      name: "mission_viewed",
      props: { surface: "near", reason: "provisional", category: "beer" },
    });
    expect(sanitizeEvent("mission_submitted", {
      surface: "map",
      reason: "stale",
      category: "wine",
      outcome: "needs_check",
    })).toEqual({
      name: "mission_submitted",
      props: {
        surface: "map",
        reason: "stale",
        category: "wine",
        outcome: "needs_check",
      },
    });
  });

  it("allows a missing mission to omit category", () => {
    expect(sanitizeEvent("mission_dismissed", {
      surface: "near",
      reason: "missing",
    })).toEqual({
      name: "mission_dismissed",
      props: { surface: "near", reason: "missing" },
    });
  });

  it("fails closed on an unknown surface, reason, or outcome", () => {
    expect(sanitizeEvent("mission_viewed", { surface: "feed", reason: "provisional" })).toBeNull();
    expect(sanitizeEvent("mission_opened", { surface: "near", reason: "urgent" })).toBeNull();
    expect(sanitizeEvent("mission_submitted", {
      surface: "near",
      reason: "missing",
      outcome: "won",
    })).toBeNull();
    expect(sanitizeEvent("mission_submitted", { surface: "near", reason: "missing" })).toBeNull();
  });

  it("records impact opened with surface only", () => {
    expect(sanitizeEvent("mission_impact_opened", {
      surface: "profile",
      venueId: "venue-secret",
      handle: "night_owl",
      priceGbp: 4.2,
    })).toEqual({
      name: "mission_impact_opened",
      props: { surface: "profile" },
    });
    expect(sanitizeEvent("mission_impact_opened", {})).toBeNull();
    expect(sanitizeEvent("mission_impact_opened", { surface: "feed" })).toBeNull();
  });
});

describe("invite loop events", () => {
  it("registers all six invite-loop events", () => {
    expect(isKnownEvent("plan_invite_link_copied")).toBe(true);
    expect(isKnownEvent("plan_invite_link_rotated")).toBe(true);
    expect(isKnownEvent("invite_page_viewed")).toBe(true);
    expect(isKnownEvent("invite_rsvp_submitted")).toBe(true);
    expect(isKnownEvent("invite_reaction_toggled")).toBe(true);
    expect(isKnownEvent("invite_map_opened")).toBe(true);
  });

  it("carries no props for the link copy/rotate/map-open events, and no planId", () => {
    expect(sanitizeEvent("plan_invite_link_copied")).toEqual({
      name: "plan_invite_link_copied",
      props: {},
    });
    expect(sanitizeEvent("plan_invite_link_rotated", { planId: "should-be-dropped" })).toEqual({
      name: "plan_invite_link_rotated",
      props: {},
    });
    expect(sanitizeEvent("invite_map_opened", { planId: "should-be-dropped" })).toEqual({
      name: "invite_map_opened",
      props: {},
    });
  });

  it("keeps hasRsvps for invite_page_viewed and fails closed without it", () => {
    expect(sanitizeEvent("invite_page_viewed", { hasRsvps: true })).toEqual({
      name: "invite_page_viewed",
      props: { hasRsvps: true },
    });
    expect(sanitizeEvent("invite_page_viewed", { hasRsvps: false })).toEqual({
      name: "invite_page_viewed",
      props: { hasRsvps: false },
    });
    expect(sanitizeEvent("invite_page_viewed", { hasRsvps: "yes" })).toBeNull();
    expect(sanitizeEvent("invite_page_viewed", {})).toBeNull();
  });

  it("keeps only the closed Going/Maybe vocabulary for invite_rsvp_submitted, with isUpdate", () => {
    expect(sanitizeEvent("invite_rsvp_submitted", { status: "going", isUpdate: false })).toEqual({
      name: "invite_rsvp_submitted",
      props: { status: "going", isUpdate: false },
    });
    expect(sanitizeEvent("invite_rsvp_submitted", { status: "maybe", isUpdate: true })).toEqual({
      name: "invite_rsvp_submitted",
      props: { status: "maybe", isUpdate: true },
    });
    expect(sanitizeEvent("invite_rsvp_submitted", { status: "not_going", isUpdate: false })).toBeNull();
    expect(sanitizeEvent("invite_rsvp_submitted", { status: "going", isUpdate: "false" })).toBeNull();
    expect(sanitizeEvent("invite_rsvp_submitted", { status: "going" })).toBeNull();
    expect(sanitizeEvent("invite_rsvp_submitted", {})).toBeNull();
  });

  it("keeps only the closed reaction vocabulary for invite_reaction_toggled, with active", () => {
    for (const reaction of ["cheers", "bargain", "chaos", "proper", "legendary"]) {
      expect(sanitizeEvent("invite_reaction_toggled", { reaction, active: true })).toEqual({
        name: "invite_reaction_toggled",
        props: { reaction, active: true },
      });
    }
    expect(sanitizeEvent("invite_reaction_toggled", { reaction: "sad", active: true })).toBeNull();
    expect(sanitizeEvent("invite_reaction_toggled", { reaction: "cheers", active: "true" })).toBeNull();
    expect(sanitizeEvent("invite_reaction_toggled", { reaction: "cheers" })).toBeNull();
    expect(sanitizeEvent("invite_reaction_toggled", {})).toBeNull();
  });

  it("never carries a guest display name, device id, or invite token", () => {
    const ev = sanitizeEvent("invite_rsvp_submitted", {
      status: "going",
      isUpdate: false,
      displayName: "Jamie",
      submitterHash: "abc123",
      inviteToken: "one-use-token",
    });
    expect(ev).toEqual({ name: "invite_rsvp_submitted", props: { status: "going", isUpdate: false } });
  });

  it("registers the invite-loop prop allow-lists exactly", () => {
    expect(ANALYTICS_EVENTS.plan_invite_link_copied).toEqual([]);
    expect(ANALYTICS_EVENTS.plan_invite_link_rotated).toEqual([]);
    expect(ANALYTICS_EVENTS.invite_page_viewed).toEqual(["hasRsvps"]);
    expect(ANALYTICS_EVENTS.invite_rsvp_submitted).toEqual(["status", "isUpdate"]);
    expect(ANALYTICS_EVENTS.invite_reaction_toggled).toEqual(["reaction", "active"]);
    expect(ANALYTICS_EVENTS.invite_map_opened).toEqual([]);
  });

  it("registers the Out tab and create-FAB events", () => {
    expect(ANALYTICS_EVENTS.out_screen_view).toEqual([]);
    expect(ANALYTICS_EVENTS.out_filter_select).toEqual(["kind"]);
    expect(ANALYTICS_EVENTS.create_fab_action).toEqual(["action"]);
    expect(sanitizeEvent("out_screen_view")).toEqual({ name: "out_screen_view", props: {} });
    expect(sanitizeEvent("out_filter_select", { kind: "tonight" })?.props).toEqual({
      kind: "tonight",
    });
    expect(sanitizeEvent("out_filter_select", { kind: "tomorrow" })?.props).toEqual({
      kind: "tomorrow",
    });
    expect(sanitizeEvent("out_filter_select", { kind: "weekend" })?.props).toEqual({
      kind: "weekend",
    });
    expect(sanitizeEvent("out_filter_select", { kind: "someone@pub" })).toEqual({
      name: "out_filter_select",
      props: {},
    });
    expect(sanitizeEvent("create_fab_action", { action: "moment" })?.props).toEqual({
      action: "moment",
    });
    expect(sanitizeEvent("create_fab_action", { action: "price" })?.props).toEqual({
      action: "price",
    });
    expect(sanitizeEvent("create_fab_action", { action: "plan" })?.props).toEqual({
      action: "plan",
    });
  });

  it("accepts landing CTA targets and rejects free text", () => {
    expect(ANALYTICS_EVENTS.landing_cta_clicked).toEqual(["target"]);
    expect(sanitizeEvent("landing_cta_clicked", { target: "map" })).toEqual({
      name: "landing_cta_clicked",
      props: { target: "map" },
    });
    expect(sanitizeEvent("landing_cta_clicked", { target: "near" })?.props).toEqual({
      target: "near",
    });
    expect(sanitizeEvent("landing_cta_clicked", { target: "plan" })?.props).toEqual({
      target: "plan",
    });
    expect(sanitizeEvent("landing_cta_clicked", { target: "pal" })?.props).toEqual({
      target: "pal",
    });
    expect(sanitizeEvent("landing_cta_clicked", { target: "social" })).toBeNull();
    expect(sanitizeEvent("landing_cta_clicked", {})).toBeNull();
  });

  it("registers Wanted Wave A events with closed venueKind props only", () => {
    expect(ANALYTICS_EVENTS.wanted_created).toEqual(["venueKind", "hasSourceUrl"]);
    expect(ANALYTICS_EVENTS.wanted_fulfilled).toEqual(["venueKind"]);
    expect(ANALYTICS_EVENTS.wanted_promoted).toEqual([]);
    expect(
      sanitizeEvent("wanted_created", {
        venueKind: "curated",
        hasSourceUrl: true,
        venueName: "The Dove",
        sourceUrl: "https://instagram.com/x",
      }),
    ).toEqual({
      name: "wanted_created",
      props: { venueKind: "curated", hasSourceUrl: true },
    });
    expect(
      sanitizeEvent("wanted_fulfilled", { venueKind: "uk_base", note: "secret" }),
    ).toEqual({
      name: "wanted_fulfilled",
      props: { venueKind: "uk_base" },
    });
    expect(sanitizeEvent("wanted_created", { venueKind: "free-text-pub" })).toEqual({
      name: "wanted_created",
      props: {},
    });
  });

  it("registers out_card_opened with a closed source only", () => {
    expect(ANALYTICS_EVENTS.out_card_opened).toEqual(["source"]);
    expect(ANALYTICS_EVENTS.creator_list_viewed).toEqual([]);
    expect(ANALYTICS_EVENTS.creator_list_map_opened).toEqual([]);
    expect(ANALYTICS_EVENTS.creator_list_plan_started).toEqual([]);
    expect(ANALYTICS_EVENTS.creator_list_followed).toEqual([]);
    expect(
      sanitizeEvent("out_card_opened", {
        source: "skiddle",
        venueId: "venue-1",
        eventId: "tm-9",
        latitude: 51.5,
      }),
    ).toEqual({
      name: "out_card_opened",
      props: { source: "skiddle" },
    });
    expect(sanitizeEvent("out_card_opened", { source: "free-text-pub" })).toEqual({
      name: "out_card_opened",
      props: {},
    });
  });

  it("registers occupancy events with closed level and state props only", () => {
    expect(ANALYTICS_EVENTS.occupancy_reported).toEqual(["level", "surface"]);
    expect(ANALYTICS_EVENTS.occupancy_read).toEqual(["state"]);
    expect(
      sanitizeEvent("occupancy_reported", {
        level: "some-seats",
        surface: "venue-sheet",
        venueId: "venue-1",
        handle: "karan",
      }),
    ).toEqual({
      name: "occupancy_reported",
      props: { level: "some-seats", surface: "venue-sheet" },
    });
    expect(
      sanitizeEvent("occupancy_read", { state: "degraded", venueId: "x" }),
    ).toEqual({
      name: "occupancy_read",
      props: { state: "degraded" },
    });
    expect(
      sanitizeEvent("occupancy_reported", { level: "rammed", surface: "pal" }),
    ).toEqual({
      name: "occupancy_reported",
      props: { surface: "pal" },
    });
  });
});
