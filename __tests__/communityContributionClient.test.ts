import { describe, expect, it, vi } from "vitest";

import { postCommunityContribution } from "@/lib/communityContributionClient";

describe("community contribution client", () => {
  it.each([
    {
      payload: {
        venueId: "venue-1",
        drinkCategory: "beer" as const,
        priceGbp: 5.8,
      },
    },
    {
      payload: {
        kind: "venue-signal" as const,
        venueId: "venue-1",
        signalKey: "character" as const,
        signalValue: "rough" as const,
      },
    },
  ])("posts each observation with its captured account token", async ({ payload }) => {
    const request = vi.fn().mockResolvedValue(new Response("ok"));

    await postCommunityContribution(
      { userId: "user-a", accessToken: "token-a" },
      payload,
      undefined,
      request,
    );

    expect(request).toHaveBeenCalledWith(
      "/api/price-submit",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(payload),
        headers: expect.any(Headers),
      }),
    );
    const headers = new Headers(request.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer token-a");
  });

  it("posts a priced pint as multipart when a photo is attached", async () => {
    const request = vi.fn().mockResolvedValue(new Response("ok"));
    const pintPhoto = new File([new Uint8Array([1, 2, 3])], "pint.jpg", {
      type: "image/jpeg",
    });

    await postCommunityContribution(
      { userId: "user-a", accessToken: "token-a" },
      { venueId: "venue-1", drinkCategory: "beer", priceGbp: 5.8 },
      { pintPhoto },
      request,
    );

    const body = request.mock.calls[0]?.[1]?.body;
    expect(body).toBeInstanceOf(FormData);
    const form = body as FormData;
    expect(form.get("venueId")).toBe("venue-1");
    expect(form.get("drinkCategory")).toBe("beer");
    expect(form.get("priceGbp")).toBe("5.8");
    expect(form.get("pint_photo")).toBe(pintPhoto);
  });
});
