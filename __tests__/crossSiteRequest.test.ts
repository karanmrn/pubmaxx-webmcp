import { describe, expect, it } from "vitest";

import { isCrossSiteRequest } from "@/lib/crossSiteRequest";

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://pubmaxxing.com/api/auth/session", { headers });
}

describe("isCrossSiteRequest", () => {
  it("trusts Sec-Fetch-Site when the browser sends it", () => {
    expect(isCrossSiteRequest(request({ "sec-fetch-site": "cross-site" }))).toBe(true);
    expect(isCrossSiteRequest(request({ "sec-fetch-site": "same-origin" }))).toBe(false);
  });

  it("checks Origin when Sec-Fetch-Site is absent", () => {
    expect(
      isCrossSiteRequest(request({ origin: "https://attacker.example" })),
    ).toBe(true);
    expect(
      isCrossSiteRequest(request({ origin: "https://pubmaxxing.com" })),
    ).toBe(false);
  });

  it("allows requests without either browser hint", () => {
    expect(isCrossSiteRequest(request())).toBe(false);
  });

  it("fails closed for an invalid Origin", () => {
    expect(isCrossSiteRequest(request({ origin: "not a URL" }))).toBe(true);
  });
});
