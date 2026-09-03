import { cleanText } from "@/lib/textClean";

export const NIGHT_MOMENT_KINDS = [
  "photo",
  "pint_drop",
  "event",
  "venue",
  "quote",
  "person",
  "side_quest",
] as const;

export type NightMomentKind = (typeof NIGHT_MOMENT_KINDS)[number];
export type NightStoryVisibility = "private" | "unlisted" | "public";
export type NightStoryStatus = "draft" | "published";
export type StoryContributorRole = "host" | "editor" | "contributor";
// "withdrawn" (Wayfinder 5.5) marks a contributor who has departed a published
// Story — via consent withdrawal or account deletion — so the publish gate can
// redact their content + identity. It is additive: it never frees the host slot
// (the host-uniqueness index keys off `status <> 'removed'`), and it is distinct
// from "removed" (an invitation declined / a member kicked before publish).
export type StoryContributorStatus = "invited" | "accepted" | "removed" | "withdrawn";
export type MomentConsentStatus = "pending" | "approved" | "withdrawn";

export type NightMomentDraft = {
  kind: NightMomentKind;
  caption: string;
  pintDropId: string | null;
  venueId: string | null;
  mediaObjectKey: string | null;
  occurredAt: string | null;
  visibility: "private";
  // Author-written photo description (alt text). Optional at the trust boundary;
  // only ever meaningful for a Moment that carries media (mediaObjectKey). The
  // CONFIRMATION timestamp is never client-supplied — it is stamped server-side
  // when the author saves their own words (see addNightMoment / setMomentAltText).
  altText: string | null;
};

export type NightMoment = NightMomentDraft & {
  id: string;
  memoryId: string;
  ownerId: string;
  createdAt: string;
  // Set only when the AUTHOR confirmed the alt text (by saving it themselves).
  // Null means "no author-confirmed description yet" — which BLOCKS publication
  // of a photo Moment. AI may one day *suggest* altText, but a suggestion must
  // arrive here with a null confirmedAt and require an explicit author save to
  // gain a stamp; a machine suggestion is never auto-confirmed.
  altTextConfirmedAt: string | null;
};

/** Max length of an author-written photo description. */
export const NIGHT_MOMENT_ALT_TEXT_MAX = 200;

export type PintDropMoment = NightMoment & {
  kind: "pint_drop";
  pintDropId: string;
};

export type NightMemory = {
  id: string;
  ownerId: string;
  title: string;
  planCompletionId: string | null;
  visibility: "private";
  createdAt: string;
  updatedAt: string;
};

export type StoryContributor = {
  storyId: string;
  profileId: string;
  role: StoryContributorRole;
  status: StoryContributorStatus;
  joinedAt: string | null;
};

export type MomentConsent = {
  storyId: string;
  momentId: string;
  ownerId: string;
  status: MomentConsentStatus;
  decidedAt: string | null;
};

export type NightStory = {
  id: string;
  memoryId: string;
  hostEditorId: string;
  title: string;
  summary: string;
  status: NightStoryStatus;
  visibility: NightStoryVisibility;
  legacyCrawlStoryId: string | null;
  publishedMomentIds: string[];
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Public Story shape: private Memory and auth-account identifiers stay server-side. */
export type PublicNightStory = Omit<NightStory, "memoryId" | "hostEditorId">;

export type NightStoryPublicationProposal = {
  id: string;
  storyId: string;
  requestedBy: string;
  momentIds: string[];
  visibility: Exclude<NightStoryVisibility, "private">;
  expiresAt: string;
  confirmedAt: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function optionalText(value: unknown, max: number): string | null {
  const text = cleanText(value, max);
  return text || null;
}

function optionalDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

/** Normalise a Moment at the trust boundary. Every accepted Moment is private. */
export function cleanNightMomentDraft(raw: unknown): NightMomentDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  if (!NIGHT_MOMENT_KINDS.includes(input.kind as NightMomentKind)) return null;
  const kind = input.kind as NightMomentKind;
  const pintDropId = optionalText(input.pintDropId, 80);
  if (kind === "pint_drop" && (!pintDropId || !UUID.test(pintDropId))) return null;
  const caption = cleanText(input.caption, 500);
  const venueId = optionalText(input.venueId, 80);
  const mediaObjectKey = optionalText(input.mediaObjectKey, 500);
  if (!caption && !venueId && !mediaObjectKey && kind !== "pint_drop") return null;
  return {
    kind,
    caption,
    pintDropId: kind === "pint_drop" ? pintDropId : null,
    venueId,
    mediaObjectKey,
    occurredAt: optionalDate(input.occurredAt),
    visibility: "private",
    // Author-written alt text carried through from the capture surface. Never
    // rescues an otherwise-empty Moment (the guard above still applies); alt text
    // without media is meaningless. The confirmedAt stamp is applied downstream.
    altText: optionalText(input.altText, NIGHT_MOMENT_ALT_TEXT_MAX),
  };
}

/** A photo Moment (one that carries stored media) needs author-confirmed alt
 * text before it may be published. Non-photo Moments never need it. */
export function momentRequiresAltText(
  moment: Pick<NightMoment, "mediaObjectKey">,
): boolean {
  return Boolean(moment.mediaObjectKey);
}

/** True only when the author has confirmed a non-empty description. */
export function hasConfirmedAltText(
  moment: Pick<NightMoment, "altText" | "altTextConfirmedAt">,
): boolean {
  return Boolean(moment.altText && moment.altText.trim() && moment.altTextConfirmedAt);
}

/** The publication blocker: a photo Moment still missing author-confirmed alt
 * text. Wire this at the publish choke; a private Memory save never consults it. */
export function momentNeedsAltTextConfirmation(
  moment: Pick<NightMoment, "mediaObjectKey" | "altText" | "altTextConfirmedAt">,
): boolean {
  return momentRequiresAltText(moment) && !hasConfirmedAltText(moment);
}

/** Value-first, human-facing label naming WHICH photo still needs alt text. */
export function altTextGapLabel(
  moment: Pick<NightMoment, "caption" | "venueId">,
): string {
  const caption = moment.caption?.trim();
  if (caption) return caption.length > 60 ? `${caption.slice(0, 57)}…` : caption;
  if (moment.venueId) return `your photo at ${moment.venueId}`;
  return "one of your photos";
}

export function canEditNightStory(actorId: string, contributors: StoryContributor[]): boolean {
  return contributors.some(
    (contributor) =>
      contributor.profileId === actorId &&
      contributor.status === "accepted" &&
      (contributor.role === "host" || contributor.role === "editor"),
  );
}

export function hasPublicationConsent(
  ownerId: string,
  momentId: string,
  consents: MomentConsent[],
): boolean {
  return consents.some(
    (consent) =>
      consent.ownerId === ownerId &&
      consent.momentId === momentId &&
      consent.status === "approved",
  );
}
