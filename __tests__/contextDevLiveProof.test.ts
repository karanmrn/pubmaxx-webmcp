import { describe, expect, it } from "vitest";

import { scrapeMarkdown } from "@/lib/contextDev.server";

const PROOF_URL = "https://www.fullers.co.uk/event-finder";

describe("contextDev live proof", () => {
  it.skipIf(!process.env.CONTEXT_DEV_API_KEY?.trim())(
    "scrapeMarkdown on a registered Fuller's events page",
    async () => {
      const result = await scrapeMarkdown(PROOF_URL, { maxAgeMs: 0 });
      const summary =
        result.status === "ok"
          ? {
              status: result.status,
              url: result.url,
              markdownChars: result.markdown.length,
              preview: result.markdown.slice(0, 800),
            }
          : result;
      // Captain proof artefact: trimmed output for PR bodies.
      console.log("contextDev live proof:", JSON.stringify(summary, null, 2));
      expect(result.status).toBe("ok");
      if (result.status !== "ok") throw new Error("expected ok");
      expect(result.markdown.length).toBeGreaterThan(0);
    },
    90_000,
  );
});
