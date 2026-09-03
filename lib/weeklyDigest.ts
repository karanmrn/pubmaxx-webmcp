// Weekly digest — "your London week in pints" (Cycle 8 PRD, item 2).
//
// PURE + testable: this module composes a structured digest from ALREADY
// NORMALISED datasets and renders it to email-safe HTML + plain text. It imports
// no store, no Supabase, no fs, no env — the send script (scripts/send_weekly_digest.mjs)
// is the impure edge that loads the real data, resolves recipients, and hands
// messages to the provider seam (lib/emailProvider.ts).
//
// HONESTY CONTRACT (owner directive, non-negotiable):
//   - A section renders ONLY when real data backs it. No placeholders, no
//     "0 drops this week 🎉" cheer, no invented prices or events.
//   - An empty week yields a SHORTER email (greeting + one honest tip +
//     unsubscribe), never filler dressed up as data.
//   - Prices are GBP here (the script converts Pint Index pence → GBP before
//     calling in); observed-at windows are honoured so nothing stale reads live.
//   - Provenance ({label,url}) rides every price/what's-on line the renderer can
//     attribute, exactly as the in-app surfaces attribute them.

import { DAY_MS } from "@/lib/dayMs";
import { formatGbp } from "@/lib/formatGbp";

/** Days in the digest window, ending at `now`. */
export const DEFAULT_WINDOW_DAYS = 7;

/** How many cheapest-price lines the digest shows at most. */
export const MAX_CHEAPEST_LINES = 5;

/** How far ahead a "tonight / this weekend" highlight may start (hours). */
const HIGHLIGHT_HORIZON_HOURS = 72;

// ── Normalised inputs (the script adapts real stores/JSON to these) ──────────

export type DigestSource = { label: string; url: string };

/** One attributed price observation, GBP, with an observed-at timestamp. Unifies
 *  Pint Index observations and community drops after the script normalises them. */
export type DigestPriceObservation = {
  venueId: string;
  venueName: string;
  /** Canonical borough name (e.g. "Camden"), or null when unknown. */
  borough: string | null;
  priceGbp: number;
  observedAt: string; // ISO-8601
  source?: DigestSource;
};

/** A logged pint-price drop, reduced to what the digest counts. */
export type DigestDrop = {
  venueId: string;
  borough: string | null;
  createdAt: string; // ISO-8601
};

/** A what's-on row reduced to what a highlight needs. */
export type DigestWhatsOn = {
  title: string;
  placeName: string;
  borough: string | null;
  kind: string; // "sport" | "quiz" | "deal" | "music"
  startsAt: string; // ISO-8601
  observedAt: string; // ISO-8601 (freshness)
  source: DigestSource;
};

/** Who the digest is for + where they are, if we honestly know. */
export type DigestUserContext = {
  email: string;
  /** Canonical borough name inferred from the user's activity, or null. */
  borough?: string | null;
  /** Finer area label if known (rendered as-is), or null. */
  area?: string | null;
};

export type WeeklyDigestInput = {
  user: DigestUserContext;
  /** Window end (inclusive). Defaults to new Date() only via generateWeeklyDigest. */
  now: string | Date;
  windowDays?: number;
  priceObservations: readonly DigestPriceObservation[];
  drops: readonly DigestDrop[];
  whatsOn: readonly DigestWhatsOn[];
  /** Optional tip override (else a deterministic pick from GUARDIAN_TIPS). */
  tips?: readonly string[];
};

// ── Structured output ────────────────────────────────────────────────────────

export type CheapestLine = {
  venueName: string;
  borough: string | null;
  priceGbp: number;
  observedAt: string;
  source?: DigestSource;
};

export type TonightHighlight = {
  title: string;
  placeName: string;
  borough: string | null;
  kind: string;
  startsAt: string;
  source: DigestSource;
};

export type WeeklyDigestSections = {
  /** Cheapest fresh prices in-window, cheapest first. Absent when none. */
  cheapest?: CheapestLine[];
  /** Count of drops logged in-window (scoped). Absent when zero. */
  dropsLogged?: number;
  /** One fresh, soon highlight. Absent when none. */
  tonight?: TonightHighlight;
  /** One honest guardian-style tip. Always present (advice, not data). */
  tip: string;
};

export type WeeklyDigest = {
  email: string;
  /** Human scope label, e.g. "near Camden" or "across London". */
  scopeLabel: string;
  windowStart: string; // ISO
  windowEnd: string; // ISO
  subject: string;
  sections: WeeklyDigestSections;
  /** True when NO data section rendered (only greeting + tip). Drives the
   *  shorter-email path and lets callers skip sending an all-tip email if they
   *  choose (the script gates on this). */
  isEmpty: boolean;
};

// ── Guardian-style tips (honest general advice — the USP-1 "last train / last
//    orders guardian" voice). NOT fabricated data; clearly framed as a tip. ────

export const GUARDIAN_TIPS: readonly string[] = [
  "Closing times can change. Check the pub's hours and your last train before the final round.",
  "A logged pint price makes the map more useful. If a pub near you has no price yet, add one.",
  "Happy-hour times can change. Check the pub's own listing before you set off.",
  "Night Tube service varies by line and night. Check TfL before the final round.",
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function toMs(iso: string): number {
  return Date.parse(iso);
}

function isFiniteTime(ms: number): boolean {
  return Number.isFinite(ms);
}

/** Case/whitespace-insensitive borough match. */
function boroughMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Deterministic tip pick keyed to the window end — same week ⇒ same tip, so a
 *  user doesn't get a different tip on a re-run, and the rotation is stable. */
export function pickGuardianTip(
  windowEnd: Date,
  tips: readonly string[] = GUARDIAN_TIPS,
): string {
  if (tips.length === 0) return "";
  const dayIndex = Math.floor(windowEnd.getTime() / DAY_MS);
  const weekIndex = Math.floor(dayIndex / 7);
  return tips[((weekIndex % tips.length) + tips.length) % tips.length];
}

export { formatGbp } from "@/lib/formatGbp";

// ── Generator ─────────────────────────────────────────────────────────────────

/**
 * Compose the weekly digest for one user from normalised datasets. Pure: same
 * inputs → same output, no clock/IO of its own beyond the `now` you pass.
 */
export function generateWeeklyDigest(input: WeeklyDigestInput): WeeklyDigest {
  const end = input.now instanceof Date ? input.now : new Date(input.now);
  const windowDays = input.windowDays ?? DEFAULT_WINDOW_DAYS;
  const start = new Date(end.getTime() - windowDays * DAY_MS);
  const startMs = start.getTime();
  const endMs = end.getTime();

  const scopeBorough = input.user.borough ?? null;
  const inScope = (borough: string | null): boolean =>
    scopeBorough == null ? true : boroughMatches(borough, scopeBorough);

  const scopeLabel = scopeBorough
    ? `near ${input.user.area?.trim() || scopeBorough}`
    : "across London";

  // Cheapest fresh prices in-window, scoped, cheapest first, then freshest.
  const cheapest: CheapestLine[] = input.priceObservations
    .filter((o) => {
      const ms = toMs(o.observedAt);
      return (
        isFiniteTime(ms)
        && ms >= startMs
        && ms <= endMs
        && Number.isFinite(o.priceGbp)
        && o.priceGbp > 0
        && inScope(o.borough)
      );
    })
    .sort((a, b) => a.priceGbp - b.priceGbp || toMs(b.observedAt) - toMs(a.observedAt))
    .slice(0, MAX_CHEAPEST_LINES)
    .map((o) => ({
      venueName: o.venueName,
      borough: o.borough,
      priceGbp: o.priceGbp,
      observedAt: o.observedAt,
      source: o.source,
    }));

  // Drops logged in-window, scoped.
  const dropsLoggedCount = input.drops.filter((d) => {
    const ms = toMs(d.createdAt);
    return isFiniteTime(ms) && ms >= startMs && ms <= endMs && inScope(d.borough);
  }).length;

  // One tonight/weekend highlight: fresh (observed in-window), starting soon
  // (from now to +HORIZON), scoped. Pick the soonest.
  const horizonMs = endMs + HIGHLIGHT_HORIZON_HOURS * 3_600_000;
  const tonight = input.whatsOn
    .filter((w) => {
      const obs = toMs(w.observedAt);
      const startsAt = toMs(w.startsAt);
      return (
        isFiniteTime(obs)
        && obs >= startMs
        && obs <= endMs
        && isFiniteTime(startsAt)
        && startsAt >= endMs
        && startsAt <= horizonMs
        && inScope(w.borough)
      );
    })
    .sort((a, b) => toMs(a.startsAt) - toMs(b.startsAt))
    .map((w) => ({
      title: w.title,
      placeName: w.placeName,
      borough: w.borough,
      kind: w.kind,
      startsAt: w.startsAt,
      source: w.source,
    }))[0];

  const tip = pickGuardianTip(end, input.tips ?? GUARDIAN_TIPS);

  const sections: WeeklyDigestSections = { tip };
  if (cheapest.length > 0) sections.cheapest = cheapest;
  if (dropsLoggedCount > 0) sections.dropsLogged = dropsLoggedCount;
  if (tonight) sections.tonight = tonight;

  const isEmpty = !sections.cheapest && !sections.dropsLogged && !sections.tonight;

  return {
    email: input.user.email,
    scopeLabel,
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    subject: buildSubject(scopeBorough, input.user.area ?? null, cheapest[0] ?? null),
    sections,
    isEmpty,
  };
}

/** Subject line — honest and specific when there's a headline price, calm
 *  otherwise. Never over-promises. */
function buildSubject(
  borough: string | null,
  area: string | null,
  headline: CheapestLine | null,
): string {
  const where = area?.trim() || borough || "London";
  if (headline) {
    return `Your week in pints: ${formatGbp(headline.priceGbp)} at ${headline.venueName}, ${where}`;
  }
  return `Your week in pints, ${where}`;
}

// ── Recipient resolution + opt-in gating (pure) ──────────────────────────────
//
// PRIVACY-FIRST STANCE (owner decision documented in docs/EMAIL_DIGEST.md):
// there is NO user-preferences store in the repo today (profiles has no email;
// emails live only in Supabase Auth). So at this stage the digest gates on
// EXPLICIT OPT-IN — a user is mailed only if they positively opted in AND have
// not opted out. Opt-out ALWAYS wins over opt-in. When a durable
// `user_email_prefs` table lands (see docs), swap the source of these flags;
// this predicate does not change.

export type DigestAudienceMember = {
  id: string;
  email: string | null;
  /** Explicit opt-in (e.g. from auth user_metadata.digest_opt_in). */
  optIn?: boolean;
  /** Explicit opt-out (digest_opt_out) — always wins over opt-in. */
  optOut?: boolean;
  borough?: string | null;
  area?: string | null;
};

/** Minimal, deliberately strict address sanity check (defence-in-depth; the
 *  provider validates for real). Rejects empty, spaceful, or @-less strings. */
export function isLikelyEmail(value: string | null | undefined): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

/** Opt-in gate: mailed only when positively opted in and not opted out. */
export function isDigestOptedIn(
  member: Pick<DigestAudienceMember, "optIn" | "optOut">,
): boolean {
  if (member.optOut === true) return false;
  return member.optIn === true;
}

/**
 * Resolve the send list: only members with a valid email who are opted in.
 * Returns ready-to-generate user contexts. Order-preserving.
 */
export function resolveDigestRecipients(
  members: readonly DigestAudienceMember[],
): DigestUserContext[] {
  const out: DigestUserContext[] = [];
  for (const m of members) {
    if (!isLikelyEmail(m.email)) continue;
    if (!isDigestOptedIn(m)) continue;
    out.push({ email: m.email.trim(), borough: m.borough ?? null, area: m.area ?? null });
  }
  return out;
}

// ── Rendering (email-safe: inline styles only, no external CSS/fonts/images) ──
//
// Brand tokens inlined as constants (see DESIGN.md). Amber is the primary accent
// (main deploys ship amber per repo convention); pint-green marks cheap prices;
// warm ink on candle paper. To reskin, change these four values only.

const BRAND = {
  amber: "#f0a01a", // primary accent / brand
  pint: "#18a76d", // cheap pint / positive
  ink: "#17171a", // primary text
  inkSoft: "#3f3f46", // secondary text
  muted: "#6b6b73", // captions / provenance
  paper: "#faf8f5", // page base
  panel: "#fffdfb", // card
  line: "#e6e2de", // hairline
} as const;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Short, honest "how fresh" label for an observed-at within the week. */
export function freshnessLabel(observedAt: string, now: Date): string {
  const ms = toMs(observedAt);
  if (!isFiniteTime(ms)) return "";
  const days = Math.floor((now.getTime() - ms) / DAY_MS);
  if (days <= 0) return "logged today";
  if (days === 1) return "logged yesterday";
  return `logged ${days} days ago`;
}

function startLabel(startsAt: string): string {
  const ms = toMs(startsAt);
  if (!isFiniteTime(ms)) return "";
  return new Date(ms).toLocaleString("en-GB", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

/** Render the digest to email-safe HTML. Pure. */
export function renderWeeklyDigestHtml(digest: WeeklyDigest): string {
  const now = new Date(digest.windowEnd);
  const s = digest.sections;
  const rows: string[] = [];

  if (s.cheapest && s.cheapest.length > 0) {
    const items = s.cheapest
      .map((line) => {
        const where = line.borough ? ` · ${esc(line.borough)}` : "";
        const src = line.source
          ? ` <a href="${esc(line.source.url)}" style="color:${BRAND.muted};text-decoration:underline;">${esc(line.source.label)}</a>`
          : "";
        return `<tr><td style="padding:8px 0;border-bottom:1px solid ${BRAND.line};font-size:15px;color:${BRAND.ink};">
  <span style="font-weight:700;color:${BRAND.pint};">${formatGbp(line.priceGbp)}</span>
  &nbsp;${esc(line.venueName)}${where}
  <br><span style="font-size:12px;color:${BRAND.muted};">${esc(freshnessLabel(line.observedAt, now))}${src}</span>
</td></tr>`;
      })
      .join("\n");
    rows.push(sectionBlock(
      "Cheapest new prices this week",
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${items}</table>`,
    ));
  }

  if (s.dropsLogged && s.dropsLogged > 0) {
    const noun = s.dropsLogged === 1 ? "price was" : "prices were";
    rows.push(sectionBlock(
      "New prices logged",
      `<p style="margin:0;font-size:15px;color:${BRAND.ink};"><strong>${s.dropsLogged}</strong> new pint ${noun} logged ${esc(digest.scopeLabel)} this week.</p>`,
    ));
  }

  if (s.tonight) {
    const when = startLabel(s.tonight.startsAt);
    rows.push(sectionBlock(
      "Worth a look soon",
      `<p style="margin:0;font-size:15px;color:${BRAND.ink};"><strong>${esc(s.tonight.title)}</strong> at ${esc(s.tonight.placeName)}${when ? ` · ${esc(when)}` : ""}</p>
<p style="margin:6px 0 0;font-size:12px;color:${BRAND.muted};"><a href="${esc(s.tonight.source.url)}" style="color:${BRAND.muted};text-decoration:underline;">${esc(s.tonight.source.label)}</a></p>`,
    ));
  }

  // Tip always renders (honest advice; clearly a tip, not data).
  rows.push(sectionBlock(
    "Worth remembering",
    `<p style="margin:0;font-size:15px;color:${BRAND.inkSoft};font-style:italic;">${esc(s.tip)}</p>`,
  ));

  const empty = digest.isEmpty
    ? `<p style="margin:0 0 20px;font-size:15px;color:${BRAND.inkSoft};">Quiet week in your corner of London. No new prices or events near you. Here's one thing worth remembering anyway.</p>`
    : "";

  return `<!-- PUBMAXX weekly digest: email-safe, inline styles only -->
<div style="margin:0;padding:0;background:${BRAND.paper};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.paper};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:${BRAND.panel};border:1px solid ${BRAND.line};border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td style="padding:20px 24px;background:${BRAND.amber};">
  <div style="font-size:20px;font-weight:800;color:#1a1205;letter-spacing:-0.02em;">PUBMAXX</div>
  <div style="font-size:13px;color:#3a2c0a;margin-top:2px;">Your London week in pints · ${esc(digest.scopeLabel)}</div>
</td></tr>
<tr><td style="padding:24px;">
${empty}${rows.join("\n")}
</td></tr>
<tr><td style="padding:16px 24px 24px;border-top:1px solid ${BRAND.line};">
  <p style="margin:0;font-size:12px;color:${BRAND.muted};line-height:1.5;">
    You're getting this because you asked us to keep you posted. Source links appear beside prices and events when available.
    <br><a href="{{unsubscribe_url}}" style="color:${BRAND.muted};text-decoration:underline;">Unsubscribe</a> any time.
  </p>
</td></tr>
</table>
</td></tr>
</table>
</div>`;
}

function sectionBlock(heading: string, inner: string): string {
  return `<div style="margin:0 0 22px;">
<h2 style="margin:0 0 10px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:${BRAND.muted};">${esc(heading)}</h2>
${inner}
</div>`;
}

/** Render the digest to a plain-text alternative. Pure. Mirrors the HTML content
 *  1:1 so both parts say the same true thing. */
export function renderWeeklyDigestText(digest: WeeklyDigest): string {
  const now = new Date(digest.windowEnd);
  const s = digest.sections;
  const lines: string[] = [];
  lines.push("PUBMAXX: Your London week in pints");
  lines.push(digest.scopeLabel);
  lines.push("");

  if (digest.isEmpty) {
    lines.push(
      "Quiet week in your corner of London. No new prices or events near you. Here's one thing worth remembering anyway.",
    );
    lines.push("");
  }

  if (s.cheapest && s.cheapest.length > 0) {
    lines.push("CHEAPEST NEW PRICES THIS WEEK");
    for (const line of s.cheapest) {
      const where = line.borough ? ` · ${line.borough}` : "";
      const fresh = freshnessLabel(line.observedAt, now);
      const src = line.source ? ` (${line.source.label}: ${line.source.url})` : "";
      lines.push(`  ${formatGbp(line.priceGbp)}  ${line.venueName}${where}, ${fresh}${src}`);
    }
    lines.push("");
  }

  if (s.dropsLogged && s.dropsLogged > 0) {
    const noun = s.dropsLogged === 1 ? "price was" : "prices were";
    lines.push("NEW PRICES LOGGED");
    lines.push(`  ${s.dropsLogged} new pint ${noun} logged ${digest.scopeLabel} this week.`);
    lines.push("");
  }

  if (s.tonight) {
    const when = startLabel(s.tonight.startsAt);
    lines.push("WORTH A LOOK SOON");
    lines.push(`  ${s.tonight.title} at ${s.tonight.placeName}${when ? ` · ${when}` : ""}`);
    lines.push(`  (${s.tonight.source.label}: ${s.tonight.source.url})`);
    lines.push("");
  }

  lines.push("WORTH REMEMBERING");
  lines.push(`  ${s.tip}`);
  lines.push("");
  lines.push("---");
  lines.push(
    "You're getting this because you asked us to keep you posted. Source links appear beside prices and events when available.",
  );
  lines.push("Unsubscribe: {{unsubscribe_url}}");
  return lines.join("\n");
}

/** The per-recipient unsubscribe placeholder the renderers emit. The
 *  message-building path (toEmailMessage) MUST substitute it with a real,
 *  per-recipient URL before a message may leave this module. */
export const UNSUBSCRIBE_PLACEHOLDER = "{{unsubscribe_url}}";

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Fail-closed guard: no rendered message may ship with an unresolved template
 * placeholder. Catches the unsubscribe token (if substitution was skipped) and
 * any future `{{…}}` a renderer might add. Throws with a clear, actionable error
 * naming the offending token — never returns a half-templated email.
 */
export function assertNoResidualPlaceholders(rendered: string, part: "html" | "text"): void {
  const match = /\{\{\s*([^}]*?)\s*\}\}/.exec(rendered);
  if (match) {
    throw new Error(
      `weeklyDigest: unresolved template placeholder "{{${match[1]}}}" in rendered ${part}: refusing to build an email with unsubstituted content.`,
    );
  }
}

/**
 * Build the provider-ready message for a generated digest. `unsubscribeUrl` is
 * REQUIRED (P2-c): it is substituted per-recipient into both parts, HTML-escaped
 * in the HTML context and raw in the text context, and the result is asserted to
 * carry no residual `{{…}}` placeholder before the message is returned.
 */
export function toEmailMessage(
  digest: WeeklyDigest,
  options: { unsubscribeUrl: string },
): {
  to: string;
  subject: string;
  html: string;
  text: string;
} {
  const { unsubscribeUrl } = options;
  if (!isHttpUrl(unsubscribeUrl)) {
    throw new Error(
      "toEmailMessage: unsubscribeUrl is required and must be an absolute http(s) URL.",
    );
  }
  const html = renderWeeklyDigestHtml(digest).split(UNSUBSCRIBE_PLACEHOLDER).join(esc(unsubscribeUrl));
  const text = renderWeeklyDigestText(digest).split(UNSUBSCRIBE_PLACEHOLDER).join(unsubscribeUrl);
  assertNoResidualPlaceholders(html, "html");
  assertNoResidualPlaceholders(text, "text");
  return { to: digest.email, subject: digest.subject, html, text };
}
