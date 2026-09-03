// The browser half of the durable resume cookie.
//
// THE REPORT: "still not staying signed in". A persist that the server refuses
// leaves the device with NO durable session, and this call used to swallow the
// answer - so a browser could look signed in for a whole visit and come back
// cold, with nothing anywhere saying the cookie was never written. The outcome
// is returned now, and the one refusal a client can actually repair (a bearer
// token that has already expired) is repairable because the caller can see it.

import { describe, expect, it, vi } from "vitest";

import {
  fetchResumeHint,
  persistSessionForResume,
  redeemPersistedSession,
} from "@/lib/authSessionResumeClient";

const SESSION = { access_token: "at_1", refresh_token: "rt_1" };

describe("reading the resume hint", () => {
  it("distinguishes a present hint from an absent cookie", async () => {
    const present = vi.fn(
      async () =>
        new Response(JSON.stringify({ hint: { maskedEmail: "p***@example.com" } }), {
          status: 200,
        }),
    );
    const absent = vi.fn(
      async () => new Response(JSON.stringify({ hint: null }), { status: 200 }),
    );

    await expect(fetchResumeHint(present)).resolves.toEqual({
      status: "present",
      hint: { maskedEmail: "p***@example.com" },
    });
    await expect(fetchResumeHint(absent)).resolves.toEqual({ status: "absent" });
  });

  it("keeps server and transport failures unavailable", async () => {
    const serverFailure = vi.fn(async () => new Response("", { status: 503 }));
    const transportFailure = vi.fn(async () => {
      throw new Error("offline");
    });

    await expect(fetchResumeHint(serverFailure)).resolves.toEqual({
      status: "unavailable",
    });
    await expect(fetchResumeHint(transportFailure)).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("rejects a present hint without its masked address field", async () => {
    const malformed = vi.fn(
      async () => new Response(JSON.stringify({ hint: {} }), { status: 200 }),
    );

    await expect(fetchResumeHint(malformed)).resolves.toEqual({
      status: "unavailable",
    });
  });
});

describe("persisting the resume cookie", () => {
  it("reports a stored cookie", async () => {
    const request = vi.fn(async () => new Response("{}", { status: 200 }));
    await expect(persistSessionForResume(SESSION, request)).resolves.toBe(
      "stored",
    );
    const init = (request.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer at_1");
    expect(JSON.parse(String(init.body))).toEqual({
      action: "persist",
      refreshToken: "rt_1",
    });
  });

  it("names a refused bearer token rather than passing for success", async () => {
    const request = vi.fn(async () => new Response("{}", { status: 401 }));
    await expect(persistSessionForResume(SESSION, request)).resolves.toBe(
      "unauthenticated",
    );
  });

  it("treats every other failure as a transient one", async () => {
    const failing = vi.fn(async () => new Response("{}", { status: 503 }));
    await expect(persistSessionForResume(SESSION, failing)).resolves.toBe(
      "unavailable",
    );
    const offline = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(persistSessionForResume(SESSION, offline)).resolves.toBe(
      "unavailable",
    );
  });
});

describe("redeeming the resume cookie", () => {
  it("restores a session the server handed back", async () => {
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: "restored",
            session: { access_token: "at_2", refresh_token: "rt_2" },
          }),
          { status: 200 },
        ),
    );
    await expect(redeemPersistedSession(request)).resolves.toEqual({
      status: "restored",
      session: { access_token: "at_2", refresh_token: "rt_2" },
    });
  });

  it("carries the masked address through a dead token", async () => {
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ status: "expired", maskedEmail: "k…@example.com" }),
          { status: 200 },
        ),
    );
    await expect(redeemPersistedSession(request)).resolves.toEqual({
      status: "expired",
      maskedEmail: "k…@example.com",
    });
  });
});
