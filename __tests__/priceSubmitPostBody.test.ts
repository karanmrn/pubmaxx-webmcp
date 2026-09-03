import { describe, expect, it } from "vitest";

import { parsePriceSubmitPostBody } from "@/lib/priceSubmitPostBody.server";

describe("parsePriceSubmitPostBody", () => {
  it("reads JSON price submissions", async () => {
    const parsed = await parsePriceSubmitPostBody(
      new Request("http://localhost/api/price-submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          venueId: "venue-xjf3n0",
          drinkCategory: "beer",
          priceGbp: 4.2,
        }),
      }),
    );

    expect(parsed).toEqual({
      fields: {
        venueId: "venue-xjf3n0",
        drinkCategory: "beer",
        priceGbp: 4.2,
      },
      photos: { pint: null, venue: null },
    });
  });

  it("reads multipart price submissions with an optional pint photo", async () => {
    const form = new FormData();
    form.set("venueId", "venue-xjf3n0");
    form.set("drinkCategory", "beer");
    form.set("priceGbp", "4.20");
    form.set(
      "pint_photo",
      new File([new Uint8Array([1, 2, 3])], "pint.jpg", { type: "image/jpeg" }),
    );

    const parsed = await parsePriceSubmitPostBody(
      new Request("http://localhost/api/price-submit", {
        method: "POST",
        body: form,
      }),
    );

    expect(parsed?.fields).toMatchObject({
      venueId: "venue-xjf3n0",
      drinkCategory: "beer",
      priceGbp: "4.20",
    });
    expect(parsed?.photos.pint).toBeInstanceOf(File);
    expect(parsed?.photos.venue).toBeNull();
  });

  it("returns null for a malformed JSON body instead of throwing", async () => {
    const parsed = await parsePriceSubmitPostBody(
      new Request("http://localhost/api/price-submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not valid json",
      }),
    );

    expect(parsed).toBeNull();
  });

  it("returns null for a broken multipart body instead of throwing", async () => {
    const parsed = await parsePriceSubmitPostBody(
      new Request("http://localhost/api/price-submit", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=not-the-real-boundary" },
        body: "this is not valid multipart content",
      }),
    );

    expect(parsed).toBeNull();
  });
});
