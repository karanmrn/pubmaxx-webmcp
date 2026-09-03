import { describe, expect, it } from "vitest";
import type { CaptureResult } from "posthog-js";

import {
  posthogBrowserConfig,
  sanitizePosthogEvent,
} from "@/lib/posthogClient";

const UUID = "018f47a2-8e71-7a7a-9f18-8b953d45b2da";

describe("PostHog browser privacy boundary", () => {
  it("drops browser autocapture and unregistered custom events", () => {
    const event: CaptureResult = {
      uuid: UUID,
      event: "$autocapture",
      properties: {
        token: "phc_public",
        distinct_id: UUID,
        $current_url: "https://pubmaxxing.com/map?email=person@example.com",
      },
    };

    expect(sanitizePosthogEvent(event)).toBeNull();
    expect(sanitizePosthogEvent({
      ...event,
      event: "unregistered_product_event",
    })).toBeNull();
  });

  it("keeps standard device, screen, referrer, and campaign context on explicit pageviews", () => {
    const anonymousId = `anon_${UUID}`;
    const event: CaptureResult = {
      uuid: UUID,
      event: "$pageview",
      timestamp: new Date("2026-07-28T12:00:00.000Z"),
      properties: {
        token: "phc_public",
        distinct_id: anonymousId,
        $device_id: anonymousId,
        $pubmaxx_anonymous_id: anonymousId,
        $pathname: "/map",
        $current_url: "https://pubmaxxing.com/map?utm_source=newsletter",
        $referrer: "https://example.com/pub-guide?ask=free-text",
        $referring_domain: "example.com",
        $browser: "Safari",
        $browser_version: 18,
        $os: "Mac OS X",
        $os_version: "15.5",
        $device_type: "Desktop",
        $screen_width: 1512,
        $screen_height: 982,
        $viewport_width: 1280,
        $viewport_height: 820,
        utm_source: "newsletter",
        $set: { email: "person@example.com" },
        $set_once: { account_id: "supabase-user-id" },
        $screen_name: "person@example.com",
        account_id: "supabase-user-id",
      },
    };

    expect(sanitizePosthogEvent(event)).toEqual({
      uuid: UUID,
      event: "$pageview",
      timestamp: new Date("2026-07-28T12:00:00.000Z"),
      properties: {
        token: "phc_public",
        distinct_id: anonymousId,
        $device_id: anonymousId,
        $pathname: "/map",
        $current_url: "https://pubmaxxing.com/map",
        $referrer: "https://example.com",
        $referring_domain: "example.com",
        $browser: "Safari",
        $browser_version: 18,
        $os: "Mac OS X",
        $os_version: "15.5",
        $device_type: "Desktop",
        $screen_width: 1512,
        $screen_height: 982,
        $viewport_width: 1280,
        $viewport_height: 820,
        utm_source: "newsletter",
      },
    });
  });

  it.each([
    ["/u/night_owl", "/u/[handle]"],
    ["/messages/private-thread", "/messages/[id]"],
    ["/rounds/secret-share-code", "/rounds/[code]"],
    ["/plan/6ab5ca40-836b-4970-9477-d1779fdd31ab", "/plan/[id]"],
  ])("coarsens dynamic pageview path %s before egress", (pathname, expected) => {
    const anonymousId = `anon_${UUID}`;
    const event: CaptureResult = {
      uuid: UUID,
      event: "$pageview",
      properties: {
        token: "phc_public",
        distinct_id: anonymousId,
        $device_id: anonymousId,
        $pubmaxx_anonymous_id: anonymousId,
        $pathname: pathname,
      },
    };

    const sanitized = sanitizePosthogEvent(event);
    expect(sanitized?.properties.$pathname).toBe(expected);
    expect(JSON.stringify(sanitized)).not.toContain(pathname.split("/").at(-1));
  });

  it.each([
    "/map?sel=venue-secret#sheet",
    "/admin",
    "/admin/community-prices",
    "/unknown/private-value",
    "/u/night_owl%2Fprivate",
  ])("drops unsafe or unknown pageview path %s", (pathname) => {
    const anonymousId = `anon_${UUID}`;
    const event: CaptureResult = {
      uuid: UUID,
      event: "$pageview",
      properties: {
        token: "phc_public",
        distinct_id: anonymousId,
        $device_id: anonymousId,
        $pubmaxx_anonymous_id: anonymousId,
        $pathname: pathname,
      },
    };

    expect(sanitizePosthogEvent(event)).toBeNull();
  });

  it("removes exception messages, stack traces, URLs, person props, and arbitrary context", () => {
    const anonymousId = `anon_${UUID}`;
    const event: CaptureResult = {
      uuid: UUID,
      event: "$exception",
      timestamp: new Date("2026-07-26T12:00:00.000Z"),
      properties: {
        token: "phc_public",
        distinct_id: anonymousId,
        $device_id: anonymousId,
        $browser: "Chrome",
        $os: "Windows",
        $device_type: "Desktop",
        $screen_width: 1920,
        $screen_height: 1080,
        $current_url: "https://pubmaxxing.com/map?token=secret",
        $pathname: "/map",
        $exception_message: "Failed for person@example.com",
        $exception_list: [
          {
            type: "TypeError",
            value: "Account person@example.com failed",
            stacktrace: {
              frames: [
                {
                  filename: "https://pubmaxxing.com/private/person@example.com",
                  function: "load-person@example.com",
                },
              ],
            },
          },
          {
            type: "person@example.com",
            value: "secret",
          },
        ],
        account_id: "supabase-user-id",
        email: "person@example.com",
      },
      $set: { email: "person@example.com" },
    };

    expect(sanitizePosthogEvent(event)).toEqual({
      uuid: UUID,
      event: "$exception",
      timestamp: new Date("2026-07-26T12:00:00.000Z"),
      properties: {
        token: "phc_public",
        distinct_id: anonymousId,
        $device_id: anonymousId,
        $browser: "Chrome",
        $os: "Windows",
        $device_type: "Desktop",
        $screen_width: 1920,
        $screen_height: 1080,
        $pathname: "/map",
        $exception_list: [
          { type: "TypeError", value: "Redacted (/map)" },
          { type: "Error", value: "Redacted (/map)" },
        ],
      },
    });
  });

  it("separates crashes by coarse surface so one JS type is not one issue", () => {
    const anonymousId = `anon_${UUID}`;
    const crashOn = (pathname: string, currentUrl: string): CaptureResult => ({
      uuid: UUID,
      event: "$exception",
      properties: {
        distinct_id: anonymousId,
        $device_id: anonymousId,
        $pathname: pathname,
        $current_url: currentUrl,
        $exception_list: [{ type: "TypeError", value: "person@example.com" }],
      },
    });

    const onMap = sanitizePosthogEvent(crashOn("/map", "https://pubmaxxing.com/map"));
    const onPlan = sanitizePosthogEvent(crashOn("/plan", "https://pubmaxxing.com/plan"));

    expect(onMap?.properties.$exception_list).toEqual([
      { type: "TypeError", value: "Redacted (/map)" },
    ]);
    expect(onPlan?.properties.$exception_list).toEqual([
      { type: "TypeError", value: "Redacted (/plan)" },
    ]);
    // Error tracking fingerprints on type + message. Equal messages would make
    // these one permanently unreadable issue.
    expect(onMap?.properties.$exception_list).not.toEqual(
      onPlan?.properties.$exception_list,
    );
  });

  it("templates dynamic segments and stays redacted on an unknown surface", () => {
    const anonymousId = `anon_${UUID}`;
    const sanitize = (pathname: string, currentUrl: string) =>
      sanitizePosthogEvent({
        uuid: UUID,
        event: "$exception",
        properties: {
          distinct_id: anonymousId,
          $device_id: anonymousId,
          $pathname: pathname,
          $current_url: currentUrl,
          $exception_list: [{ type: "Error", value: "secret" }],
        },
      });

    const dynamic = sanitize(
      "/u/person@example.com",
      "https://pubmaxxing.com/u/person@example.com",
    );
    expect(dynamic?.properties.$exception_list).toEqual([
      { type: "Error", value: "Redacted (/u/[handle])" },
    ]);
    expect(dynamic?.properties.$pathname).toBe("/u/[handle]");

    const unknown = sanitize(
      "/internal/person@example.com",
      "https://pubmaxxing.com/internal/person@example.com",
    );
    expect(unknown?.properties.$exception_list).toEqual([
      { type: "Error", value: "Redacted" },
    ]);
    expect(unknown?.properties.$pathname).toBeUndefined();
  });

  it("recovers the surface from the current URL when $pathname is absent", () => {
    const anonymousId = `anon_${UUID}`;
    const sanitized = sanitizePosthogEvent({
      uuid: UUID,
      event: "$exception",
      properties: {
        distinct_id: anonymousId,
        $device_id: anonymousId,
        $current_url: "https://pubmaxxing.com/pint-index?token=secret",
        $exception_list: [{ type: "RangeError", value: "secret" }],
      },
    });

    expect(sanitized?.properties.$exception_list).toEqual([
      { type: "RangeError", value: "Redacted (/pint-index)" },
    ]);
    expect(sanitized?.properties.$current_url).toBeUndefined();
  });

  it("drops exceptions without an SDK-generated anonymous distinct id", () => {
    const event: CaptureResult = {
      uuid: UUID,
      event: "$exception",
      properties: {
        token: "phc_public",
        distinct_id: "account-person@example.com",
        $exception_list: [{ type: "Error", value: "secret" }],
      },
    };

    expect(sanitizePosthogEvent(event)).toBeNull();
  });

  it("keeps only closed web vital fields and strips query-bearing URLs", () => {
    const anonymousId = `anon_${UUID}`;
    const event: CaptureResult = {
      uuid: UUID,
      event: "$web_vitals",
      timestamp: new Date("2026-07-29T12:00:00.000Z"),
      properties: {
        token: "phc_public",
        distinct_id: anonymousId,
        $device_id: anonymousId,
        $browser: "Firefox",
        $os: "Linux",
        $device_type: "Desktop",
        $screen_width: 1440,
        $screen_height: 900,
        $pathname: "/map",
        $current_url: "https://pubmaxxing.com/map?memberToken=secret",
        $referrer: "https://pubmaxxing.com/u/private-handle?ask=free-text",
        $initial_referrer: "https://pubmaxxing.com/rounds/secret-code?member=secret",
        $web_vitals_LCP_value: 1234,
        $web_vitals_LCP_event: {
          name: "LCP",
          value: 1234,
          rating: "good",
          $current_url: "https://pubmaxxing.com/pal?ask=free-text",
          attribution: {
            interactionTarget: "main[data-member='secret']",
          },
        },
        $web_vitals_secret_event: {
          freeText: "do not forward",
        },
      },
      $set: {
        $current_url: "https://pubmaxxing.com/pal?ask=free-text",
      },
      $set_once: {
        $initial_current_url: "https://pubmaxxing.com/map?memberToken=secret",
      },
      $unset: ["private_profile_field"],
    };

    expect(sanitizePosthogEvent(event)).toEqual({
      uuid: UUID,
      event: "$web_vitals",
      timestamp: new Date("2026-07-29T12:00:00.000Z"),
      properties: {
        token: "phc_public",
        distinct_id: anonymousId,
        $device_id: anonymousId,
        $browser: "Firefox",
        $os: "Linux",
        $device_type: "Desktop",
        $screen_width: 1440,
        $screen_height: 900,
        $pathname: "/map",
        $current_url: "https://pubmaxxing.com/map",
        $referrer: "https://pubmaxxing.com/u/[handle]",
        $initial_referrer: "https://pubmaxxing.com/rounds/[code]",
        $web_vitals_LCP_value: 1234,
        $web_vitals_LCP_event: {
          name: "LCP",
          value: 1234,
          rating: "good",
        },
      },
    });
  });

  it("seeds repeated SDK initializations from the same consent-created device id", () => {
    const anonymousId = `anon_${UUID}`;
    const values = new Map([["pubmaxx:analytics-id:v1", anonymousId]]);
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => values.get(key) ?? null,
        },
      },
    });

    expect(posthogBrowserConfig.get_device_id?.("generated-first")).toBe(anonymousId);
    expect(posthogBrowserConfig.get_device_id?.("generated-after-reload")).toBe(anonymousId);

    delete (globalThis as { window?: unknown }).window;
  });

  it("enables standard product analytics while autocapture and recording stay off", () => {
    expect(posthogBrowserConfig).toMatchObject({
      api_host: "/ingest",
      ui_host: "https://eu.posthog.com",
      capture_exceptions: true,
      autocapture: false,
      rageclick: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_performance: true,
      capture_heatmaps: false,
      capture_dead_clicks: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_product_tours: true,
      disable_conversations: true,
      disable_external_dependency_loading: false,
      request_batching: false,
      persistence: "localStorage+cookie",
      save_campaign_params: true,
      save_referrer: true,
      opt_in_site_apps: false,
      person_profiles: "always",
      advanced_disable_flags: true,
      opt_out_capturing_by_default: true,
      opt_out_persistence_by_default: true,
      respect_dnt: true,
    });
    expect(posthogBrowserConfig.before_send).toBe(sanitizePosthogEvent);
  });
});
