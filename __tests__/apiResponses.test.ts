import { describe, expect, it } from "vitest";

import { jsonNoStore } from "@/lib/apiResponses";

describe("jsonNoStore", () => {
  it("adds Cache-Control: no-store by default", async () => {
    const res = jsonNoStore({ ok: true }, { status: 202 });
    expect(res.status).toBe(202);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("preserves an explicit Cache-Control header", () => {
    const res = jsonNoStore(
      { ok: true },
      {
        headers: {
          "Cache-Control": "private, max-age=5",
        },
      },
    );
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=5");
  });
});
