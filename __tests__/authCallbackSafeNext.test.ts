import { describe, expect, it } from "vitest";

import { GET } from "@/app/auth/callback/route";
import { safeAuthNext as safeNext } from "@/lib/authRedirect";
import { mintReferralSignupProof } from "@/lib/referralSignupProof.server";

const ORIGIN = "https://pubmaxxing.com";
const ATTEMPT = "a".repeat(32);

describe("safeNext (auth callback open-redirect guard)", () => {
  it("allows same-origin absolute paths", () => {
    expect(safeNext("/", ORIGIN)).toBe("/");
    expect(safeNext("/map", ORIGIN)).toBe("/map");
    expect(safeNext("/u/ken?tab=drops", ORIGIN)).toBe("/u/ken?tab=drops");
    expect(safeNext("/feed#top", ORIGIN)).toBe("/feed#top");
  });

  it("rejects protocol-relative URLs", () => {
    expect(safeNext("//evil.com", ORIGIN)).toBe("/");
    expect(safeNext("//evil.com/phish", ORIGIN)).toBe("/");
  });

  it("rejects backslash host overrides that WHATWG would resolve off-origin", () => {
    // Encoded `\`: URLSearchParams yields "/\\evil.com"; new URL would → https://evil.com/
    expect(safeNext("/\\evil.com", ORIGIN)).toBe("/");
    expect(safeNext("/\\\\evil.com", ORIGIN)).toBe("/");
    expect(safeNext("/\\evil.com/steal", ORIGIN)).toBe("/");
  });

  it("rejects decoded /%5cevil.com (what URLSearchParams already decoded)", () => {
    // Simulate the callback reading next after URLSearchParams decoding.
    const decoded = decodeURIComponent("/%5cevil.com");
    expect(decoded).toBe("/\\evil.com");
    expect(safeNext(decoded, ORIGIN)).toBe("/");
    expect(safeNext(decodeURIComponent("/%5Cevil.com/phish"), ORIGIN)).toBe("/");
  });

  it("trims whitespace before validating paths", () => {
    expect(safeNext("  /map  ", ORIGIN)).toBe("/map");
    expect(safeNext("\t/u/ken?tab=drops\n", ORIGIN)).toBe("/u/ken?tab=drops");
    expect(safeNext("  //evil.com  ", ORIGIN)).toBe("/");
    expect(safeNext("  /\\evil.com  ", ORIGIN)).toBe("/");
  });

  it("rejects absolute and non-path values", () => {
    expect(safeNext("https://evil.com", ORIGIN)).toBe("/");
    expect(safeNext("evil.com", ORIGIN)).toBe("/");
    expect(safeNext("", ORIGIN)).toBe("/");
    expect(safeNext(null, ORIGIN)).toBe("/");
  });
});

describe("auth callback flow", () => {
  // The implicit-flow token fragment never reaches this server route; the
  // browser carries it across the redirect. So the route forwards every valid
  // attempt with the callback marker and lets the client decide success.
  it("forwards a valid attempt to an allowlisted deep link", async () => {
    const response = await GET(
      new Request(
        `${ORIGIN}/auth/callback?next=%2Fmap%3Farea%3Dsoho&_authAttempt=${ATTEMPT}`,
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location"))
      .toBe(
        `${ORIGIN}/map?area=soho&_authCallback=1&_authAttempt=${ATTEMPT}`,
      );
  });

  it("forwards the signup proof with the matching callback attempt", async () => {
    const signupProof = mintReferralSignupProof(ATTEMPT);
    const response = await GET(
      new Request(
        `${ORIGIN}/auth/callback?_authAttempt=${ATTEMPT}&_referralSignupProof=${signupProof}`,
      ),
    );

    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/?_authCallback=1&_authAttempt=${ATTEMPT}&_referralSignupProof=${signupProof}`,
    );
  });

  it("drops a hostile destination while still completing the callback", async () => {
    const response = await GET(
      new Request(
        `${ORIGIN}/auth/callback?next=${encodeURIComponent("//evil.com")}&_authAttempt=${ATTEMPT}`,
      ),
    );

    expect(response.headers.get("location"))
      .toBe(`${ORIGIN}/?_authCallback=1&_authAttempt=${ATTEMPT}`);
  });

  it("never sends a Location fragment that would replace the token fragment", async () => {
    const response = await GET(
      new Request(
        `${ORIGIN}/auth/callback?next=${encodeURIComponent("/feed#top")}&_authAttempt=${ATTEMPT}`,
      ),
    );

    expect(response.headers.get("location"))
      .toBe(`${ORIGIN}/feed?_authCallback=1&_authAttempt=${ATTEMPT}`);
  });

  it("returns safely to anonymous browsing when the link is invalid or rejected", async () => {
    const missing = await GET(new Request(`${ORIGIN}/auth/callback`));
    const rejected = await GET(
      new Request(`${ORIGIN}/auth/callback?error=access_denied&next=%2Fmap`),
    );

    expect(missing.headers.get("location")).toBe(`${ORIGIN}/?_authCallback=1&authError=1`);
    expect(rejected.headers.get("location"))
      .toBe(`${ORIGIN}/map?_authCallback=1&authError=1`);
  });
});
