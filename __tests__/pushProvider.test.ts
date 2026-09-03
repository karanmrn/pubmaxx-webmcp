import { generateKeyPairSync, verify as cryptoVerify, type KeyObject } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

// The provider seam (lib/pushProvider.ts): env-based selection mirrors
// storeBackend.selectStore. No live APNs — selection is driven with vi.stubEnv
// and the transport is an injected mock session factory (createApnsPushProvider
// takes the http2 seam), exactly the boundary the real sender crosses.
import {
  apnsPushProvider,
  buildApnsJwt,
  createApnsPushProvider,
  createWebPushProvider,
  isApnsConfigured,
  isVapidConfigured,
  noopPushProvider,
  noopWebPushProvider,
  selectPushProvider,
  type ApnsConfig,
  type ApnsProviderDeps,
  type ApnsRawResponse,
  type ApnsRequest,
  type ApnsTransport,
} from "@/lib/pushProvider";
import {
  buildFcmServiceAccountJwt,
  createFcmPushProvider,
  isFcmConfigured,
  noopFcmPushProvider,
  type FcmConfig,
} from "@/lib/fcmPushProvider";
import { encodeWebPushSubscription } from "@/lib/webPushSubscription";

const APNS_ENV = {
  APNS_KEY_ID: "KEY123",
  APNS_TEAM_ID: "TEAM456",
  APNS_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
};

const WEB_TOKEN = encodeWebPushSubscription({
  endpoint: "https://updates.push.services.mozilla.com/wpush/v2/provider",
  expirationTime: null,
  keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
})!;

function uncheckedWebToken(endpoint: string): string {
  return `webpush:${Buffer.from(JSON.stringify({
    endpoint,
    expirationTime: null,
    keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
  })).toString("base64url")}`;
}

function stubApnsEnv(): void {
  for (const [k, v] of Object.entries(APNS_ENV)) vi.stubEnv(k, v);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

// A real P-256 keypair so JWTs are genuinely signable + verifiable — the only
// honest way to test ES256 construction without a live Apple key.
const { privateKey: testPrivateKey, publicKey: testPublicKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
});
const testPrivatePem = testPrivateKey.export({ format: "pem", type: "pkcs8" }).toString();

const { privateKey: testFcmPrivateKey, publicKey: testFcmPublicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2_048,
});
const testFcmPrivatePem = testFcmPrivateKey.export({ format: "pem", type: "pkcs8" }).toString();

const TEST_CONFIG: ApnsConfig = {
  keyId: "TESTKEY",
  teamId: "TESTTEAM",
  privateKey: testPrivatePem,
  host: "api.sandbox.push.apple.com",
};

const TEST_FCM_CONFIG: FcmConfig = {
  projectId: "pubmaxx-test",
  clientEmail: "push@pubmaxx-test.iam.gserviceaccount.com",
  privateKeyId: "test-key-123",
  privateKey: testFcmPrivatePem,
};

function decodeJwtPart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

/** A recording mock transport. `responder` maps a token → the raw response;
 *  every request and the close() call are captured for assertions. */
function mockTransport(
  responder: (token: string) => ApnsRawResponse | Promise<ApnsRawResponse>,
): ApnsTransport & { requests: ApnsRequest[]; closed: number; host?: string } {
  const t: ApnsTransport & { requests: ApnsRequest[]; closed: number; host?: string } = {
    requests: [],
    closed: 0,
    async send(request) {
      t.requests.push(request);
      return responder(request.deviceToken);
    },
    close() {
      t.closed += 1;
    },
  };
  return t;
}

describe("isApnsConfigured", () => {
  it("is false unless all three APNs keys are present", () => {
    vi.stubEnv("APNS_KEY_ID", APNS_ENV.APNS_KEY_ID);
    vi.stubEnv("APNS_TEAM_ID", APNS_ENV.APNS_TEAM_ID);
    // Missing APNS_PRIVATE_KEY.
    expect(isApnsConfigured()).toBe(false);
  });

  it("is true when every APNs key and a valid environment are set", () => {
    stubApnsEnv();
    vi.stubEnv("APNS_ENV", "production");
    expect(isApnsConfigured()).toBe(true);
  });

  it("is false when APNS_ENV is missing or invalid", () => {
    stubApnsEnv();
    expect(isApnsConfigured()).toBe(false);

    vi.stubEnv("APNS_ENV", "staging");
    expect(isApnsConfigured()).toBe(false);
  });
});

describe("Firebase Cloud Messaging provider", () => {
  it("requires every service-account environment value", () => {
    vi.stubEnv("FCM_PROJECT_ID", TEST_FCM_CONFIG.projectId);
    vi.stubEnv("FCM_CLIENT_EMAIL", TEST_FCM_CONFIG.clientEmail);
    vi.stubEnv("FCM_PRIVATE_KEY_ID", TEST_FCM_CONFIG.privateKeyId);
    expect(isFcmConfigured()).toBe(false);
    vi.stubEnv("FCM_PRIVATE_KEY", TEST_FCM_CONFIG.privateKey);
    expect(isFcmConfigured()).toBe(true);
  });

  it("builds a verifiable RS256 service-account assertion", () => {
    const iat = 1_700_000_000;
    const jwt = buildFcmServiceAccountJwt({ ...TEST_FCM_CONFIG, iat });
    const [headerB64, claimsB64, signatureB64] = jwt.split(".");
    expect(decodeJwtPart(headerB64)).toEqual({
      alg: "RS256",
      typ: "JWT",
      kid: TEST_FCM_CONFIG.privateKeyId,
    });
    expect(decodeJwtPart(claimsB64)).toEqual({
      iss: TEST_FCM_CONFIG.clientEmail,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat,
      exp: iat + 3_600,
    });
    expect(cryptoVerify(
      "RSA-SHA256",
      Buffer.from(`${headerB64}.${claimsB64}`),
      testFcmPublicKey,
      Buffer.from(signatureB64, "base64url"),
    )).toBe(true);
  });

  it("mints one OAuth token, reuses it, and sends the HTTP v1 Android payload", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify({ access_token: "access-1", expires_in: 3_600 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      expect(url).toBe("https://fcm.googleapis.com/v1/projects/pubmaxx-test/messages:send");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer access-1",
        "content-type": "application/json",
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        message: {
          token: "android-token",
          notification: { title: "New tonight", body: "Late licence tonight" },
          data: { kind: "night_signal_live", url: "/tonight" },
          android: {
            priority: "HIGH",
            ttl: "21600s",
            notification: { sound: "default", tag: "night-signals" },
          },
        },
      });
      return new Response(JSON.stringify({ name: "projects/pubmaxx-test/messages/1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const provider = createFcmPushProvider({
      config: () => TEST_FCM_CONFIG,
      fetch: fetchMock,
      now: () => 1_700_000_000_000,
      accessTokenCache: new Map(),
    });

    const payload = {
      title: "New tonight",
      body: "Late licence tonight",
      threadId: "night-signals",
      data: { kind: "night_signal_live", url: "/tonight" },
    };
    expect(await provider.send(["android-token"], payload)).toEqual([
      { token: "android-token", status: "sent" },
    ]);
    expect(await provider.send(["android-token"], payload)).toEqual([
      { token: "android-token", status: "sent" },
    ]);
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("oauth2")).length).toBe(1);
    const tokenRequest = fetchMock.mock.calls.find(([input]) => String(input).includes("oauth2"));
    expect(String(tokenRequest?.[1]?.body)).toContain(
      "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer",
    );
  });

  it("prunes only FCM-specific invalid registrations and keeps service failures retryable", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes("oauth2")) {
        return new Response(JSON.stringify({ access_token: "access-1", expires_in: 3_600 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      const token = JSON.parse(String(init?.body)).message.token;
      if (token === "gone") {
        return new Response(JSON.stringify({
          error: {
            status: "NOT_FOUND",
            details: [{
              "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
              errorCode: "UNREGISTERED",
            }],
          },
        }), { status: 404, headers: { "content-type": "application/json" } });
      }
      if (token === "bad-payload") {
        return new Response(JSON.stringify({
          error: {
            status: "INVALID_ARGUMENT",
            details: [{ "@type": "type.googleapis.com/google.rpc.BadRequest" }],
          },
        }), { status: 400, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: { status: "UNAVAILABLE" } }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    });
    const provider = createFcmPushProvider({
      config: () => TEST_FCM_CONFIG,
      fetch: fetchMock,
      accessTokenCache: new Map(),
    });
    expect(await provider.send(["gone", "bad-payload", "retry"], { title: "T", body: "B" })).toEqual([
      { token: "gone", status: "invalid", reason: "fcm_unregistered" },
      { token: "bad-payload", status: "error", reason: "fcm_invalid_argument" },
      { token: "retry", status: "error", reason: "fcm_unavailable" },
    ]);
  });

  it("uses a truthful Android no-op until Firebase credentials exist", async () => {
    expect(selectPushProvider("android")).toBe(noopFcmPushProvider);
    expect(await noopFcmPushProvider.send(["android-token"], { title: "T", body: "B" })).toEqual([
      { token: "android-token", status: "skipped", reason: "fcm_not_configured" },
    ]);
  });

  it("fails loudly instead of treating partial Firebase credentials as unconfigured", async () => {
    vi.stubEnv("FCM_PROJECT_ID", TEST_FCM_CONFIG.projectId);
    const provider = selectPushProvider("android");
    expect(provider).not.toBe(noopFcmPushProvider);
    await expect(provider.send(["android-token"], { title: "T", body: "B" })).rejects.toThrow(
      "FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY_ID and FCM_PRIVATE_KEY must all be set",
    );
  });
});

describe("selectPushProvider", () => {
  it("selects truthful no-ops from the stored platform", () => {
    expect(selectPushProvider("ios")).toBe(noopPushProvider);
    expect(selectPushProvider("android")).toBe(noopFcmPushProvider);
    expect(selectPushProvider("web")).toBe(noopWebPushProvider);
  });

  it("recognises VAPID only when the public/private pair is complete", () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "public");
    expect(isVapidConfigured()).toBe(false);
    vi.stubEnv("VAPID_PRIVATE_KEY", "private");
    expect(isVapidConfigured()).toBe(true);
  });

  it("fails loudly instead of treating partial APNs configuration as absent", async () => {
    vi.stubEnv("APNS_KEY_ID", APNS_ENV.APNS_KEY_ID);

    const provider = selectPushProvider("ios");

    expect(provider).not.toBe(noopPushProvider);
    await expect(provider.send(["ios-token"], { title: "T", body: "B" })).rejects.toThrow(
      "APNS_KEY_ID, APNS_TEAM_ID and APNS_PRIVATE_KEY must all be set",
    );
  });
});

describe("noopPushProvider", () => {
  it("reports every token as skipped, in input order, and never throws", async () => {
    const results = await noopPushProvider.send(
      ["tok-a", "tok-b"],
      { title: "T", body: "B" },
    );
    expect(results).toEqual([
      { token: "tok-a", status: "skipped", reason: "apns_not_configured" },
      { token: "tok-b", status: "skipped", reason: "apns_not_configured" },
    ]);
  });

  it("returns [] for no tokens", async () => {
    expect(await noopPushProvider.send([], { title: "T", body: "B" })).toEqual([]);
  });
});

describe("Web Push / VAPID provider", () => {
  const config = {
    subject: "mailto:test@pubmaxxing.com",
    publicKey: "public-key",
    privateKey: "private-key",
  };

  it("sends the service-worker payload with VAPID config", async () => {
    const send = vi.fn(async () => ({ statusCode: 201 }));
    const provider = createWebPushProvider({ config: () => config, send });
    expect(await provider.send([WEB_TOKEN], {
      title: "Today in London",
      body: "Warm and dry.",
      threadId: "daily-brief",
      data: { kind: "daily_brief", url: "/today" },
    })).toEqual([{ token: WEB_TOKEN, status: "sent" }]);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "https://updates.push.services.mozilla.com/wpush/v2/provider" }),
      JSON.stringify({
        title: "Today in London",
        body: "Warm and dry.",
        tag: "daily-brief",
        data: { kind: "daily_brief", url: "/today" },
      }),
      config,
    );
  });

  it("marks 404/410 endpoints invalid and keeps 5xx retryable", async () => {
    const gone = createWebPushProvider({
      config: () => config,
      send: async () => { throw { statusCode: 410 }; },
    });
    const down = createWebPushProvider({
      config: () => config,
      send: async () => { throw { statusCode: 503 }; },
    });
    expect((await gone.send([WEB_TOKEN], { title: "T", body: "B" }))[0]).toMatchObject({
      status: "invalid", reason: "web_push_410",
    });
    expect((await down.send([WEB_TOKEN], { title: "T", body: "B" }))[0]).toMatchObject({
      status: "error", reason: "web_push_503",
    });
  });

  it("prunes a malformed encoded subscription without calling the network", async () => {
    const send = vi.fn(async () => ({ statusCode: 201 }));
    const provider = createWebPushProvider({ config: () => config, send });
    expect(await provider.send(["webpush:broken"], { title: "T", body: "B" })).toEqual([
      { token: "webpush:broken", status: "invalid", reason: "malformed_web_subscription" },
    ]);
    expect(send).not.toHaveBeenCalled();
  });

  it("revalidates stored endpoints at send time before any network call", async () => {
    const send = vi.fn(async () => ({ statusCode: 201 }));
    const provider = createWebPushProvider({ config: () => config, send });
    const tokens = [
      "https://127.0.0.1/wpush/token",
      "https://10.0.0.8/wpush/token",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/wpush/token",
      "https://localhost/wpush/token",
      "https://push.example.test/wpush/token",
      "https://fcm.googleapis.com:444/fcm/send/token",
    ].map(uncheckedWebToken);
    const results = await provider.send(tokens, { title: "T", body: "B" });
    expect(results).toHaveLength(tokens.length);
    expect(results.every((result) =>
      result.status === "invalid" && result.reason === "malformed_web_subscription",
    )).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it("the web no-op is loud in its result and never sends", async () => {
    expect(await noopWebPushProvider.send([WEB_TOKEN], { title: "T", body: "B" })).toEqual([
      { token: WEB_TOKEN, status: "skipped", reason: "vapid_not_configured" },
    ]);
  });

});

describe("buildApnsJwt", () => {
  it("produces a verifiable ES256 JWT with the right header + claims", () => {
    const iat = 1_700_000_000;
    const jwt = buildApnsJwt({
      keyId: "ABC123",
      teamId: "TEAM99",
      privateKey: testPrivatePem,
      iat,
    });
    const [headerB64, claimsB64, sigB64] = jwt.split(".");
    expect(jwt.split(".")).toHaveLength(3);

    const header = decodeJwtPart(headerB64);
    expect(header).toEqual({ alg: "ES256", kid: "ABC123" });

    const claims = decodeJwtPart(claimsB64);
    expect(claims).toEqual({ iss: "TEAM99", iat });

    // The signature must verify against the public key, in JOSE raw r‖s form
    // (64 bytes for P-256) — proving we did NOT emit DER.
    const signature = Buffer.from(sigB64, "base64url");
    expect(signature).toHaveLength(64);
    const ok = cryptoVerify(
      "sha256",
      Buffer.from(`${headerB64}.${claimsB64}`, "utf8"),
      { key: testPublicKey as KeyObject, dsaEncoding: "ieee-p1363" },
      signature,
    );
    expect(ok).toBe(true);
  });

  it("throws on an unparseable private key", () => {
    expect(() =>
      buildApnsJwt({ keyId: "K", teamId: "T", privateKey: "not-a-key", iat: 1 }),
    ).toThrow();
  });
});

describe("apnsPushProvider (default instance)", () => {
  it("throws a not-configured error when env keys are missing", async () => {
    await expect(apnsPushProvider.send(["tok"], { title: "T", body: "B" }))
      .rejects.toThrow(/APNS_KEY_ID, APNS_TEAM_ID and APNS_PRIVATE_KEY/);
  });

  it("throws (loud) when configured with an unparseable private key", async () => {
    // The env fixture's key is not a real p8 — a config error must surface, not
    // be masked as per-token noise (pushSender turns the throw into all-error).
    stubApnsEnv();
    await expect(apnsPushProvider.send(["tok"], { title: "T", body: "B" }))
      .rejects.toThrow();
  });

  it("returns [] for no tokens without touching config or transport", async () => {
    expect(await apnsPushProvider.send([], { title: "T", body: "B" })).toEqual([]);
  });
});

describe("createApnsPushProvider — transport + response mapping", () => {
  function providerWith(
    responder: (token: string) => ApnsRawResponse | Promise<ApnsRawResponse>,
    over: Partial<ApnsProviderDeps> = {},
  ) {
    const transport = mockTransport(responder);
    const hosts: string[] = [];
    const provider = createApnsPushProvider({
      config: () => TEST_CONFIG,
      now: () => 1_700_000_000_000,
      jwtCache: new Map(),
      sessionFactory: (host) => {
        hosts.push(host);
        transport.host = host;
        return transport;
      },
      ...over,
    });
    return { provider, transport, hosts };
  }

  it("maps 200 → sent", async () => {
    const { provider } = providerWith(() => ({ status: 200, apnsId: "a-1" }));
    const [r] = await provider.send(["tok"], { title: "T", body: "B" });
    expect(r).toEqual({ token: "tok", status: "sent" });
  });

  it("maps 410 → invalid (drives pruning)", async () => {
    const { provider } = providerWith(() => ({ status: 410, reason: "Unregistered" }));
    const [r] = await provider.send(["dead"], { title: "T", body: "B" });
    expect(r).toEqual({ token: "dead", status: "invalid", reason: "Unregistered" });
  });

  it("maps a 400 BadDeviceToken reason → invalid", async () => {
    const { provider } = providerWith(() => ({ status: 400, reason: "BadDeviceToken" }));
    const [r] = await provider.send(["bad"], { title: "T", body: "B" });
    expect(r).toEqual({ token: "bad", status: "invalid", reason: "BadDeviceToken" });
  });

  it("maps 429 → error (retryable, not pruned)", async () => {
    const { provider } = providerWith(() => ({ status: 429, reason: "TooManyRequests" }));
    const [r] = await provider.send(["tok"], { title: "T", body: "B" });
    expect(r).toEqual({ token: "tok", status: "error", reason: "TooManyRequests" });
  });

  it("maps 5xx → error", async () => {
    const { provider } = providerWith(() => ({ status: 503, reason: "ServiceUnavailable" }));
    const [r] = await provider.send(["tok"], { title: "T", body: "B" });
    expect(r).toEqual({ token: "tok", status: "error", reason: "ServiceUnavailable" });
  });

  it("maps an unexpected 4xx (e.g. bad JWT) → error, never invalid", async () => {
    const { provider } = providerWith(() => ({ status: 403, reason: "InvalidProviderToken" }));
    const [r] = await provider.send(["tok"], { title: "T", body: "B" });
    expect(r.status).toBe("error");
  });

  it("falls back to apns_<status> when the body carries no reason", async () => {
    const { provider } = providerWith(() => ({ status: 500 }));
    const [r] = await provider.send(["tok"], { title: "T", body: "B" });
    expect(r).toEqual({ token: "tok", status: "error", reason: "apns_500" });
  });

  it("turns a per-request rejection into a retryable error result (no throw)", async () => {
    const { provider } = providerWith(() => {
      throw new Error("stream RST_STREAM");
    });
    const [r] = await provider.send(["tok"], { title: "T", body: "B" });
    expect(r).toEqual({ token: "tok", status: "error", reason: "apns_request_failed" });
  });

  it("all-errors when the session cannot even be opened (connection failure)", async () => {
    const provider = createApnsPushProvider({
      config: () => TEST_CONFIG,
      now: () => 1_700_000_000_000,
      jwtCache: new Map(),
      sessionFactory: () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const results = await provider.send(["a", "b"], { title: "T", body: "B" });
    expect(results).toEqual([
      { token: "a", status: "error", reason: "apns_connect_failed" },
      { token: "b", status: "error", reason: "apns_connect_failed" },
    ]);
  });

  it("batches every token over ONE session, in input order, then closes it", async () => {
    const byToken: Record<string, ApnsRawResponse> = {
      good: { status: 200 },
      gone: { status: 410, reason: "Unregistered" },
      flaky: { status: 503, reason: "ServiceUnavailable" },
    };
    const { provider, transport, hosts } = providerWith((token) => byToken[token]);
    const results = await provider.send(["good", "gone", "flaky"], { title: "T", body: "B" });

    expect(results.map((r) => [r.token, r.status])).toEqual([
      ["good", "sent"],
      ["gone", "invalid"],
      ["flaky", "error"],
    ]);
    // One session, opened once to the resolved host, three multiplexed requests.
    expect(hosts).toEqual(["api.sandbox.push.apple.com"]);
    expect(transport.requests).toHaveLength(3);
    expect(transport.closed).toBe(1);
  });

  it("sends the correct APNs headers + aps envelope with custom data", async () => {
    const { provider, transport } = providerWith(() => ({ status: 200 }));
    await provider.send(["dev-token"], {
      title: "New tonight",
      body: "Cheap pints in SE1",
      threadId: "night-signals",
      data: { kind: "night_signal_live", entityId: "e1" },
    });
    const req = transport.requests[0];
    expect(req.headers["apns-topic"]).toBe("com.pubmaxx.app");
    expect(req.headers["apns-push-type"]).toBe("alert");
    expect(req.headers["apns-priority"]).toBe("10");
    expect(req.headers.authorization).toMatch(/^bearer /);

    const parsed = JSON.parse(req.body);
    expect(parsed.aps.alert).toEqual({ title: "New tonight", body: "Cheap pints in SE1" });
    expect(parsed.aps["thread-id"]).toBe("night-signals");
    // Custom data rides at the top level (Apple reserves `aps`).
    expect(parsed.kind).toBe("night_signal_live");
    expect(parsed.entityId).toBe("e1");
  });

  it("selects the production host when APNS_ENV=production", async () => {
    const transport = mockTransport(() => ({ status: 200 }));
    const hosts: string[] = [];
    // Use the real env-backed config resolver to prove APNS_ENV wiring.
    for (const [k, v] of Object.entries({ ...APNS_ENV, APNS_PRIVATE_KEY: testPrivatePem })) {
      vi.stubEnv(k, v);
    }
    vi.stubEnv("APNS_ENV", "production");
    const provider = createApnsPushProvider({
      now: () => 1_700_000_000_000,
      jwtCache: new Map(),
      sessionFactory: (host) => {
        hosts.push(host);
        return transport;
      },
    });
    await provider.send(["tok"], { title: "T", body: "B" });
    expect(hosts).toEqual(["api.push.apple.com"]);
  });

  it("selects the sandbox host when APNS_ENV=sandbox", async () => {
    const transport = mockTransport(() => ({ status: 200 }));
    const hosts: string[] = [];
    for (const [k, v] of Object.entries({ ...APNS_ENV, APNS_PRIVATE_KEY: testPrivatePem })) {
      vi.stubEnv(k, v);
    }
    vi.stubEnv("APNS_ENV", "sandbox");
    const provider = createApnsPushProvider({
      now: () => 1_700_000_000_000,
      jwtCache: new Map(),
      sessionFactory: (host) => {
        hosts.push(host);
        return transport;
      },
    });
    await provider.send(["tok"], { title: "T", body: "B" });
    expect(hosts).toEqual(["api.sandbox.push.apple.com"]);
  });

  it("normalizes escaped PEM newlines from one-line deployment values", async () => {
    const transport = mockTransport(() => ({ status: 200 }));
    for (const [k, v] of Object.entries(APNS_ENV)) vi.stubEnv(k, v);
    vi.stubEnv("APNS_PRIVATE_KEY", testPrivatePem.replace(/\n/g, "\\n"));
    vi.stubEnv("APNS_ENV", "production");
    const provider = createApnsPushProvider({
      now: () => 1_700_000_000_000,
      jwtCache: new Map(),
      sessionFactory: () => transport,
    });

    await expect(provider.send(["tok"], { title: "T", body: "B" })).resolves.toEqual([
      { token: "tok", status: "sent" },
    ]);
  });

  it("fails closed when APNS_ENV is unset", async () => {
    const sessionFactory = vi.fn(() => mockTransport(() => ({ status: 200 })));
    for (const [k, v] of Object.entries({ ...APNS_ENV, APNS_PRIVATE_KEY: testPrivatePem })) {
      vi.stubEnv(k, v);
    }
    const provider = createApnsPushProvider({ sessionFactory });

    await expect(provider.send(["tok"], { title: "T", body: "B" })).rejects.toThrow(
      'APNS_ENV must be set to "sandbox" or "production"',
    );
    expect(sessionFactory).not.toHaveBeenCalled();
  });

  it("fails closed when APNS_ENV is invalid", async () => {
    const sessionFactory = vi.fn(() => mockTransport(() => ({ status: 200 })));
    for (const [k, v] of Object.entries({ ...APNS_ENV, APNS_PRIVATE_KEY: testPrivatePem })) {
      vi.stubEnv(k, v);
    }
    vi.stubEnv("APNS_ENV", "staging");
    const provider = createApnsPushProvider({ sessionFactory });

    await expect(provider.send(["tok"], { title: "T", body: "B" })).rejects.toThrow(
      'APNS_ENV must be set to "sandbox" or "production"',
    );
    expect(sessionFactory).not.toHaveBeenCalled();
  });
});

describe("createApnsPushProvider — JWT caching / reuse window", () => {
  function bearerOf(transport: { requests: ApnsRequest[] }, i = 0): string {
    return transport.requests[i].headers.authorization.replace(/^bearer /, "");
  }

  it("reuses one signed JWT across sends within the ~50-min window, then refreshes", async () => {
    const cache = new Map();
    const transport = mockTransport(() => ({ status: 200 }));
    let clock = 1_700_000_000_000;
    const provider = createApnsPushProvider({
      config: () => TEST_CONFIG,
      now: () => clock,
      jwtCache: cache,
      sessionFactory: () => transport,
    });

    await provider.send(["a"], { title: "T", body: "B" });
    const jwt1 = bearerOf(transport, 0);

    // +40 min: still inside the reuse window → same token.
    clock += 40 * 60 * 1000;
    await provider.send(["b"], { title: "T", body: "B" });
    const jwt2 = bearerOf(transport, 1);
    expect(jwt2).toBe(jwt1);

    // +20 min more (60 total, past the 50-min window) → fresh token with a new iat.
    clock += 20 * 60 * 1000;
    await provider.send(["c"], { title: "T", body: "B" });
    const jwt3 = bearerOf(transport, 2);
    expect(jwt3).not.toBe(jwt1);

    const iat1 = (decodeJwtPart(jwt1.split(".")[1]) as { iat: number }).iat;
    const iat3 = (decodeJwtPart(jwt3.split(".")[1]) as { iat: number }).iat;
    expect(iat3).toBeGreaterThan(iat1);
  });
});
