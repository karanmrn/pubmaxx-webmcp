// Story redaction — the pure half of the one-choke privacy erase (Wayfinder 5.5).
//
// When a person departs a PUBLISHED Story — they withdraw their publication
// consent, or they delete their account — their content and their identity must
// disappear from that Story WITHOUT destroying everyone else's Story. This module
// is the deterministic, hermetic transform that does exactly that:
//
//   • Every Moment the departing person OWNS is dropped (their photos, their
//     media, their captions, their pint drops — gone).
//   • In the Moments that remain, any attribution to the departing person — their
//     @handle or their display name, wherever it was written into a caption or a
//     quote — is replaced with a neutral token ("a friend").
//   • The Story's own title and summary are scrubbed the same way.
//   • Nothing else changes: other contributors' Moments, order, and stats survive.
//
// It is applied at the single publish-emission choke (getPublishedRecapSource /
// the public projection in getNightStory), so one call covers every public
// surface — recap page, recap OG, feed — with no second gate to keep in sync.
//
// This is EMISSION-TIME redaction, not a destructive rewrite: it takes an already
// public-projected view and returns a redacted copy. The owner's private source
// Moments are never mutated here (creator-owned doctrine) — a departing guest
// vanishes from the shared Story while the owner keeps their own private record.
//
// Pure: no Date, no randomness, no I/O. Same input → same output, always.

import type { NightMoment, PublicNightStory } from "@/lib/nightMemory";

/** What a redacted attribution collapses to in captions, quotes, and titles. */
export const NEUTRAL_ATTRIBUTION_TOKEN = "a friend";

/**
 * A contributor who has departed a published Story. `profileId` matches a
 * Moment's `ownerId` (the auth account id). `handle` / `displayName` are the
 * identity strings scrubbed from surviving free text — either may be absent (an
 * account deletion clears the display name; a scrub still runs on the handle).
 */
export type DepartedContributor = {
  profileId: string;
  handle?: string | null;
  displayName?: string | null;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The identity strings to erase, longest-first so a display name is matched
 * before any substring of it and "@handle" before a bare "handle". Deduplicated
 * case-insensitively; iteration order over `departed` is stabilised by
 * profileId so the needle set (and thus every scrub) is deterministic.
 */
function identityNeedles(departed: DepartedContributor[]): string[] {
  const seen = new Set<string>();
  const needles: string[] = [];
  const ordered = [...departed].sort((a, b) => a.profileId.localeCompare(b.profileId));
  for (const person of ordered) {
    for (const raw of [person.handle, person.displayName]) {
      const value = typeof raw === "string" ? raw.trim() : "";
      if (!value) continue;
      const key = value.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      needles.push(value);
    }
  }
  return needles.sort((a, b) => b.length - a.length || a.localeCompare(b));
}

/**
 * Replace every whole-token occurrence of a departed identity — with or without a
 * leading "@" — with the neutral token. Word-boundary anchored so it never eats a
 * substring of an unrelated word ("john" does not touch "johnson"). Case-
 * insensitive. Collapses the whitespace a removal can leave behind.
 */
function scrubIdentities(text: string, needles: string[]): string {
  if (!text || needles.length === 0) return text;
  let out = text;
  for (const needle of needles) {
    const pattern = new RegExp(`(^|[^\\w@])@?${escapeRegExp(needle)}(?![\\w])`, "gi");
    out = out.replace(pattern, (_match, boundary: string) => `${boundary}${NEUTRAL_ATTRIBUTION_TOKEN}`);
  }
  return out.replace(/[ \t]{2,}/g, " ").trim();
}

/** Scrub departed identities from a public Story's title + summary only. */
export function redactPublicStoryFields<T extends { title: string; summary: string }>(
  story: T,
  departed: DepartedContributor[],
): T {
  const needles = identityNeedles(departed);
  if (needles.length === 0) return story;
  return {
    ...story,
    title: scrubIdentities(story.title, needles),
    summary: scrubIdentities(story.summary, needles),
  };
}

/**
 * The full emission-time redaction: drop every Moment owned by a departed
 * contributor, scrub their identity out of the surviving Moments' captions and
 * out of the Story's title/summary, and leave the rest of the Story intact.
 * A no-op (returns the same shape untouched) when `departed` is empty.
 */
export function redactStoryView(input: {
  story: PublicNightStory;
  moments: NightMoment[];
  departed: DepartedContributor[];
}): { story: PublicNightStory; moments: NightMoment[] } {
  const { story, moments, departed } = input;
  if (departed.length === 0) return { story, moments };
  const departedIds = new Set(departed.map((person) => person.profileId).filter(Boolean));
  const needles = identityNeedles(departed);
  const survivingMoments = moments
    .filter((moment) => !departedIds.has(moment.ownerId))
    .map((moment) =>
      needles.length === 0 ? moment : { ...moment, caption: scrubIdentities(moment.caption, needles) },
    );
  return {
    story: needles.length === 0 ? story : redactPublicStoryFields(story, departed),
    moments: survivingMoments,
  };
}
