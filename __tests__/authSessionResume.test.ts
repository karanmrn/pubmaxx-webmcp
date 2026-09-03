import { describe, expect, it } from "vitest";

import {
  AUTH_RESUME_COOKIE,
  AUTH_RESUME_MAX_AGE_SECONDS,
  authResumeCookieFromHeader,
  decodeAuthResumeCookie,
  encodeAuthResumeCookie,
  isPlausibleRefreshToken,
  maskEmail,
} from "@/lib/authSessionResume";

describe("auth session resume cookie helpers", () => {
  it("keeps the durable window at 30 days or more", () => {
    expect(AUTH_RESUME_MAX_AGE_SECONDS).toBeGreaterThanOrEqual(30 * 24 * 60 * 60);
  });

  it("round-trips refresh token and email", () => {
    const encoded = encodeAuthResumeCookie({
      refreshToken: "rt_abc123456",
      email: "person@example.com",
    });
    expect(decodeAuthResumeCookie(encoded)).toEqual({
      refreshToken: "rt_abc123456",
      email: "person@example.com",
      userId: null,
    });
  });

  it("round-trips an email-only payload (expired token keeps the hint)", () => {
    const encoded = encodeAuthResumeCookie({
      refreshToken: null,
      email: "person@example.com",
    });
    expect(decodeAuthResumeCookie(encoded)).toEqual({
      refreshToken: null,
      email: "person@example.com",
      userId: null,
    });
  });

  it("reads as absent for malformed, foreign, or empty values", () => {
    expect(decodeAuthResumeCookie(null)).toBeNull();
    expect(decodeAuthResumeCookie("")).toBeNull();
    expect(decodeAuthResumeCookie("not-base64-json")).toBeNull();
    expect(
      decodeAuthResumeCookie(Buffer.from("{}").toString("base64url")),
    ).toBeNull();
    expect(
      decodeAuthResumeCookie(
        Buffer.from(JSON.stringify({ v: 99, rt: "rt_abc123456" })).toString(
          "base64url",
        ),
      ),
    ).toBeNull();
  });

  it("extracts its own cookie from a crowded header", () => {
    const value = encodeAuthResumeCookie({
      refreshToken: "rt_abc123456",
      email: null,
    });
    const header = `theme=dark; ${AUTH_RESUME_COOKIE}=${encodeURIComponent(value)}; other=1`;
    expect(authResumeCookieFromHeader(header)).toBe(value);
    expect(authResumeCookieFromHeader("theme=dark")).toBeNull();
    expect(authResumeCookieFromHeader(null)).toBeNull();
  });

  it("reads junk cookie bytes as ABSENT rather than throwing", () => {
    // `decodeURIComponent` throws URIError on an invalid escape, and this helper
    // is called outside the try in verifySupabaseSessionFromRequest — so the
    // throw used to leave every Social read as an unhandled 500 for anyone whose
    // own cookie got corrupted.
    for (const junk of ["%zz", "%", "%E0%A4%A", "abc%"]) {
      expect(authResumeCookieFromHeader(`${AUTH_RESUME_COOKIE}=${junk}`)).toBeNull();
    }
    expect(
      authResumeCookieFromHeader(`theme=dark; ${AUTH_RESUME_COOKIE}=%zz; other=1`),
    ).toBeNull();
  });

  it("masks an email to first character plus domain", () => {
    expect(maskEmail("karan@example.com")).toBe("k…@example.com");
    expect(maskEmail("a@b.co")).toBe("a…@b.co");
    expect(maskEmail("")).toBeNull();
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail("@nolocal.com")).toBeNull();
  });

  it("bounds what counts as a refresh token", () => {
    expect(isPlausibleRefreshToken("rt_abc123456")).toBe(true);
    expect(isPlausibleRefreshToken("short")).toBe(false);
    expect(isPlausibleRefreshToken("x".repeat(3000))).toBe(false);
    expect(isPlausibleRefreshToken("has spaces in it")).toBe(false);
    expect(isPlausibleRefreshToken(42)).toBe(false);
  });
});
