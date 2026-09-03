import { describe, expect, it } from "vitest";

import {
  DEFAULT_WINDOW_DAYS,
  GUARDIAN_TIPS,
  MAX_CHEAPEST_LINES,
  assertNoResidualPlaceholders,
  generateWeeklyDigest,
  isDigestOptedIn,
  isLikelyEmail,
  pickGuardianTip,
  renderWeeklyDigestHtml,
  renderWeeklyDigestText,
  resolveDigestRecipients,
  toEmailMessage,
  type DigestPriceObservation,
  type WeeklyDigestInput,
} from "@/lib/weeklyDigest";

// Fixed "now" so windows are deterministic. Window = [now - 7d, now].
const NOW = new Date("2026-07-17T20:00:00.000Z");
const inWindow = (daysAgo: number) =>
  new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();

const SOURCE = { label: "The Anchor menu", url: "https://example.com/menu" };

function baseInput(overrides: Partial<WeeklyDigestInput> = {}): WeeklyDigestInput {
  return {
    user: { email: "drinker@example.com" },
    now: NOW,
    priceObservations: [],
    drops: [],
    whatsOn: [],
    ...overrides,
  };
}

describe("generateWeeklyDigest — data windows", () => {
  const obs = (daysAgo: number, price: number, borough: string | null = "Camden"): DigestPriceObservation => ({
    venueId: `v-${daysAgo}-${price}`,
    venueName: `Pub ${price}`,
    borough,
    priceGbp: price,
    observedAt: inWindow(daysAgo),
    source: SOURCE,
  });

  it("includes only price observations inside the window", () => {
    const digest = generateWeeklyDigest(
      baseInput({ priceObservations: [obs(1, 5.2), obs(6, 4.8), obs(9, 3.0)] }),
    );
    // The 9-days-ago observation is outside the 7-day window and excluded.
    expect(digest.sections.cheapest?.map((c) => c.priceGbp)).toEqual([4.8, 5.2]);
  });

  it("windowDays override changes the horizon", () => {
    const digest = generateWeeklyDigest(
      baseInput({ priceObservations: [obs(9, 3.0)], windowDays: 14 }),
    );
    expect(digest.sections.cheapest?.[0]?.priceGbp).toBe(3.0);
  });

  it("sorts cheapest-first and caps at MAX_CHEAPEST_LINES", () => {
    const many = Array.from({ length: 8 }, (_, i) => obs(1, 6 - i * 0.1));
    const digest = generateWeeklyDigest(baseInput({ priceObservations: many }));
    expect(digest.sections.cheapest).toHaveLength(MAX_CHEAPEST_LINES);
    const prices = digest.sections.cheapest!.map((c) => c.priceGbp);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it("drops zero and negative prices, and non-finite observedAt", () => {
    const digest = generateWeeklyDigest(
      baseInput({
        priceObservations: [
          obs(1, 0),
          { ...obs(1, -1), venueId: "neg" },
          { ...obs(1, 5), observedAt: "not-a-date" },
          obs(1, 4.5),
        ],
      }),
    );
    expect(digest.sections.cheapest?.map((c) => c.priceGbp)).toEqual([4.5]);
  });
});

describe("generateWeeklyDigest — scope", () => {
  it("filters to the user's borough when known", () => {
    const digest = generateWeeklyDigest(
      baseInput({
        user: { email: "d@e.com", borough: "Hackney" },
        priceObservations: [
          { venueId: "a", venueName: "A", borough: "Hackney", priceGbp: 5, observedAt: inWindow(1) },
          { venueId: "b", venueName: "B", borough: "Camden", priceGbp: 4, observedAt: inWindow(1) },
        ],
        drops: [
          { venueId: "a", borough: "Hackney", createdAt: inWindow(1) },
          { venueId: "b", borough: "Camden", createdAt: inWindow(1) },
        ],
      }),
    );
    expect(digest.scopeLabel).toBe("near Hackney");
    expect(digest.sections.cheapest?.map((c) => c.venueName)).toEqual(["A"]);
    expect(digest.sections.dropsLogged).toBe(1);
  });

  it("is London-wide when no borough is known", () => {
    const digest = generateWeeklyDigest(baseInput());
    expect(digest.scopeLabel).toBe("across London");
  });

  it("uses the finer area label in the scope when provided", () => {
    const digest = generateWeeklyDigest(
      baseInput({ user: { email: "d@e.com", borough: "Southwark", area: "Borough Market" } }),
    );
    expect(digest.scopeLabel).toBe("near Borough Market");
  });
});

describe("generateWeeklyDigest — section gating + empty week", () => {
  it("omits every data section and marks isEmpty when no real data", () => {
    const digest = generateWeeklyDigest(baseInput());
    expect(digest.sections.cheapest).toBeUndefined();
    expect(digest.sections.dropsLogged).toBeUndefined();
    expect(digest.sections.tonight).toBeUndefined();
    expect(digest.isEmpty).toBe(true);
    // A tip is always present (honest advice, not data).
    expect(digest.sections.tip.length).toBeGreaterThan(0);
  });

  it("does not count drops that fall outside the window", () => {
    const digest = generateWeeklyDigest(
      baseInput({ drops: [{ venueId: "a", borough: null, createdAt: inWindow(30) }] }),
    );
    expect(digest.sections.dropsLogged).toBeUndefined();
    expect(digest.isEmpty).toBe(true);
  });

  it("marks isEmpty false when at least one data section renders", () => {
    const digest = generateWeeklyDigest(
      baseInput({ drops: [{ venueId: "a", borough: null, createdAt: inWindow(2) }] }),
    );
    expect(digest.sections.dropsLogged).toBe(1);
    expect(digest.isEmpty).toBe(false);
  });

  it("selects only a fresh, soon what's-on highlight", () => {
    const soon = new Date(NOW.getTime() + 24 * 3_600_000).toISOString();
    const tooFar = new Date(NOW.getTime() + 200 * 3_600_000).toISOString();
    const digest = generateWeeklyDigest(
      baseInput({
        whatsOn: [
          { title: "Far Quiz", placeName: "P1", borough: null, kind: "quiz", startsAt: tooFar, observedAt: inWindow(1), source: SOURCE },
          { title: "Tonight Quiz", placeName: "P2", borough: null, kind: "quiz", startsAt: soon, observedAt: inWindow(1), source: SOURCE },
        ],
      }),
    );
    expect(digest.sections.tonight?.title).toBe("Tonight Quiz");
  });

  it("excludes a what's-on row whose provenance is stale (observed before the window)", () => {
    const soon = new Date(NOW.getTime() + 24 * 3_600_000).toISOString();
    const digest = generateWeeklyDigest(
      baseInput({
        whatsOn: [
          { title: "Stale", placeName: "P", borough: null, kind: "quiz", startsAt: soon, observedAt: inWindow(30), source: SOURCE },
        ],
      }),
    );
    expect(digest.sections.tonight).toBeUndefined();
  });
});

describe("subject line", () => {
  it("names the headline price + venue when there is one", () => {
    const digest = generateWeeklyDigest(
      baseInput({
        user: { email: "d@e.com", borough: "Camden" },
        priceObservations: [
          { venueId: "a", venueName: "The Oak", borough: "Camden", priceGbp: 4.5, observedAt: inWindow(1) },
        ],
      }),
    );
    expect(digest.subject).toBe("Your week in pints: £4.50 at The Oak, Camden");
  });

  it("stays calm when there's no headline price", () => {
    const digest = generateWeeklyDigest(baseInput());
    expect(digest.subject).toBe("Your week in pints, London");
  });
});

describe("pickGuardianTip", () => {
  it("is deterministic for a given week", () => {
    expect(pickGuardianTip(NOW)).toBe(pickGuardianTip(NOW));
  });

  it("returns a tip from the list", () => {
    expect(GUARDIAN_TIPS).toContain(pickGuardianTip(NOW));
  });

  it("keeps static tips to advice the product can support", () => {
    const copy = GUARDIAN_TIPS.join(" ");

    expect(copy).not.toContain("usually 20 minutes before close");
    expect(copy).not.toContain("Weeknights are quietly the best value");
    expect(copy).not.toContain("Zones 1–2 keep running late");
    expect(copy).toContain("Closing times can change");
    expect(copy).toContain("Night Tube service varies by line and night");
  });
});

describe("opt-in gating + recipient resolution (privacy-first)", () => {
  it("mails only positively opted-in members", () => {
    expect(isDigestOptedIn({ optIn: true })).toBe(true);
    expect(isDigestOptedIn({})).toBe(false);
    expect(isDigestOptedIn({ optIn: false })).toBe(false);
  });

  it("lets opt-out always win over opt-in", () => {
    expect(isDigestOptedIn({ optIn: true, optOut: true })).toBe(false);
  });

  it("validates email addresses", () => {
    expect(isLikelyEmail("a@b.co")).toBe(true);
    expect(isLikelyEmail("bad")).toBe(false);
    expect(isLikelyEmail("a @b.co")).toBe(false);
    expect(isLikelyEmail(null)).toBe(false);
  });

  it("resolves only valid-email opted-in members, preserving order + scope", () => {
    const recipients = resolveDigestRecipients([
      { id: "1", email: "yes@e.com", optIn: true, borough: "Camden" },
      { id: "2", email: "out@e.com", optIn: true, optOut: true },
      { id: "3", email: "noflag@e.com" },
      { id: "4", email: null, optIn: true },
      { id: "5", email: "bad-addr", optIn: true },
      { id: "6", email: "  also@e.com  ", optIn: true, borough: "Hackney", area: "Dalston" },
    ]);
    expect(recipients).toEqual([
      { email: "yes@e.com", borough: "Camden", area: null },
      { email: "also@e.com", borough: "Hackney", area: "Dalston" },
    ]);
  });
});

describe("rendering — honest, email-safe", () => {
  const rich = generateWeeklyDigest(
    baseInput({
      user: { email: "d@e.com", borough: "Camden" },
      priceObservations: [
        { venueId: "a", venueName: "The Oak", borough: "Camden", priceGbp: 4.5, observedAt: inWindow(1), source: SOURCE },
      ],
      drops: [{ venueId: "a", borough: "Camden", createdAt: inWindow(2) }],
      whatsOn: [
        { title: "Quiz Night", placeName: "The Oak", borough: "Camden", kind: "quiz", startsAt: new Date(NOW.getTime() + 12 * 3_600_000).toISOString(), observedAt: inWindow(1), source: SOURCE },
      ],
    }),
  );

  it("HTML uses inline styles only (no external CSS/fonts/images)", () => {
    const html = renderWeeklyDigestHtml(rich);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/<img\b/i);
    expect(html).not.toMatch(/@import|url\(http/i);
    expect(html).toContain("£4.50");
    expect(html).toContain("The Oak");
    expect(html).toContain("Quiz Night");
  });

  it("escapes untrusted venue/event text", () => {
    const evil = generateWeeklyDigest(
      baseInput({
        priceObservations: [
          { venueId: "x", venueName: "<script>bad</script>", borough: null, priceGbp: 5, observedAt: inWindow(1) },
        ],
      }),
    );
    const html = renderWeeklyDigestHtml(evil);
    expect(html).not.toContain("<script>bad");
    expect(html).toContain("&lt;script&gt;bad");
  });

  it("empty-week HTML + text are shorter and carry no invented data", () => {
    const empty = generateWeeklyDigest(baseInput());
    const html = renderWeeklyDigestHtml(empty);
    const text = renderWeeklyDigestText(empty);
    expect(html).toContain("Quiet week");
    expect(html).not.toContain("£");
    expect(text).toContain("Quiet week");
    expect(text).not.toContain("£");
    // Tip still present.
    expect(text).toContain("WORTH REMEMBERING");
  });

  it("text alternative mirrors the HTML content", () => {
    const html = renderWeeklyDigestHtml(rich);
    const text = renderWeeklyDigestText(rich);
    expect(text).toContain("£4.50");
    expect(text).toContain("The Oak");
    expect(text).toContain("Quiz Night");
    expect(text).toContain("Unsubscribe");
    expect(html).toContain("New prices logged");
    expect(text).toContain("NEW PRICES LOGGED");
    for (const rendered of [html, text]) {
      expect(rendered).not.toContain("data moat");
      expect(rendered).not.toContain("We never invent");
    }
  });

  it("limits footer source copy when a price has no source", () => {
    const digest = generateWeeklyDigest(
      baseInput({
        priceObservations: [
          {
            venueId: "unsourced",
            venueName: "The Local",
            borough: "Camden",
            priceGbp: 5,
            observedAt: inWindow(1),
          },
        ],
      }),
    );
    for (const rendered of [
      renderWeeklyDigestHtml(digest),
      renderWeeklyDigestText(digest),
    ]) {
      expect(rendered).toContain(
        "Source links appear beside prices and events when available.",
      );
      expect(rendered).not.toContain(
        "Every price and event names where it came from.",
      );
    }
  });

  it("toEmailMessage bundles subject/html/text and substitutes the unsubscribe URL", () => {
    const url = "https://pubmaxxing.com/u/tok-123";
    const msg = toEmailMessage(rich, { unsubscribeUrl: url });
    expect(msg.to).toBe("d@e.com");
    expect(msg.subject).toBe(rich.subject);
    expect(msg.html).toContain("PUBMAXX");
    expect(msg.text).toContain("PUBMAXX");
    // P2-c: placeholder is substituted, nothing residual survives.
    expect(msg.html).toContain(url);
    expect(msg.text).toContain(url);
    expect(msg.html).not.toContain("{{");
    expect(msg.text).not.toContain("{{");
  });

  it("toEmailMessage requires an absolute http(s) unsubscribe URL", () => {
    expect(() => toEmailMessage(rich, { unsubscribeUrl: "" })).toThrow(
      /unsubscribeUrl is required/,
    );
    expect(() => toEmailMessage(rich, { unsubscribeUrl: "not-a-url" })).toThrow(
      /absolute http\(s\) URL/,
    );
    expect(() =>
      toEmailMessage(rich, { unsubscribeUrl: "ftp://x/y" }),
    ).toThrow(/absolute http\(s\) URL/);
  });

  it("assertNoResidualPlaceholders throws on any unresolved {{…}} token", () => {
    expect(() => assertNoResidualPlaceholders("<p>ok</p>", "html")).not.toThrow();
    expect(() =>
      assertNoResidualPlaceholders("<a href='{{unsubscribe_url}}'>x</a>", "html"),
    ).toThrow(/unsubscribe_url/);
    expect(() => assertNoResidualPlaceholders("hi {{ leftover }} bye", "text")).toThrow(
      /leftover/,
    );
  });
});

describe("constants", () => {
  it("window default is a week", () => {
    expect(DEFAULT_WINDOW_DAYS).toBe(7);
  });
});
