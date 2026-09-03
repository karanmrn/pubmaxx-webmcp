import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  generateWeeklyDigest,
  toEmailMessage,
  type WeeklyDigestInput,
} from "@/lib/weeklyDigest";

// Rendered-example fixtures for review (Cycle 8 PRD item 5). Three scenarios
// cover the honesty spectrum: a full week, a partial week, and an empty week.
//
// The committed HTML/text files under docs/digest-samples/ are the review
// artefacts. They are the FINAL provider-ready messages (built via
// toEmailMessage), so the per-recipient unsubscribe URL is substituted and NO
// `{{…}}` placeholder survives (P2-c). A fixed example URL is used for
// reproducibility. This spec asserts the builder still produces them; run with
// WRITE_DIGEST_FIXTURES=1 to regenerate the committed files after an
// intentional copy/markup change:
//
//   WRITE_DIGEST_FIXTURES=1 npx vitest run __tests__/weeklyDigestFixtures.test.ts

// Fixture-input only: a fixed, obviously-example unsubscribe URL so the rendered
// fixtures are byte-stable. The production send path supplies a real per-recipient URL.
const FIXTURE_UNSUBSCRIBE_URL = "https://pubmaxxing.com/u/EXAMPLE-UNSUBSCRIBE-TOKEN";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "docs", "digest-samples");
const WRITE = process.env.WRITE_DIGEST_FIXTURES === "1";

// Fixed clock so fixtures are byte-stable across runs.
const NOW = new Date("2026-07-17T20:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const hoursAhead = (n: number) => new Date(NOW.getTime() + n * 3_600_000).toISOString();

const SCENARIOS: Record<string, WeeklyDigestInput> = {
  "full-week-camden": {
    user: { email: "sam@example.com", borough: "Camden", area: "Kentish Town" },
    now: NOW,
    priceObservations: [
      { venueId: "v1", venueName: "The Pineapple", borough: "Camden", priceGbp: 4.8, observedAt: daysAgo(1), source: { label: "The Pineapple menu", url: "https://example.com/pineapple" } },
      { venueId: "v2", venueName: "The Southampton Arms", borough: "Camden", priceGbp: 5.2, observedAt: daysAgo(2), source: { label: "Pint Drop (confirmed)", url: "https://pubmaxxing.com/drops/v2" } },
      { venueId: "v3", venueName: "The Lord Palmerston", borough: "Camden", priceGbp: 5.9, observedAt: daysAgo(4), source: { label: "The Lord Palmerston", url: "https://example.com/palmerston" } },
    ],
    drops: [
      { venueId: "v1", borough: "Camden", createdAt: daysAgo(1) },
      { venueId: "v2", borough: "Camden", createdAt: daysAgo(2) },
      { venueId: "v4", borough: "Camden", createdAt: daysAgo(3) },
    ],
    whatsOn: [
      { title: "Sunday Quiz — £2 entry, keg for the winners", placeName: "The Pineapple", borough: "Camden", kind: "quiz", startsAt: hoursAhead(20), observedAt: daysAgo(1), source: { label: "The Pineapple listings", url: "https://example.com/pineapple/quiz" } },
    ],
  },
  "partial-week-london": {
    // London-wide (no known borough); only drops happened this week.
    user: { email: "alex@example.com" },
    now: NOW,
    priceObservations: [],
    drops: [
      { venueId: "v9", borough: "Southwark", createdAt: daysAgo(2) },
      { venueId: "v10", borough: "Hackney", createdAt: daysAgo(5) },
    ],
    whatsOn: [],
  },
  "empty-week-barnet": {
    user: { email: "jordan@example.com", borough: "Barnet" },
    now: NOW,
    priceObservations: [],
    drops: [],
    whatsOn: [],
  },
};

describe("weekly digest fixtures", () => {
  if (WRITE && !existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  for (const [name, input] of Object.entries(SCENARIOS)) {
    it(`renders ${name} (matches committed fixture)`, () => {
      const digest = generateWeeklyDigest(input);
      // Final provider-ready message: unsubscribe URL substituted + guarded.
      const { html, text } = toEmailMessage(digest, {
        unsubscribeUrl: FIXTURE_UNSUBSCRIBE_URL,
      });

      const htmlPath = join(OUT_DIR, `${name}.html`);
      const textPath = join(OUT_DIR, `${name}.txt`);

      if (WRITE) {
        writeFileSync(htmlPath, `${html}\n`);
        writeFileSync(textPath, `${text}\n`);
      }

      // Sanity that always holds, write or not.
      expect(html).toContain("PUBMAXX");
      expect(text).toContain("PUBMAXX");
      // P2-c: no residual template placeholder in a built message.
      expect(html).not.toContain("{{");
      expect(text).not.toContain("{{");
      expect(html).toContain(FIXTURE_UNSUBSCRIBE_URL);
      expect(text).toContain(FIXTURE_UNSUBSCRIBE_URL);

      // When fixtures exist, they must stay in sync with the builder.
      if (existsSync(htmlPath)) {
        expect(readFileSync(htmlPath, "utf8")).toBe(`${html}\n`);
        expect(readFileSync(textPath, "utf8")).toBe(`${text}\n`);
      }
    });
  }
});
