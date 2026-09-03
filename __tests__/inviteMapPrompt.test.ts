import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  applyInviteRsvpCapability,
  InviteMapPrompt,
  postInviteRsvp,
  resolveInviteRsvpSubmitCapability,
  submitInviteRsvpAtMembershipBoundary,
} from "@/components/plan/PlanInviteRsvp";
import {
  inviteRsvpDeviceKey,
  markDeviceRsvpCommitted,
  readDeviceRsvpCommitted,
} from "@/lib/planInvite";
import {
  parsePlanCapabilitySnapshot,
  PlanSessionUnavailableError,
  readPlanCapabilitySnapshot,
  writePlanCapability,
} from "@/lib/planSessionCapability";

function memoryStorage(seed: Record<string, string> = {}) {
  const values = new Map<string, string>(Object.entries(seed));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
  };
}

/**
 * The text of every live region the prompt rendered, in order. The prompt's own
 * markup is the contract here: what a screen reader announces is the text that
 * appears INSIDE an already-mounted `role="status"` element, so the assertions
 * below read those regions rather than counting attributes.
 */
function liveRegionTexts(html: string): string[] {
  return [...html.matchAll(/<p[^>]*role="status"[^>]*>(.*?)<\/p>/g)].map((match) => match[1]);
}

function savedLineCount(html: string): number {
  return html.split("RSVP saved.").length - 1;
}

describe("InviteMapPrompt", () => {
  it("announces a committed RSVP without inventing a map destination", () => {
    const html = renderToStaticMarkup(
      createElement(InviteMapPrompt, {
        committedThisVisit: true,
        rememberedFromDevice: false,
        venueIds: [" "],
      }),
    );

    expect(html).toContain("RSVP saved.");
    expect(html).not.toContain("Open these stops on the map");
  });

  it("uses the canonical selected-Venue URL for one valid Crawl Stop", () => {
    const html = renderToStaticMarkup(
      createElement(InviteMapPrompt, {
        committedThisVisit: true,
        rememberedFromDevice: false,
        venueIds: [" venue-1 "],
      }),
    );

    expect(html).toContain('href="/map?sel=venue-1"');
    expect(html).toContain("Open these stops on the map");
  });

  it("still reaches the stops before this browser commits an RSVP", () => {
    // The regression this pins: gating the link on a live RSVP left a guest who
    // reloaded, returned the next day, answered on another device, or was
    // already Going before the deploy with no way to the stops at all.
    const html = renderToStaticMarkup(
      createElement(InviteMapPrompt, {
        committedThisVisit: false,
        rememberedFromDevice: false,
        venueIds: ["venue-1"],
      }),
    );

    expect(html).toContain('href="/map?sel=venue-1"');
    expect(html).toContain("Open these stops on the map");
    expect(html).not.toContain("RSVP saved.");
  });

  it("holds one empty live region open before any answer lands", () => {
    // The regression this pins: the saved line arrived as a NEW element that
    // already carried its own first words, and a screen reader watching the
    // regions it can see has nothing to watch until that insertion happens.
    const html = renderToStaticMarkup(
      createElement(InviteMapPrompt, {
        committedThisVisit: false,
        rememberedFromDevice: false,
        venueIds: ["venue-1"],
      }),
    );

    expect(liveRegionTexts(html)).toEqual([""]);
  });

  it("announces the save exactly once when it lands in this visit", () => {
    // The regression this pins: the saved line carried no live region at all,
    // so a screen-reader guest got no confirmation that their RSVP landed.
    const html = renderToStaticMarkup(
      createElement(InviteMapPrompt, {
        committedThisVisit: true,
        rememberedFromDevice: false,
        venueIds: ["venue-1"],
      }),
    );

    expect(liveRegionTexts(html)).toEqual(["RSVP saved."]);
    expect(savedLineCount(html)).toBe(1);
  });

  it("stays silent when the saved line is restored from device memory", () => {
    const html = renderToStaticMarkup(
      createElement(InviteMapPrompt, {
        committedThisVisit: false,
        rememberedFromDevice: true,
        venueIds: ["venue-1"],
      }),
    );

    // The line is read on the page, and the region stays empty: an arrival that
    // prints what this device already answered is news about nothing.
    expect(savedLineCount(html)).toBe(1);
    expect(liveRegionTexts(html)).toEqual([""]);
  });

  it("announces once, not twice, when the remembered guest saves again", () => {
    const html = renderToStaticMarkup(
      createElement(InviteMapPrompt, {
        committedThisVisit: true,
        rememberedFromDevice: true,
        venueIds: ["venue-1"],
      }),
    );

    expect(savedLineCount(html)).toBe(1);
    expect(liveRegionTexts(html)).toEqual(["RSVP saved."]);
  });
});

describe("device RSVP memory", () => {
  it("remembers a confirmed RSVP per Plan on this device", () => {
    const storage = memoryStorage();

    expect(readDeviceRsvpCommitted("plan-1", storage)).toBe(false);
    markDeviceRsvpCommitted("plan-1", storage);

    expect(readDeviceRsvpCommitted("plan-1", storage)).toBe(true);
    // Another Plan's invite on the same device is a separate question.
    expect(readDeviceRsvpCommitted("plan-2", storage)).toBe(false);
    expect(storage.values.get(inviteRsvpDeviceKey("plan-1"))).toBe("1");
  });

  it("answers false rather than throwing when storage is denied", () => {
    const denied = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    };

    expect(readDeviceRsvpCommitted("plan-1", denied)).toBe(false);
    expect(() => markDeviceRsvpCommitted("plan-1", denied)).not.toThrow();
    expect(readDeviceRsvpCommitted("plan-1", null)).toBe(false);
    expect(readDeviceRsvpCommitted("   ", memoryStorage())).toBe(false);
  });
});

describe("invite RSVP member capability", () => {
  it("waits for HttpOnly session restoration before choosing the RSVP route", async () => {
    let finishRestore: ((value: { token: string; role: "host"; collaborationAuthorized: true }) => void) | undefined;
    const restore = () => new Promise<{ token: string; role: "host"; collaborationAuthorized: true }>((resolve) => {
      finishRestore = resolve;
    });
    let settled = false;

    const pending = resolveInviteRsvpSubmitCapability("plan-host-race", "", null, restore)
      .finally(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    finishRestore?.({ token: "__pubmax_http_only_plan_session__", role: "host", collaborationAuthorized: true });

    await expect(pending).resolves.toEqual({
      token: "__pubmax_http_only_plan_session__",
      role: "host",
    });
  });

  it("does not request either RSVP route when HttpOnly session restoration is unavailable", async () => {
    const restore = async () => {
      throw new PlanSessionUnavailableError();
    };
    const request = vi.fn(async () => new Response(null, { status: 200 }));

    let failure: unknown;
    try {
      await submitInviteRsvpAtMembershipBoundary({
        planId: "plan-session-down",
        inviteToken: "classic-token",
        displayName: "Priya",
        status: "going",
        submitterId: "device-priya",
        currentToken: "",
        currentRole: null,
      }, restore, request);
    } catch (error) {
      failure = error;
    }

    expect(request).not.toHaveBeenCalled();
    expect(failure).toBeInstanceOf(PlanSessionUnavailableError);
  });

  it("clears a revoked guest capability and retries through the public invite route", async () => {
    (globalThis as { window?: unknown }).window = { dispatchEvent: () => undefined };
    writePlanCapability("plan-stale-guest", {
      token: "stale-guest-token",
      role: "guest",
      collaborationAuthorized: false,
    });
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "PLAN_MEMBER_SESSION_REVOKED" }), { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ summary: {} }), { status: 200 }));

    const result = await postInviteRsvp({
      planId: "plan-stale-guest",
      inviteToken: "classic-token",
      displayName: "Priya",
      status: "going",
      submitterId: "device-priya",
      capability: { token: "stale-guest-token", role: "guest" },
    }, request);

    expect(request.mock.calls.map(([url]) => url)).toEqual([
      "/api/plans/plan-stale-guest/invite-rsvp",
      "/api/invite/classic-token/rsvp",
    ]);
    expect(result.capability).toBeNull();
    expect(readPlanCapabilitySnapshot("plan-stale-guest")).toBe("|0|");
    delete (globalThis as { window?: unknown }).window;
  });

  it("stores a Going guest capability without replacing an existing host", () => {
    (globalThis as { window?: unknown }).window = { dispatchEvent: () => undefined };
    applyInviteRsvpCapability("plan-going-guest", "going", null, {
      memberToken: "a".repeat(64),
      role: "guest",
      collaborationAuthorized: false,
    });
    expect(parsePlanCapabilitySnapshot(readPlanCapabilitySnapshot("plan-going-guest"))).toMatchObject({
      token: "a".repeat(64),
      role: "guest",
      collaborationAuthorized: false,
    });

    writePlanCapability("plan-going-host", {
      token: "host-token",
      role: "host",
      collaborationAuthorized: true,
    });
    expect(applyInviteRsvpCapability("plan-going-host", "going", "host", {
      memberToken: "b".repeat(64),
      role: "guest",
      collaborationAuthorized: false,
    })).toBe(false);
    expect(parsePlanCapabilitySnapshot(readPlanCapabilitySnapshot("plan-going-host"))).toMatchObject({
      token: "host-token",
      role: "host",
    });
    delete (globalThis as { window?: unknown }).window;
  });

  it("clears a revoked guest capability on Maybe but keeps a host capability", () => {
    (globalThis as { window?: unknown }).window = { dispatchEvent: () => undefined };
    writePlanCapability("plan-maybe-guest", {
      token: "guest-token",
      role: "guest",
      collaborationAuthorized: false,
    });
    applyInviteRsvpCapability("plan-maybe-guest", "maybe", "guest", {});
    expect(readPlanCapabilitySnapshot("plan-maybe-guest")).toBe("|0|");

    writePlanCapability("plan-maybe-host", {
      token: "host-token",
      role: "host",
      collaborationAuthorized: true,
    });
    applyInviteRsvpCapability("plan-maybe-host", "maybe", "host", {});
    expect(parsePlanCapabilitySnapshot(readPlanCapabilitySnapshot("plan-maybe-host"))).toMatchObject({
      token: "host-token",
      role: "host",
    });
    delete (globalThis as { window?: unknown }).window;
  });
});
