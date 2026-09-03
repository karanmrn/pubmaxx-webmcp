import { afterEach, describe, expect, it, vi } from "vitest";

import { log, redact } from "@/lib/log";

// Spy on both console sinks so we can assert the exact single-line JSON payload
// AND which sink an event routes to. Restore after each test so the spies never
// leak into the rest of the suite.
afterEach(() => {
  vi.restoreAllMocks();
});

function spyConsole() {
  return {
    logSpy: vi.spyOn(console, "log").mockImplementation(() => {}),
    errorSpy: vi.spyOn(console, "error").mockImplementation(() => {}),
  };
}

describe("log", () => {
  it("emits a single line of parseable JSON with level, event, ts, and context", () => {
    const { logSpy } = spyConsole();
    log("info", "pint_drops.created", { route: "POST /api/pint-drops", status: 201 }, 123);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0][0] as string;
    // One line — no embedded newlines that would break a log aggregator.
    expect(line).not.toContain("\n");
    const parsed = JSON.parse(line);
    expect(parsed).toEqual({
      level: "info",
      event: "pint_drops.created",
      route: "POST /api/pint-drops",
      status: 201,
      ts: 123,
    });
  });

  it("routes error events to console.error, not console.log", () => {
    const { logSpy, errorSpy } = spyConsole();
    log("error", "pint_drops.create_failed", { error: "boom" }, 1);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
    const parsed = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(parsed).toEqual({ level: "error", event: "pint_drops.create_failed", error: "boom", ts: 1 });
  });

  it("routes warn events to console.log (only error uses console.error)", () => {
    const { logSpy, errorSpy } = spyConsole();
    log("warn", "pint_drops.photo_cleanup_failed", { keyCount: 2 }, 5);

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(JSON.parse(logSpy.mock.calls[0][0] as string).level).toBe("warn");
  });

  it("works with no context (still emits level, event, ts)", () => {
    const { logSpy } = spyConsole();
    log("info", "pint_drops.ping", undefined, 7);

    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual({
      level: "info",
      event: "pint_drops.ping",
      ts: 7,
    });
  });

  it("defaults ts to a real timestamp when not injected", () => {
    const { logSpy } = spyConsole();
    const before = Date.now();
    log("info", "pint_drops.ping");
    const after = Date.now();

    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(typeof parsed.ts).toBe("number");
    expect(parsed.ts).toBeGreaterThanOrEqual(before);
    expect(parsed.ts).toBeLessThanOrEqual(after);
  });

  it("never lets a stray context `ts` clobber the real timestamp", () => {
    const { logSpy } = spyConsole();
    // A caller passes a bogus `ts` field in context; the injected/real ts wins.
    log("info", "pint_drops.ping", { ts: 999999 } as Record<string, unknown>, 42);

    expect(JSON.parse(logSpy.mock.calls[0][0] as string).ts).toBe(42);
  });

  it("redacts secret-shaped context keys and never logs their values in the emitted line", () => {
    const { errorSpy } = spyConsole();
    log(
      "error",
      "pint_drops.create_failed",
      { token: "super-secret", serviceRoleKey: "srk_live_abc", error: "boom" },
      1,
    );
    const line = errorSpy.mock.calls[0][0] as string;
    // The raw secret values must not appear anywhere in the serialized line.
    expect(line).not.toContain("super-secret");
    expect(line).not.toContain("srk_live_abc");
    const parsed = JSON.parse(line);
    expect(parsed.token).toBe("[redacted]");
    expect(parsed.serviceRoleKey).toBe("[redacted]");
    expect(parsed.error).toBe("boom"); // safe field survives
  });
});

describe("redact", () => {
  it("masks obviously-sensitive keys but keeps the field present", () => {
    const out = redact({
      token: "abc",
      apiKey: "k",
      password: "p",
      authorization: "Bearer x",
      cookie: "sid=1",
      serviceRoleKey: "srk",
      ip: "1.2.3.4",
      error: "safe message",
      status: 503,
    });
    expect(out.token).toBe("[redacted]");
    expect(out.apiKey).toBe("[redacted]");
    expect(out.password).toBe("[redacted]");
    expect(out.authorization).toBe("[redacted]");
    expect(out.cookie).toBe("[redacted]");
    expect(out.serviceRoleKey).toBe("[redacted]");
    expect(out.ip).toBe("[redacted]");
    // Safe fields pass through untouched.
    expect(out.error).toBe("safe message");
    expect(out.status).toBe(503);
  });

  it("never serialises a raw binary payload — reports only its byte length", () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const arr = new Uint8Array([1, 2, 3]);
    const ab = new ArrayBuffer(8);
    const out = redact({ photo: buf, bytes: arr, raw: ab });
    expect(out.photo).toBe("[binary 4 bytes]");
    expect(out.bytes).toBe("[binary 3 bytes]");
    expect(out.raw).toBe("[binary 8 bytes]");
  });

  it("does not mutate the input object", () => {
    const input = { token: "abc", error: "boom" };
    const out = redact(input);
    expect(input.token).toBe("abc"); // original untouched
    expect(out).not.toBe(input);
  });
});
