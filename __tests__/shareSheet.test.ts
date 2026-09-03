import { describe, expect, it, vi } from "vitest";

import { whatsappShareHref } from "@/lib/shareArtifacts";
import { shareNightObject } from "@/lib/shareSheet";

// The one native-sheet-first / wa.me-fallback flow every night-object share
// goes through. Deps are injected, so no browser globals are touched.

const input = {
  title: "The Crown",
  text: "Fancy The Crown? £4.80 a pint.",
  url: "https://pubmaxxing.com/map/london?venue=the-crown",
};

describe("shareNightObject", () => {
  it("uses the native share sheet first when available", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const openWindow = vi.fn();

    const outcome = await shareNightObject(input, { nav: { share }, openWindow });

    expect(outcome).toBe("shared");
    expect(share).toHaveBeenCalledWith({
      title: input.title,
      text: input.text,
      url: input.url,
    });
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("treats a dismissed sheet as cancelled — no wa.me tab forced open", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("cancelled", "AbortError"));
    const openWindow = vi.fn();

    const outcome = await shareNightObject(input, { nav: { share }, openWindow });

    expect(outcome).toBe("cancelled");
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("falls back to wa.me when the native share genuinely fails", async () => {
    const share = vi.fn().mockRejectedValue(new Error("share broke"));
    const openWindow = vi.fn().mockReturnValue({});

    const outcome = await shareNightObject(input, { nav: { share }, openWindow });

    expect(outcome).toBe("whatsapp");
    expect(openWindow).toHaveBeenCalledWith(whatsappShareHref(input.text, input.url));
  });

  it("opens wa.me directly when there is no Web Share API", async () => {
    const openWindow = vi.fn().mockReturnValue({});

    const outcome = await shareNightObject(input, { nav: {}, openWindow });

    expect(outcome).toBe("whatsapp");
    const href = openWindow.mock.calls[0][0] as string;
    expect(href.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(href)).toContain(input.url);
    expect(decodeURIComponent(href)).toContain("£4.80 a pint");
  });

  it("reports failure when the wa.me window is popup-blocked", async () => {
    const openWindow = vi.fn().mockReturnValue(null);

    const outcome = await shareNightObject(input, { nav: {}, openWindow });

    expect(outcome).toBe("failed");
  });

  it("reports failure when opening the window throws", async () => {
    const openWindow = vi.fn(() => {
      throw new Error("blocked");
    });

    const outcome = await shareNightObject(input, { nav: {}, openWindow });

    expect(outcome).toBe("failed");
  });
});
