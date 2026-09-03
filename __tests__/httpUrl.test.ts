import { describe, expect, it } from "vitest";

import { firstHttp, firstHttps, isHttpUrl } from "@/lib/httpUrl";

describe("httpUrl", () => {
  it("preserves valid comma query values for general http links", () => {
    const url = "https://booking.example/reserve?days=mon,tue";

    expect(isHttpUrl(url)).toBe(true);
    expect(firstHttp(url)).toBe(url);
    expect(firstHttps(url)).toBe(url);
  });
});
