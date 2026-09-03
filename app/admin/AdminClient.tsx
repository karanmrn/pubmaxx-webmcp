"use client";

import Image from "next/image";

import VenuePhotoModeration, {
  type ModeratorVenuePhoto,
} from "./VenuePhotoModeration";
import Link from "next/link";
import { useCallback, useState } from "react";

import {
  ADMIN_SESSION_NOT_AUTHORISED_MESSAGE,
  ADMIN_SESSION_UNCONFIRMED_MESSAGE,
  browserFetch,
  readAdminSessionState,
  submitAdminToken,
  type AdminSessionSubmitOutcome,
} from "@/lib/adminSessionClient";
import { adminAlert, adminStatus, type AdminNotice } from "@/lib/adminNotice";
import { discardBody } from "@/lib/responseBody";
import { errorMessageFrom, readApiJson } from "@/lib/apiErrorMessage";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";
import { venueMapUrl } from "@/lib/venueMapUrl";
import {
  COMMUNITY_VENUE_SIGNAL_LABELS,
  COMMUNITY_VENUE_SIGNAL_OPTIONS,
  isCommunityVenueSignalKey,
} from "@/lib/communityVenueSignals";
import SiteNav from "@/components/nav/SiteNav";

import "./admin.css";

// Moderator DTO as returned by GET ?status=reported|hidden. Photos resolve even
// on hidden rows; report metadata rides along. Kept loose (optional) — old rows
// may lack it.
type ModeratorDrop = {
  id: string;
  venueId: string;
  handle: string;
  drink: string;
  priceGbp: number | null;
  passedDownNote: string;
  era: string;
  status: string;
  pintPhotoUrl: string | null;
  venuePhotoUrl: string | null;
  reportReason?: string;
  reportCount?: number;
  reportedAt?: string;
};

// Community observations share one API queue. A price carries a figure and
// drink category; a venue signal carries its question and categorical answer.
// The moderator must see the shape before deciding whether to hide it.
type ModeratorCommunityPrice = {
  id: string;
  venueId: string;
  submittedAt: number;
  hidden: boolean;
  reportCount: number;
  reportedAt?: number;
  reportReason?: string;
  moderatorNote?: string;
  kind: "price" | "signal";
  drinkCategory?: string;
  priceGbp?: number;
  signalKey?: string;
  signalValue?: string;
};

function communityObservationText(row: ModeratorCommunityPrice): string {
  if (row.kind === "price") {
    const category = row.drinkCategory ?? "Unknown drink";
    return row.priceGbp == null
      ? category
      : `${category} · £${row.priceGbp.toFixed(2)}`;
  }
  if (!isCommunityVenueSignalKey(row.signalKey)) return "Venue signal";
  const option = COMMUNITY_VENUE_SIGNAL_OPTIONS[row.signalKey].find(
    (candidate) => candidate.value === row.signalValue,
  );
  return `${COMMUNITY_VENUE_SIGNAL_LABELS[row.signalKey]}: ${option?.label ?? "Unknown"}`;
}

export function moderatorReportEvidence(
  verifiedCount: number | undefined,
  reportedAt: string | undefined,
): { verifiedCount: number; hasEvidence: boolean } {
  return {
    verifiedCount: Math.max(verifiedCount ?? 0, 0),
    hasEvidence: Boolean(reportedAt),
  };
}

// Moderator comment DTO as returned by GET /api/admin/comments?status=hidden.
// Carries status + the drop it belongs to; never actor_hash.
type ModeratorComment = {
  id: string;
  pintDropId: string;
  handle: string;
  body: string;
  status: string;
  createdAt: string;
};

// Moderator visit-report row as returned by GET /api/visit-reports?status=reported
// and ?status=hidden. The full row minus nothing (report + decision metadata ride
// along for the reviewer, so a hidden row carries the identity to restore it).
type ModeratorVisitReport = {
  id: string;
  venueId: string;
  handle: string;
  visitedAt: string;
  busyness: string | null;
  noise: string | null;
  seating: string | null;
  serviceWait: string | null;
  note: string;
  reportReason?: string;
  reportCount?: number;
  reportedAt?: string;
  moderatedAt?: string;
  moderatorNote?: string;
};

// Moderator owned-avatar row as returned by GET /api/admin/profile-avatars
// ?status=reported|hidden. Reporter actor hashes never ride along.
export type ModeratorProfileAvatar = {
  handle: string;
  profileId: string;
  generation: string;
  moderationState: string;
  reportCount: number;
  reportedAt?: string;
  reportReason?: string;
  moderatedAt?: string;
  moderatorNote?: string;
  previewUrl?: string;
};

export type ModeratorProfileCover = {
  id: string;
  profileId: string;
  handle: string;
  position: number;
  generation: string;
  moderationState: string;
  reportCount: number;
  reportedAt?: string;
  reportReason?: string;
  moderatedAt?: string;
  moderatorNote?: string;
  previewUrl?: string;
  rotationOnly: boolean;
};

/** Turn the profile mirror row into the same cover queue shape as a rotation row. */
export function profileCoverFromAvatar(avatar: ModeratorProfileAvatar): ModeratorProfileCover {
  return {
    id: `profile-cover:${avatar.profileId}`,
    profileId: avatar.profileId,
    handle: avatar.handle,
    position: 1,
    generation: avatar.generation,
    moderationState: avatar.moderationState,
    reportCount: avatar.reportCount,
    ...(avatar.reportedAt ? { reportedAt: avatar.reportedAt } : {}),
    ...(avatar.reportReason ? { reportReason: avatar.reportReason } : {}),
    ...(avatar.moderatedAt ? { moderatedAt: avatar.moderatedAt } : {}),
    ...(avatar.moderatorNote ? { moderatorNote: avatar.moderatorNote } : {}),
    ...(avatar.previewUrl ? { previewUrl: avatar.previewUrl } : {}),
    rotationOnly: false,
  };
}

type AdminTab = "moderation" | "import" | "operators";

// Operator rail (Wayfinder 3.5) review DTOs, as returned by the moderator GETs.
type OperatorClaimRow = {
  id: string;
  venueId: string;
  verificationState: "pending" | "verified" | "rejected" | "revoked";
  evidenceKind: "email-domain" | "phone" | "document";
  evidenceNote: string;
  createdAt: string;
};

type OperatorProposalRow = {
  id: string;
  venueId: string;
  type: "correction" | "event" | "offer" | "response";
  payload: { title?: string; body?: string; field?: string; startsAt?: string };
  status: "pending" | "accepted" | "declined";
  createdAt: string;
};

type ImportNoteRow = {
  id: string;
  body: string;
  venueId: string | null;
  venueName: string | null;
  provenance: "sourced" | "contributor";
  status: "queued" | "dismissed";
  createdAt: string;
  dismissedAt?: string;
};

type ModeratorSocialPost = {
  staffDisplayName: string;
  postId: string;
  mediaId: string | null;
  revision: number;
  authorHandle: string;
  body: string;
  photoAltText: string | null;
  area: string | null;
  venueId: string | null;
  visibility: "public" | "friends" | "private";
  commentPolicy: "open" | "friends" | "locked";
  moderationClaim: string;
  moderationState: "needs_review" | "approved";
  createdAt: string;
  updatedAt: string;
};

type SocialPostsState = "idle" | "loading" | "ready" | "unavailable";
type SocialPostAction = { postId: string; action: "approve" | "hide" };

function socialPostPolicyLabel(value: string): string {
  const words = value.replaceAll("_", " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function socialPostActionLabel(
  pending: SocialPostAction | null,
  postId: string,
  action: "approve" | "hide",
): string {
  if (pending?.postId === postId && pending.action === action) {
    return action === "approve" ? "Approving…" : "Hiding…";
  }
  return action === "approve" ? "Approve" : "Hide";
}

function SocialPostModerationQueue({
  posts,
  state,
  pendingAction,
  onDecision,
}: {
  posts: ModeratorSocialPost[];
  state: SocialPostsState;
  pendingAction: SocialPostAction | null;
  onDecision: (post: ModeratorSocialPost, action: "approve" | "hide") => void;
}) {
  return (
    <>
      <h2 className="admin-section">Social post moderation</h2>
      {state === "loading" ? (
        <div className="admin-empty" role="status">
          Loading Social posts awaiting review…
        </div>
      ) : state === "unavailable" ? (
        <div className="admin-empty" role="alert">
          Social post moderation is unavailable.
        </div>
      ) : posts.length === 0 && state === "ready" ? (
        <div className="admin-empty">
          <strong>No Social posts awaiting review</strong>
        </div>
      ) : state === "ready" ? (
        <div className="admin-list">
          {posts.map((post) => (
            <article className="admin-card" key={post.postId}>
              <div className="admin-card-head">
                <span className="admin-handle">@{post.authorHandle}</span>
                <span className="admin-report">Revision {post.revision}</span>
              </div>
              <p className="admin-note">{post.body}</p>
              {post.mediaId ? (
                <div className="admin-photos">
                  <Image
                    src={`/api/admin/social-posts/media/${post.mediaId}`}
                    alt={post.photoAltText ?? "Social post photo"}
                    width={160}
                    height={160}
                    unoptimized
                  />
                </div>
              ) : null}
              <div className="admin-meta">
                <span>Area: {post.area ?? "None"}</span>
                <span>Venue: {post.venueId ?? "None"}</span>
                <span>Visibility: {socialPostPolicyLabel(post.visibility)}</span>
                <span>Comments: {socialPostPolicyLabel(post.commentPolicy)}</span>
                <span>State: {socialPostPolicyLabel(post.moderationState)}</span>
              </div>
              <p className="admin-note">Reason: {post.moderationClaim}</p>
              <div className="admin-meta">
                <span>
                  Created: <time dateTime={post.createdAt}>{new Date(post.createdAt).toLocaleString()}</time>
                </span>
                <span>
                  Updated: <time dateTime={post.updatedAt}>{new Date(post.updatedAt).toLocaleString()}</time>
                </span>
              </div>
              <div className="admin-actions">
                <button
                  className="admin-btn admin-restore"
                  onClick={() => onDecision(post, "approve")}
                  disabled={pendingAction !== null}
                >
                  {socialPostActionLabel(pendingAction, post.postId, "approve")}
                </button>
                <button
                  className="admin-btn admin-keep"
                  onClick={() => onDecision(post, "hide")}
                  disabled={pendingAction !== null}
                >
                  {socialPostActionLabel(pendingAction, post.postId, "hide")}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </>
  );
}

const TOKEN_KEY = "pubmax_admin_token";
const SESSION_FETCH: RequestInit = { credentials: "include" };

function readStoredToken(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(TOKEN_KEY) ?? "";
}

// Both admin doors spend the same route, so both ask the same question: a 200
// from the POST is not a session, only a cookie the browser may have dropped.
async function establishSession(token: string): Promise<AdminSessionSubmitOutcome> {
  if (token) return submitAdminToken(token, browserFetch);
  const state = await readAdminSessionState(browserFetch);
  if (state === "authenticated") return { status: "open" };
  if (state === "anonymous") {
    return { status: "refused", message: ADMIN_SESSION_NOT_AUTHORISED_MESSAGE };
  }
  return { status: "refused", message: ADMIN_SESSION_UNCONFIRMED_MESSAGE };
}

// venueId → name, resolved from the same app dataset the map groups. Fetched
// once (in the load handler) rather than adding a DB dependency just for names.
async function fetchVenueNames(): Promise<Map<string, string>> {
  const res = await fetch("/data/pint_prices_app_dataset.json");
  if (!res.ok) {
    discardBody(res);
    return new Map();
  }
  const rows = (await res.json()) as VenuePrice[];
  return new Map(groupVenuePrices(rows).map((venue) => [venue.id, venue.name]));
}

export async function readQueueResponse<T extends object>(response: Response): Promise<T> {
  if (!response.ok) {
    discardBody(response);
    return {} as T;
  }
  return (await response.json()) as T;
}

async function loadProfileModerationQueues(): Promise<{
  reportedAvatars: ModeratorProfileAvatar[];
  hiddenAvatars: ModeratorProfileAvatar[];
  reportedCovers: ModeratorProfileCover[];
  hiddenCovers: ModeratorProfileCover[];
}> {
  const [reportedAvatarResponse, hiddenAvatarResponse, reportedCoverResponse, hiddenCoverResponse] =
    await Promise.all([
      fetch("/api/admin/profile-avatars?status=reported", SESSION_FETCH),
      fetch("/api/admin/profile-avatars?status=hidden", SESSION_FETCH),
      fetch("/api/admin/profile-avatars?status=reported&slot=cover", SESSION_FETCH),
      fetch("/api/admin/profile-avatars?status=hidden&slot=cover", SESSION_FETCH),
    ]);
  const [reportedAvatarBody, hiddenAvatarBody, reportedCoverBody, hiddenCoverBody] =
    await Promise.all([
      readQueueResponse<{ avatars?: ModeratorProfileAvatar[] }>(reportedAvatarResponse),
      readQueueResponse<{ avatars?: ModeratorProfileAvatar[] }>(hiddenAvatarResponse),
      readQueueResponse<{
        avatars?: ModeratorProfileAvatar[];
        rotationCovers?: ModeratorProfileCover[];
      }>(reportedCoverResponse),
      readQueueResponse<{
        avatars?: ModeratorProfileAvatar[];
        rotationCovers?: ModeratorProfileCover[];
      }>(hiddenCoverResponse),
    ]);
  const reportedCovers = [
    ...(reportedCoverBody.avatars ?? []).map(profileCoverFromAvatar),
    ...(reportedCoverBody.rotationCovers ?? []),
  ];
  const hiddenCovers = [
    ...(hiddenCoverBody.avatars ?? []).map(profileCoverFromAvatar),
    ...(hiddenCoverBody.rotationCovers ?? []),
  ];
  return {
    reportedAvatars: reportedAvatarBody.avatars ?? [],
    hiddenAvatars: hiddenAvatarBody.avatars ?? [],
    reportedCovers,
    hiddenCovers,
  };
}

export default function AdminClient() {
  // Lazy initialiser reads localStorage on first client render — no effect, so we
  // don't trip react-hooks/set-state-in-effect.
  const [token, setToken] = useState(readStoredToken);
  const [sessionEstablished, setSessionEstablished] = useState(false);
  const [tab, setTab] = useState<AdminTab>("moderation");
  const [reportedDrops, setReportedDrops] = useState<ModeratorDrop[]>([]);
  const [drops, setDrops] = useState<ModeratorDrop[]>([]);
  const [reportedCommunityPrices, setReportedCommunityPrices] = useState<
    ModeratorCommunityPrice[]
  >([]);
  const [hiddenCommunityPrices, setHiddenCommunityPrices] = useState<
    ModeratorCommunityPrice[]
  >([]);
  const [venueNames, setVenueNames] = useState<Map<string, string>>(new Map());
  const [comments, setComments] = useState<ModeratorComment[]>([]);
  const [visitReports, setVisitReports] = useState<ModeratorVisitReport[]>([]);
  const [hiddenVisitReports, setHiddenVisitReports] = useState<ModeratorVisitReport[]>([]);
  const [reportedPhotos, setReportedPhotos] = useState<ModeratorVenuePhoto[]>([]);
  const [hiddenPhotos, setHiddenPhotos] = useState<ModeratorVenuePhoto[]>([]);
  const [reportedAvatars, setReportedAvatars] = useState<ModeratorProfileAvatar[]>([]);
  const [hiddenAvatars, setHiddenAvatars] = useState<ModeratorProfileAvatar[]>([]);
  const [reportedCovers, setReportedCovers] = useState<ModeratorProfileCover[]>([]);
  const [hiddenCovers, setHiddenCovers] = useState<ModeratorProfileCover[]>([]);
  const [socialPosts, setSocialPosts] = useState<ModeratorSocialPost[]>([]);
  const [socialPostsState, setSocialPostsState] = useState<SocialPostsState>("idle");
  const [socialPostAction, setSocialPostAction] = useState<SocialPostAction | null>(null);
  const [message, setMessage] = useState<AdminNotice | null>(null);
  const [communityPriceMessage, setCommunityPriceMessage] = useState<AdminNotice | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [communityPriceLoading, setCommunityPriceLoading] = useState(false);
  const [communityPricePendingId, setCommunityPricePendingId] = useState<string | null>(null);

  // Import notes (Wave F3) — durable queue + dismiss/restore.
  const [importBody, setImportBody] = useState("");
  const [importVenueId, setImportVenueId] = useState("");
  const [importVenueName, setImportVenueName] = useState("");
  const [importProvenance, setImportProvenance] = useState<"sourced" | "contributor">(
    "sourced",
  );
  const [importPending, setImportPending] = useState(false);
  const [importMsg, setImportMsg] = useState<AdminNotice | null>(null);
  const [importNotes, setImportNotes] = useState<ImportNoteRow[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importShowDismissed, setImportShowDismissed] = useState(false);
  const [importActionId, setImportActionId] = useState<string | null>(null);

  // Operator rail (Wayfinder 3.5) — pending claims + proposals review.
  const [operatorClaims, setOperatorClaims] = useState<OperatorClaimRow[]>([]);
  const [operatorProposals, setOperatorProposals] = useState<OperatorProposalRow[]>([]);
  const [operatorLoading, setOperatorLoading] = useState(false);
  const [operatorMsg, setOperatorMsg] = useState<AdminNotice | null>(null);
  const [operatorActionId, setOperatorActionId] = useState<string | null>(null);

  const ensureAdminSession = useCallback(
    async (force = false): Promise<AdminSessionSubmitOutcome> => {
      const t = token.trim();
      if (typeof window !== "undefined") window.localStorage.setItem(TOKEN_KEY, t);
      if (sessionEstablished && !force) return { status: "open" };
      const outcome = await establishSession(t);
      setSessionEstablished(outcome.status === "open");
      return outcome;
    },
    [token, sessionEstablished],
  );

  const retryWithFreshSession = useCallback(async (request: () => Promise<Response>) => {
    const res = await request();
    if (res.status !== 403) return res;
    setSessionEstablished(false);
    if ((await ensureAdminSession(true)).status !== "open") return res;
    return request();
  }, [ensureAdminSession]);

  const loadImportNotes = useCallback(async (opts?: { includeDismissed?: boolean }) => {
    setImportLoading(true);
    setImportMsg(null);
    const showDismissed = opts?.includeDismissed ?? importShowDismissed;
    try {
      // Prefer the httpOnly session cookie (same as drop/comment moderation) —
      // never send the raw ADMIN_TOKEN as a request header from the browser.
      const session = await ensureAdminSession();
      if (session.status !== "open") {
        setImportNotes([]);
        setImportMsg(adminAlert(session.message));
        return;
      }
      const qs = showDismissed ? "?includeDismissed=1" : "";
      const res = await retryWithFreshSession(() =>
        fetch(`/api/admin/import-notes${qs}`, SESSION_FETCH),
      );
      if (res.status === 403) {
        discardBody(res);
        setImportNotes([]);
        setImportMsg(adminAlert("Not authorised. Check the admin token."));
        return;
      }
      if (!res.ok) {
        discardBody(res);
        setImportNotes([]);
        setImportMsg(adminAlert("Could not load import notes."));
        return;
      }
      const body = (await res.json()) as { notes?: ImportNoteRow[] };
      setImportNotes(body.notes ?? []);
    } catch {
      setImportNotes([]);
      setImportMsg(adminAlert("Could not reach the server."));
    } finally {
      setImportLoading(false);
    }
  }, [ensureAdminSession, importShowDismissed, retryWithFreshSession]);

  const loadCommunityPriceQueues = useCallback(
    async (authenticatedSession?: AdminSessionSubmitOutcome): Promise<ModeratorCommunityPrice[] | null> => {
      setCommunityPriceLoading(true);
      setCommunityPriceMessage(null);
      try {
        const session = authenticatedSession ?? (await ensureAdminSession());
        if (session.status !== "open") {
          setCommunityPriceMessage(adminAlert(session.message));
          return null;
        }

        const res = await retryWithFreshSession(() =>
          fetch("/api/admin/community-prices", SESSION_FETCH),
        );
        if (res.status === 403) {
          discardBody(res);
          setCommunityPriceMessage(adminAlert("Not authorised. Check the admin token."));
          return null;
        }
        if (!res.ok) {
          discardBody(res);
          setCommunityPriceMessage(adminAlert("Could not load community prices."));
          return null;
        }

        const body = (await res.json()) as {
          prices?: ModeratorCommunityPrice[];
          degraded?: boolean;
        };
        if (body.degraded) {
          setCommunityPriceMessage(adminAlert("Could not load community prices."));
          return null;
        }
        const prices = Array.isArray(body.prices) ? body.prices : [];
        setReportedCommunityPrices(prices.filter((price) => !price.hidden));
        setHiddenCommunityPrices(prices.filter((price) => price.hidden));
        return prices;
      } catch {
        setCommunityPriceMessage(adminAlert("Could not reach the server."));
        return null;
      } finally {
        setCommunityPriceLoading(false);
      }
    },
    [ensureAdminSession, retryWithFreshSession],
  );

  const loadSocialPosts = useCallback(
    async (authenticatedSession: AdminSessionSubmitOutcome) => {
      setSocialPostsState("loading");
      setSocialPosts([]);
      if (authenticatedSession.status !== "open") {
        setSocialPostsState("unavailable");
        return;
      }
      try {
        const response = await retryWithFreshSession(() =>
          fetch("/api/admin/social-posts", SESSION_FETCH),
        );
        if (!response.ok) {
          discardBody(response);
          setSocialPostsState("unavailable");
          return;
        }
        const body = (await response.json()) as { posts?: unknown };
        if (!Array.isArray(body.posts)) {
          setSocialPostsState("unavailable");
          return;
        }
        setSocialPosts(body.posts as ModeratorSocialPost[]);
        setSocialPostsState("ready");
      } catch {
        setSocialPostsState("unavailable");
      }
    },
    [retryWithFreshSession],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const session = await ensureAdminSession();
      if (session.status !== "open") {
        setReportedDrops([]);
        setDrops([]);
        setComments([]);
        setSocialPosts([]);
        setSocialPostsState("unavailable");
        setMessage(adminAlert(session.message));
        return;
      }

      void loadSocialPosts(session);

      // Community observations have their own reversible queues. Load them in
      // this pass, but keep their failures isolated from Pint Drops and the
      // other moderation lanes.
      const communityPrices = await loadCommunityPriceQueues(session);
      if (communityPrices && communityPrices.length > 0 && venueNames.size === 0) {
        try {
          setVenueNames(await fetchVenueNames());
        } catch {
          /* names stay unresolved; rows fall back to the venueId */
        }
      }

      const [reportedRes, hiddenRes] = await Promise.all([
        fetch("/api/pint-drops?status=reported", SESSION_FETCH),
        fetch("/api/pint-drops?status=hidden", SESSION_FETCH),
      ]);
      if (reportedRes.status === 403 || hiddenRes.status === 403) {
        discardBody(reportedRes);
        discardBody(hiddenRes);
        setReportedDrops([]);
        setDrops([]);
        setMessage(adminAlert("Not authorised. Check the admin token."));
        return;
      }
      if (!reportedRes.ok || !hiddenRes.ok) {
        discardBody(reportedRes);
        discardBody(hiddenRes);
        setReportedDrops([]);
        setDrops([]);
        setMessage(adminAlert("Could not load reported drops."));
        return;
      }
      const reportedBody = (await reportedRes.json()) as { drops: ModeratorDrop[] };
      const hiddenBody = (await hiddenRes.json()) as { drops: ModeratorDrop[] };
      const reported = reportedBody.drops ?? [];
      const hidden = hiddenBody.drops ?? [];
      setReportedDrops(reported);
      setDrops(hidden);
      // Resolve venue names lazily alongside the queue — best-effort, so a
      // dataset fetch failure never blocks moderation.
      if (reported.length + hidden.length > 0 && venueNames.size === 0) {
        try {
          setVenueNames(await fetchVenueNames());
        } catch {
          /* names stay unresolved; rows fall back to the venueId */
        }
      }
      // Also load the hidden-comment queue (story 37) with the same session, in the
      // same pass. Best-effort — a comments failure never blocks drop moderation.
      try {
        const cRes = await fetch("/api/admin/comments?status=hidden", SESSION_FETCH);
        if (cRes.ok) {
          const cBody = (await cRes.json()) as { comments: ModeratorComment[] };
          setComments(cBody.comments ?? []);
        } else {
          setComments([]);
        }
      } catch {
        setComments([]);
      }
      // Load both Visit Report lanes in the same pass: the reported queue and
      // the already-hidden rows (a hide has to stay reversible from here).
      // Best-effort — a failure never blocks drop/comment moderation.
      try {
        const [vRes, hRes] = await Promise.all([
          fetch("/api/visit-reports?status=reported", SESSION_FETCH),
          fetch("/api/visit-reports?status=hidden", SESSION_FETCH),
        ]);
        const reported = vRes.ok
          ? ((await vRes.json()) as { reports: ModeratorVisitReport[] }).reports ?? []
          : [];
        const hidden = hRes.ok
          ? ((await hRes.json()) as { reports: ModeratorVisitReport[] }).reports ?? []
          : [];
        setVisitReports(reported);
        setHiddenVisitReports(hidden);
        if (reported.length + hidden.length > 0 && venueNames.size === 0) {
          try {
            setVenueNames(await fetchVenueNames());
          } catch {
            /* names stay unresolved; rows fall back to the venueId */
          }
        }
      } catch {
        setVisitReports([]);
        setHiddenVisitReports([]);
      }
      // Both pub photo wall lanes, same pass and same shape: a flag reaches a
      // human here or it reaches nobody, and a hide has to stay reversible.
      try {
        const [pRes, phRes] = await Promise.all([
          fetch("/api/venue-photos?status=reported", SESSION_FETCH),
          fetch("/api/venue-photos?status=hidden", SESSION_FETCH),
        ]);
        setReportedPhotos(
          pRes.ok
            ? ((await pRes.json()) as { photos: ModeratorVenuePhoto[] }).photos ?? []
            : [],
        );
        setHiddenPhotos(
          phRes.ok
            ? ((await phRes.json()) as { photos: ModeratorVenuePhoto[] }).photos ?? []
            : [],
        );
      } catch {
        setReportedPhotos([]);
        setHiddenPhotos([]);
      }
      // Load both owned-avatar lanes in the same pass: reported queue and
      // already-hidden rows (a hide has to stay reversible from here).
      try {
        const queues = await loadProfileModerationQueues();
        setReportedAvatars(queues.reportedAvatars);
        setHiddenAvatars(queues.hiddenAvatars);
        setReportedCovers(queues.reportedCovers);
        setHiddenCovers(queues.hiddenCovers);
      } catch {
        setReportedAvatars([]);
        setHiddenAvatars([]);
        setReportedCovers([]);
        setHiddenCovers([]);
      }
      if (reported.length + hidden.length === 0) {
        setMessage(adminStatus("No reported drops in the queue."));
      }
    } catch {
      setReportedDrops([]);
      setDrops([]);
      setMessage(adminAlert("Could not reach the server."));
    } finally {
      setLoading(false);
    }
  }, [ensureAdminSession, loadCommunityPriceQueues, loadSocialPosts, venueNames.size]);

  const decideSocialPost = useCallback(
    async (post: ModeratorSocialPost, action: "approve" | "hide") => {
      setSocialPostAction({ postId: post.postId, action });
      setMessage(null);
      try {
        const res = await retryWithFreshSession(() =>
          fetch("/api/admin/social-posts", {
            ...SESSION_FETCH,
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              postId: post.postId,
              mediaId: post.mediaId,
              expectedRevision: post.revision,
              action,
            }),
          }),
        );
        if (res.status === 403) {
          discardBody(res);
          setMessage(adminAlert("Not authorised. Check the admin token."));
          return;
        }
        if (res.status === 409) {
          discardBody(res);
          setSocialPosts((current) => current.filter((item) => item.postId !== post.postId));
          setMessage(adminAlert("Post changed. Reload queue."));
          return;
        }
        if (!res.ok) {
          discardBody(res);
          setMessage(adminAlert("Social post action failed. Try again."));
          return;
        }
        setSocialPosts((current) => current.filter((item) => item.postId !== post.postId));
        setMessage(adminStatus(action === "approve" ? "Social post approved." : "Social post hidden."));
      } catch {
        setMessage(adminAlert("Could not reach the server."));
      } finally {
        setSocialPostAction(null);
      }
    },
    [retryWithFreshSession],
  );

  const decideComment = useCallback(async (id: string, action: "restore" | "keep_hidden") => {
    setPendingId(id);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/comments", {
        ...SESSION_FETCH,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, id }),
      });
      if (res.status === 403) {
        discardBody(res);
        setMessage(adminAlert("Not authorised. Check the admin token."));
        return;
      }
      if (!res.ok) {
        discardBody(res);
        setMessage(adminAlert("Action failed. Try again."));
        return;
      }
      // Decided comments leave the hidden queue either way.
      setComments((current) => current.filter((c) => c.id !== id));
      setMessage(adminStatus(action === "restore" ? "Comment restored." : "Comment kept hidden."));
    } catch {
      setMessage(adminAlert("Could not reach the server."));
    } finally {
      setPendingId(null);
    }
  }, []);

  // A decision moves the row between the two Visit Report lanes rather than
  // dropping it: a hide lands in the hidden lane so it can be put straight back,
  // and a restore returns it to public reads and leaves both lanes.
  const decideVisitReport = useCallback(
    async (report: ModeratorVisitReport, action: "restore" | "hide", lane: "reported" | "hidden") => {
      setPendingId(report.id);
      setMessage(null);
      try {
        const res = await fetch("/api/visit-reports", {
          ...SESSION_FETCH,
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, id: report.id }),
        });
        if (res.status === 403) {
          discardBody(res);
          setMessage(adminAlert("Not authorised. Check the admin token."));
          return;
        }
        if (!res.ok) {
          discardBody(res);
          setMessage(adminAlert("Action failed. Try again."));
          return;
        }
        setVisitReports((current) => current.filter((v) => v.id !== report.id));
        setHiddenVisitReports((current) => {
          const without = current.filter((v) => v.id !== report.id);
          return action === "hide" ? [report, ...without] : without;
        });
        setMessage(
          adminStatus(
            action === "hide"
              ? "Visit report hidden."
              : lane === "hidden"
                ? "Visit report restored."
                : "Visit report kept visible.",
          ),
        );
      } catch {
        setMessage(adminAlert("Could not reach the server."));
      } finally {
        setPendingId(null);
      }
    },
    [],
  );

  // Same two-lane shape for wall photos. Hiding takes the photo off the wall,
  // the pages and the author's cap count together, and never deletes the row,
  // its bytes or its report trail - so restore is a real way back.
  const decideVenuePhoto = useCallback(
    async (photo: ModeratorVenuePhoto, action: "restore" | "hide", lane: "reported" | "hidden") => {
      setPendingId(photo.id);
      setMessage(null);
      try {
        const res = await fetch("/api/venue-photos", {
          ...SESSION_FETCH,
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, id: photo.id }),
        });
        if (res.status === 403) {
          discardBody(res);
          setMessage(adminAlert("Not authorised. Check the admin token."));
          return;
        }
        if (!res.ok) {
          discardBody(res);
          setMessage(adminAlert("Action failed. Try again."));
          return;
        }
        setReportedPhotos((current) => current.filter((p) => p.id !== photo.id));
        setHiddenPhotos((current) => {
          const without = current.filter((p) => p.id !== photo.id);
          return action === "hide" ? [photo, ...without] : without;
        });
        setMessage(
          adminStatus(
            action === "hide"
              ? "Photo hidden."
              : lane === "hidden"
                ? "Photo restored to the wall."
                : "Photo kept on the wall.",
          ),
        );
      } catch {
        setMessage(adminAlert("Could not reach the server."));
      } finally {
        setPendingId(null);
      }
    },
    [],
  );

  // Same two-lane shape for owned profile avatars: hide lands in the hidden
  // lane so it can go straight back; keep-visible / restore leave the queues.
  const decideProfileAvatar = useCallback(
    async (
      avatar: ModeratorProfileAvatar,
      action: "restore" | "hide",
      lane: "reported" | "hidden",
    ) => {
      setPendingId(avatar.profileId);
      setMessage(null);
      try {
        const res = await fetch("/api/admin/profile-avatars", {
          ...SESSION_FETCH,
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, handle: avatar.handle }),
        });
        if (res.status === 403) {
          discardBody(res);
          setMessage(adminAlert("Not authorised. Check the admin token."));
          return;
        }
        if (!res.ok) {
          discardBody(res);
          setMessage(adminAlert("Action failed. Try again."));
          return;
        }
        setReportedAvatars((current) => current.filter((a) => a.handle !== avatar.handle));
        setHiddenAvatars((current) => {
          const without = current.filter((a) => a.handle !== avatar.handle);
          return action === "hide"
            ? [{ ...avatar, moderationState: "hidden" }, ...without]
            : without;
        });
        setMessage(
          adminStatus(
            action === "hide"
              ? "Profile picture hidden."
              : lane === "hidden"
                ? "Profile picture restored."
                : "Profile picture kept visible.",
          ),
        );
      } catch {
        setMessage(adminAlert("Could not reach the server."));
      } finally {
        setPendingId(null);
      }
    },
    [],
  );

  const decideProfileCover = useCallback(
    async (
      cover: ModeratorProfileCover,
      action: "restore" | "hide",
      lane: "reported" | "hidden",
    ) => {
      setPendingId(cover.id);
      setMessage(null);
      try {
        const res = await fetch("/api/admin/profile-avatars", {
          ...SESSION_FETCH,
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action,
            handle: cover.handle,
            slot: "cover",
            ...(cover.rotationOnly ? { coverId: cover.id } : {}),
          }),
        });
        if (res.status === 403) {
          discardBody(res);
          setMessage(adminAlert("Not authorised. Check the admin token."));
          return;
        }
        if (!res.ok) {
          discardBody(res);
          setMessage(adminAlert("Action failed. Try again."));
          return;
        }
        setReportedCovers((current) => current.filter((row) => row.id !== cover.id));
        setHiddenCovers((current) => {
          const without = current.filter((row) => row.id !== cover.id);
          return action === "hide"
            ? [{ ...cover, moderationState: "hidden" }, ...without]
            : without;
        });
        setMessage(
          adminStatus(
            action === "hide"
              ? "Cover photo hidden."
              : lane === "hidden"
                ? "Cover photo restored."
                : "Cover photo kept visible.",
          ),
        );
      } catch {
        setMessage(adminAlert("Could not reach the server."));
      } finally {
        setPendingId(null);
      }
    },
    [],
  );

  const decide = useCallback(async (id: string, action: "restore" | "keep_hidden") => {
    setPendingId(id);
    setMessage(null);
    try {
      const res = await fetch("/api/pint-drops", {
        ...SESSION_FETCH,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, id }),
      });
      if (res.status === 403) {
        discardBody(res);
        setMessage(adminAlert("Not authorised. Check the admin token."));
        return;
      }
      if (!res.ok) {
        discardBody(res);
        setMessage(adminAlert("Action failed. Try again."));
        return;
      }
      // Decided drops leave the queue either way (restore → visible,
      // keep_hidden → reviewed), so drop them from the list.
      setReportedDrops((current) => current.filter((d) => d.id !== id));
      setDrops((current) => current.filter((d) => d.id !== id));
      setMessage(adminStatus(action === "restore" ? "Pint Drop restored." : "Pint Drop kept hidden."));
    } catch {
      setMessage(adminAlert("Could not reach the server."));
    } finally {
      setPendingId(null);
    }
  }, []);

  const decideCommunityPrice = useCallback(
    async (row: ModeratorCommunityPrice, action: "hide" | "restore" | "reconcile") => {
      setCommunityPricePendingId(row.id);
      setCommunityPriceMessage(null);
      try {
        const res = await retryWithFreshSession(() =>
          fetch("/api/admin/community-prices", {
            ...SESSION_FETCH,
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action, id: row.id }),
          }),
        );
        if (res.status === 403) {
          discardBody(res);
          setCommunityPriceMessage(adminAlert("Not authorised. Check the admin token."));
          return;
        }
        if (!res.ok) {
          const payload = await readApiJson(res);
          discardBody(res);
          setCommunityPriceMessage(
            adminAlert(errorMessageFrom(payload, "Action failed. Try again.")),
          );
          return;
        }
        discardBody(res);

        if (action === "reconcile") {
          const refreshed = await loadCommunityPriceQueues();
          setCommunityPriceMessage(
            refreshed === null
              ? adminAlert("Price trust updated. Refresh unavailable. Reload to confirm.")
              : adminStatus("Price trust updated."),
          );
          return;
        }

        // Refresh only this queue. Pint Drops, Visit Reports and other admin
        // lanes keep their current state while the observation moves.
        const nextReported = action === "restore" ? { ...row, hidden: false } : null;
        const nextHidden = action === "hide" ? { ...row, hidden: true } : null;
        setReportedCommunityPrices((current) =>
          action === "restore"
            ? [nextReported!, ...current.filter((item) => item.id !== row.id)]
            : current.filter((item) => item.id !== row.id),
        );
        setHiddenCommunityPrices((current) =>
          action === "hide"
            ? [nextHidden!, ...current.filter((item) => item.id !== row.id)]
            : current.filter((item) => item.id !== row.id),
        );
        const refreshed = await loadCommunityPriceQueues();
        setCommunityPriceMessage(
          refreshed === null
            ? adminAlert(
                `${action === "hide" ? "Community observation hidden" : "Community observation restored"}. Refresh unavailable. Reload to confirm.`,
              )
            : adminStatus(
                action === "hide"
                  ? "Community observation hidden."
                  : "Community observation restored.",
              ),
        );
      } catch {
        setCommunityPriceMessage(adminAlert("Could not reach the server."));
      } finally {
        setCommunityPricePendingId(null);
      }
    },
    [loadCommunityPriceQueues, retryWithFreshSession],
  );

  async function submitImportNote() {
    setImportPending(true);
    setImportMsg(null);
    try {
      const session = await ensureAdminSession();
      if (session.status !== "open") {
        setImportMsg(adminAlert(session.message));
        return;
      }
      const res = await retryWithFreshSession(() =>
        fetch("/api/admin/import-notes", {
          ...SESSION_FETCH,
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            body: importBody,
            venueId: importVenueId.trim() || undefined,
            venueName: importVenueName.trim() || undefined,
            provenance: importProvenance,
          }),
        }),
      );
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (res.status === 403) {
        setImportMsg(adminAlert("Not authorised. Check the admin token."));
        return;
      }
      if (!res.ok) {
        setImportMsg(adminAlert(errorMessageFrom(payload, "Could not queue the note.")));
        return;
      }
      setImportMsg(adminStatus(payload.message ?? "Queued for review"));
      setImportBody("");
      setImportVenueId("");
      setImportVenueName("");
      await loadImportNotes();
    } catch {
      setImportMsg(adminAlert("Could not reach the server."));
    } finally {
      setImportPending(false);
    }
  }

  async function decideImportNote(id: string, action: "dismiss" | "restore") {
    setImportActionId(id);
    setImportMsg(null);
    try {
      const session = await ensureAdminSession();
      if (session.status !== "open") {
        setImportMsg(adminAlert(session.message));
        return;
      }
      const res = await retryWithFreshSession(() =>
        fetch("/api/admin/import-notes", {
          ...SESSION_FETCH,
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, action }),
        }),
      );
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (res.status === 403) {
        setImportMsg(adminAlert("Not authorised. Check the admin token."));
        return;
      }
      if (!res.ok) {
        setImportMsg(adminAlert(errorMessageFrom(payload, "Action failed. Try again.")));
        return;
      }
      setImportMsg(adminStatus(payload.message ?? (action === "dismiss" ? "Note dismissed." : "Note restored.")));
      await loadImportNotes();
    } catch {
      setImportMsg(adminAlert("Could not reach the server."));
    } finally {
      setImportActionId(null);
    }
  }

  // ── Operator rail review (Wayfinder 3.5) ─────────────────────────────────────
  const loadOperators = useCallback(async () => {
    setOperatorLoading(true);
    setOperatorMsg(null);
    try {
      const session = await ensureAdminSession();
      if (session.status !== "open") {
        setOperatorClaims([]);
        setOperatorProposals([]);
        setOperatorMsg(adminAlert(session.message));
        return;
      }
      const [claimsRes, proposalsRes] = await Promise.all([
        retryWithFreshSession(() =>
          fetch("/api/venue-operators/claim?state=pending", SESSION_FETCH),
        ),
        retryWithFreshSession(() =>
          fetch("/api/operator-proposals?status=pending", SESSION_FETCH),
        ),
      ]);
      if (claimsRes.status === 403 || proposalsRes.status === 403) {
        setOperatorClaims([]);
        setOperatorProposals([]);
        setOperatorMsg(adminAlert("Not authorised. Check the admin token."));
        return;
      }
      setOperatorClaims(
        claimsRes.ok ? ((await claimsRes.json()) as { claims?: OperatorClaimRow[] }).claims ?? [] : [],
      );
      setOperatorProposals(
        proposalsRes.ok
          ? ((await proposalsRes.json()) as { proposals?: OperatorProposalRow[] }).proposals ?? []
          : [],
      );
    } catch {
      setOperatorClaims([]);
      setOperatorProposals([]);
      setOperatorMsg(adminAlert("Could not reach the server."));
    } finally {
      setOperatorLoading(false);
    }
  }, [ensureAdminSession, retryWithFreshSession]);

  const decideOperatorClaim = useCallback(
    async (id: string, action: "verify" | "reject" | "revoke") => {
      setOperatorActionId(id);
      setOperatorMsg(null);
      try {
        const res = await retryWithFreshSession(() =>
          fetch("/api/venue-operators/claim", {
            ...SESSION_FETCH,
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action, id }),
          }),
        );
        if (res.status === 403) {
          discardBody(res);
          setOperatorMsg(adminAlert("Not authorised. Check the admin token."));
          return;
        }
        if (!res.ok) {
          discardBody(res);
          setOperatorMsg(adminAlert("Action failed. Try again."));
          return;
        }
        setOperatorClaims((current) => current.filter((c) => c.id !== id));
        setOperatorMsg(adminStatus(`Claim ${action === "verify" ? "approved" : action === "reject" ? "rejected" : "revoked"}.`));
      } catch {
        setOperatorMsg(adminAlert("Could not reach the server."));
      } finally {
        setOperatorActionId(null);
      }
    },
    [retryWithFreshSession],
  );

  const decideOperatorProposal = useCallback(
    async (id: string, action: "accept" | "decline") => {
      setOperatorActionId(id);
      setOperatorMsg(null);
      try {
        const res = await retryWithFreshSession(() =>
          fetch("/api/operator-proposals", {
            ...SESSION_FETCH,
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action, id }),
          }),
        );
        if (res.status === 403) {
          discardBody(res);
          setOperatorMsg(adminAlert("Not authorised. Check the admin token."));
          return;
        }
        if (!res.ok) {
          discardBody(res);
          setOperatorMsg(adminAlert("Action failed. Try again."));
          return;
        }
        setOperatorProposals((current) => current.filter((p) => p.id !== id));
        setOperatorMsg(adminStatus(action === "accept" ? "Proposal accepted." : "Proposal declined."));
      } catch {
        setOperatorMsg(adminAlert("Could not reach the server."));
      } finally {
        setOperatorActionId(null);
      }
    },
    [retryWithFreshSession],
  );

  return (
    <main id="main" className="admin">
      <SiteNav />

      <h1>Admin</h1>
      <p className="admin-sub">
        Review reports, claims and notes before publication.
      </p>
      <Link className="adminMapCallout" href="/map">
        Back to the map
      </Link>

      <div className="admin-tabs" role="tablist" aria-label="Admin sections">
        <button
          type="button"
          role="tab"
          className={tab === "moderation" ? "admin-tab active" : "admin-tab"}
          aria-selected={tab === "moderation"}
          onClick={() => setTab("moderation")}
        >
          Moderation
        </button>
        <button
          type="button"
          role="tab"
          className={tab === "import" ? "admin-tab active" : "admin-tab"}
          aria-selected={tab === "import"}
          onClick={() => {
            setTab("import");
            void loadImportNotes();
          }}
        >
          Import note
        </button>
        <button
          type="button"
          role="tab"
          className={tab === "operators" ? "admin-tab active" : "admin-tab"}
          aria-selected={tab === "operators"}
          onClick={() => {
            setTab("operators");
            void loadOperators();
          }}
        >
          Operators
        </button>
      </div>

      <div className="admin-bar">
        <input
          type="password"
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
            setSessionEstablished(false);
          }}
          placeholder="Admin token"
          aria-label="Admin token"
        />
        {tab === "moderation" ? (
          <button className="admin-btn" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Load reported drops"}
          </button>
        ) : null}
      </div>

      {tab === "moderation" ? (
        <>
          {message ? (
            <div className="admin-msg" role={message.tone}>
              {message.text}
            </div>
          ) : null}

          <h2 className="admin-section" style={{ marginTop: 0, borderTop: "none", paddingTop: 0 }}>
            Pint Drop moderation
          </h2>
          <p className="admin-sub">
            Review reported community drops. Restore the good, keep the rest hidden.
          </p>

          {reportedDrops.length === 0 && drops.length === 0 ? (
            <div className="admin-empty">
              <strong>Queue clear</strong>
              <span>
                Reported Pint Drops will appear here when a moderator review is needed.
              </span>
              <Link href="/map">Open the map</Link>
            </div>
          ) : null}

          {reportedDrops.length > 0 ? (
            <>
              <h3 className="admin-section">Reported Pint Drops</h3>
              <div className="admin-list">
              {reportedDrops.map((d) => (
                <article className="admin-card" key={d.id}>
                  <div className="admin-card-head">
                    <span className="admin-handle">{d.handle}</span>
                    {d.priceGbp != null ? (
                      <span className="admin-price">£{d.priceGbp.toFixed(2)}</span>
                    ) : null}
                  </div>

                  <div className="admin-venue">
                    <span className="admin-venue-name">
                      {venueNames.get(d.venueId) ?? d.venueId}
                    </span>
                    <Link className="admin-venue-link" href={venueMapUrl(d.venueId)}>
                      View on map
                    </Link>
                  </div>

                  {d.passedDownNote ? <p className="admin-note">{d.passedDownNote}</p> : null}

                  <div className="admin-meta">
                    {d.era ? <span>Era: {d.era}</span> : null}
                    {d.reportReason ? (
                      <span className="admin-report">Reason: {d.reportReason}</span>
                    ) : null}
                    <span className="admin-report">
                      Verified reports: {moderatorReportEvidence(d.reportCount, d.reportedAt).verifiedCount}
                    </span>
                    {moderatorReportEvidence(d.reportCount, d.reportedAt).hasEvidence ? (
                      <span className="admin-report">Report evidence received</span>
                    ) : null}
                    {d.reportedAt ? (
                      <span>Reported: {new Date(d.reportedAt).toLocaleString()}</span>
                    ) : null}
                  </div>

                  {d.pintPhotoUrl || d.venuePhotoUrl ? (
                    <div className="admin-photos">
                      {d.pintPhotoUrl ? (
                        <Image
                          src={d.pintPhotoUrl}
                          alt={`Pint photo reported from ${d.handle}`}
                          width={96}
                          height={96}
                          unoptimized
                        />
                      ) : null}
                      {d.venuePhotoUrl ? (
                        <Image
                          src={d.venuePhotoUrl}
                          alt={`Venue photo reported from ${d.handle}`}
                          width={96}
                          height={96}
                          unoptimized
                        />
                      ) : null}
                    </div>
                  ) : null}

                  <div className="admin-actions">
                    <button
                      className="admin-btn admin-restore"
                      onClick={() => decide(d.id, "restore")}
                      disabled={pendingId === d.id}
                    >
                      {pendingId === d.id ? "Working…" : "Keep visible"}
                    </button>
                    <button
                      className="admin-btn admin-keep"
                      onClick={() => decide(d.id, "keep_hidden")}
                      disabled={pendingId === d.id}
                    >
                      {pendingId === d.id ? "Working…" : "Hide"}
                    </button>
                  </div>
                </article>
              ))}
              </div>
            </>
          ) : null}

          {drops.length > 0 ? (
            <>
              <h3 className="admin-section">Hidden Pint Drops</h3>
            <div className="admin-list">
              {drops.map((d) => (
                <article className="admin-card" key={d.id}>
                  <div className="admin-card-head">
                    <span className="admin-handle">{d.handle}</span>
                    {d.priceGbp != null ? (
                      <span className="admin-price">£{d.priceGbp.toFixed(2)}</span>
                    ) : null}
                  </div>

                  <div className="admin-venue">
                    <span className="admin-venue-name">
                      {venueNames.get(d.venueId) ?? d.venueId}
                    </span>
                    <Link
                      className="admin-venue-link"
                      href={venueMapUrl(d.venueId)}
                    >
                      View on map
                    </Link>
                  </div>

                  {d.passedDownNote ? <p className="admin-note">{d.passedDownNote}</p> : null}

                  <div className="admin-meta">
                    {d.era ? <span>Era: {d.era}</span> : null}
                    {d.reportReason ? (
                      <span className="admin-report">Reason: {d.reportReason}</span>
                    ) : null}
                    <span className="admin-report">
                      Verified reports: {moderatorReportEvidence(d.reportCount, d.reportedAt).verifiedCount}
                    </span>
                    {moderatorReportEvidence(d.reportCount, d.reportedAt).hasEvidence ? (
                      <span className="admin-report">Report evidence received</span>
                    ) : null}
                    {d.reportedAt ? (
                      <span>Reported: {new Date(d.reportedAt).toLocaleString()}</span>
                    ) : null}
                  </div>

                  {d.pintPhotoUrl || d.venuePhotoUrl ? (
                    <div className="admin-photos">
                      {d.pintPhotoUrl ? (
                        <Image
                          src={d.pintPhotoUrl}
                          alt={`Pint photo reported from ${d.handle}`}
                          width={96}
                          height={96}
                          unoptimized
                        />
                      ) : null}
                      {d.venuePhotoUrl ? (
                        <Image
                          src={d.venuePhotoUrl}
                          alt={`Venue photo reported from ${d.handle}`}
                          width={96}
                          height={96}
                          unoptimized
                        />
                      ) : null}
                    </div>
                  ) : null}

                  <div className="admin-actions">
                    <button
                      className="admin-btn admin-restore"
                      onClick={() => decide(d.id, "restore")}
                      disabled={pendingId === d.id}
                    >
                      {pendingId === d.id ? "Working…" : "Restore"}
                    </button>
                    <button
                      className="admin-btn admin-keep"
                      onClick={() => decide(d.id, "keep_hidden")}
                      disabled={pendingId === d.id}
                    >
                      {pendingId === d.id ? "Working…" : "Keep hidden"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
            </>
          ) : null}

          <SocialPostModerationQueue
            posts={socialPosts}
            state={socialPostsState}
            pendingAction={socialPostAction}
            onDecision={(post, action) => void decideSocialPost(post, action)}
          />

          {/* ── Community observation moderation queue ─────────────────────── */}
          <h2 className="admin-section">Community Price moderation</h2>
          {communityPriceMessage ? (
            <div className="admin-msg" role={communityPriceMessage.tone}>
              {communityPriceMessage.text}
            </div>
          ) : null}
          {communityPriceLoading &&
          reportedCommunityPrices.length === 0 &&
          hiddenCommunityPrices.length === 0 ? (
            <div className="admin-empty" role="status">
              Loading community prices…
            </div>
          ) : null}

          <h3 className="admin-section">Reported Community Prices</h3>
          {reportedCommunityPrices.length === 0 ? (
            <div className="admin-empty">
              <strong>No reported community prices</strong>
            </div>
          ) : (
            <div className="admin-list">
              {reportedCommunityPrices.map((row) => (
                <article
                  className="admin-card"
                  data-community-price-id={row.id}
                  key={row.id}
                >
                  <div className="admin-card-head">
                    <span className="admin-handle">
                      {row.kind === "price" ? "Community price" : "Venue signal"}
                    </span>
                    {row.kind === "price" && row.priceGbp != null ? (
                      <span className="admin-price">£{row.priceGbp.toFixed(2)}</span>
                    ) : null}
                  </div>
                  <div className="admin-venue">
                    <span className="admin-venue-name">{venueNames.get(row.venueId) ?? row.venueId}</span>
                    <Link className="admin-venue-link" href={venueMapUrl(row.venueId)}>
                      View on map
                    </Link>
                  </div>
                  <div className="admin-meta">
                    <span>{communityObservationText(row)}</span>
                    <span>Reports: {row.reportCount}</span>
                    <span>Submitted: {new Date(row.submittedAt).toLocaleString()}</span>
                    {row.reportReason ? (
                      <span className="admin-report">Reason: {row.reportReason}</span>
                    ) : null}
                    {row.reportedAt ? (
                      <span>Reported: {new Date(row.reportedAt).toLocaleString()}</span>
                    ) : null}
                  </div>
                  <div className="admin-actions">
                    {row.kind === "price" ? (
                      <button
                        className="admin-btn admin-keep"
                        onClick={() => void decideCommunityPrice(row, "reconcile")}
                        disabled={communityPricePendingId !== null || communityPriceLoading}
                      >
                        {communityPricePendingId === row.id
                          ? "Working…"
                          : "Retry trust update"}
                      </button>
                    ) : null}
                    <button
                      className="admin-btn admin-keep"
                      onClick={() => void decideCommunityPrice(row, "hide")}
                      disabled={communityPricePendingId !== null || communityPriceLoading}
                    >
                      {communityPricePendingId === row.id ? "Working…" : "Hide"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          <h3 className="admin-section">Hidden Community Prices</h3>
          {hiddenCommunityPrices.length === 0 ? (
            <div className="admin-empty">
              <strong>No hidden community prices</strong>
            </div>
          ) : (
            <div className="admin-list">
              {hiddenCommunityPrices.map((row) => (
                <article
                  className="admin-card"
                  data-community-price-id={row.id}
                  key={row.id}
                >
                  <div className="admin-card-head">
                    <span className="admin-handle">
                      {row.kind === "price" ? "Community price" : "Venue signal"}
                    </span>
                    {row.kind === "price" && row.priceGbp != null ? (
                      <span className="admin-price">£{row.priceGbp.toFixed(2)}</span>
                    ) : null}
                  </div>
                  <div className="admin-venue">
                    <span className="admin-venue-name">{venueNames.get(row.venueId) ?? row.venueId}</span>
                    <Link className="admin-venue-link" href={venueMapUrl(row.venueId)}>
                      View on map
                    </Link>
                  </div>
                  <div className="admin-meta">
                    <span>{communityObservationText(row)}</span>
                    <span>Reports: {row.reportCount}</span>
                    <span>Submitted: {new Date(row.submittedAt).toLocaleString()}</span>
                    {row.reportReason ? (
                      <span className="admin-report">Reason: {row.reportReason}</span>
                    ) : null}
                    {row.reportedAt ? (
                      <span>Reported: {new Date(row.reportedAt).toLocaleString()}</span>
                    ) : null}
                  </div>
                  <div className="admin-actions">
                    {row.kind === "price" ? (
                      <button
                        className="admin-btn admin-keep"
                        onClick={() => void decideCommunityPrice(row, "reconcile")}
                        disabled={communityPricePendingId !== null || communityPriceLoading}
                      >
                        {communityPricePendingId === row.id
                          ? "Working…"
                          : "Retry trust update"}
                      </button>
                    ) : null}
                    <button
                      className="admin-btn admin-restore"
                      onClick={() => void decideCommunityPrice(row, "restore")}
                      disabled={communityPricePendingId !== null || communityPriceLoading}
                    >
                      {communityPricePendingId === row.id ? "Working…" : "Restore"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {/* ── Comment moderation queue (story 37) ─────────────────────────── */}
          <h2 className="admin-section">Hidden comments</h2>
          <p className="admin-sub">
            Review hidden Pint Drop comments. Restore the good, keep the rest hidden.
          </p>
          {comments.length === 0 ? (
            <div className="admin-empty">
              <strong>No hidden comments</strong>
              <span>Hidden or reported comments will appear here for review.</span>
            </div>
          ) : (
            <div className="admin-list">
              {comments.map((c) => (
                <article className="admin-card" key={c.id}>
                  <div className="admin-card-head">
                    <span className="admin-handle">{c.handle}</span>
                    <span className="admin-report">{c.status}</span>
                  </div>
                  <p className="admin-note">{c.body}</p>
                  <div className="admin-meta">
                    <Link
                      className="admin-venue-link"
                      href={`/map?drop=${encodeURIComponent(c.pintDropId)}`}
                    >
                      View the Pint Drop
                    </Link>
                    <span>Posted: {new Date(c.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="admin-actions">
                    <button
                      className="admin-btn admin-restore"
                      onClick={() => decideComment(c.id, "restore")}
                      disabled={pendingId === c.id}
                    >
                      {pendingId === c.id ? "Working…" : "Restore"}
                    </button>
                    <button
                      className="admin-btn admin-keep"
                      onClick={() => decideComment(c.id, "keep_hidden")}
                      disabled={pendingId === c.id}
                    >
                      {pendingId === c.id ? "Working…" : "Keep hidden"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {/* ── Visit report moderation queue (Wayfinder 3.4) ───────────────── */}
          <h2 className="admin-section">Reported visit reports</h2>
          <p className="admin-sub">
            Check reported visit accounts. Keep the good visible, hide the rest.
          </p>
          {visitReports.length === 0 ? (
            <div className="admin-empty">
              <strong>No reported visit reports</strong>
              <span>Visit accounts appear here after a reader reports one.</span>
            </div>
          ) : (
            <div className="admin-list">
              {visitReports.map((v) => (
                <article className="admin-card" key={v.id}>
                  <div className="admin-card-head">
                    <span className="admin-handle">{v.handle}</span>
                    <span className="admin-report">{v.visitedAt}</span>
                  </div>
                  <div className="admin-venue">
                    <span className="admin-venue-name">{venueNames.get(v.venueId) ?? v.venueId}</span>
                    <Link className="admin-venue-link" href={venueMapUrl(v.venueId)}>
                      View on map
                    </Link>
                  </div>
                  {v.note ? <p className="admin-note">{v.note}</p> : null}
                  <div className="admin-meta">
                    {v.busyness ? <span>Busyness: {v.busyness}</span> : null}
                    {v.noise ? <span>Noise: {v.noise}</span> : null}
                    {v.seating ? <span>Seating: {v.seating}</span> : null}
                    {v.serviceWait ? <span>Bar wait: {v.serviceWait}</span> : null}
                    {v.reportReason ? (
                      <span className="admin-report">Reason: {v.reportReason}</span>
                    ) : null}
                    <span className="admin-report">Reports: {v.reportCount ?? 1}</span>
                  </div>
                  <div className="admin-actions">
                    <button
                      className="admin-btn admin-restore"
                      onClick={() => decideVisitReport(v, "restore", "reported")}
                      disabled={pendingId === v.id}
                    >
                      {pendingId === v.id ? "Working…" : "Keep visible"}
                    </button>
                    <button
                      className="admin-btn admin-keep"
                      onClick={() => decideVisitReport(v, "hide", "reported")}
                      disabled={pendingId === v.id}
                    >
                      {pendingId === v.id ? "Working…" : "Hide"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {/* ── Hidden visit reports: a hide stays reversible from here ─────── */}
          <h2 className="admin-section">Hidden visit reports</h2>
          <p className="admin-sub">
            Visit accounts a moderator has hidden. Hiding never deletes one, so any
            of these can go back on the pub&apos;s page.
          </p>
          {hiddenVisitReports.length === 0 ? (
            <div className="admin-empty">
              <strong>No hidden visit reports</strong>
              <span>Accounts you hide from the queue above appear here.</span>
            </div>
          ) : (
            <div className="admin-list">
              {hiddenVisitReports.map((v) => (
                <article className="admin-card" key={v.id}>
                  <div className="admin-card-head">
                    <span className="admin-handle">{v.handle}</span>
                    <span className="admin-report">{v.visitedAt}</span>
                  </div>
                  <div className="admin-venue">
                    <span className="admin-venue-name">{venueNames.get(v.venueId) ?? v.venueId}</span>
                    <Link className="admin-venue-link" href={venueMapUrl(v.venueId)}>
                      View on map
                    </Link>
                  </div>
                  {v.note ? <p className="admin-note">{v.note}</p> : null}
                  <div className="admin-meta">
                    {v.busyness ? <span>Busyness: {v.busyness}</span> : null}
                    {v.noise ? <span>Noise: {v.noise}</span> : null}
                    {v.seating ? <span>Seating: {v.seating}</span> : null}
                    {v.serviceWait ? <span>Bar wait: {v.serviceWait}</span> : null}
                    {v.moderatedAt ? (
                      <span>Hidden: {new Date(v.moderatedAt).toLocaleString()}</span>
                    ) : null}
                    {v.moderatorNote ? (
                      <span className="admin-report">Note: {v.moderatorNote}</span>
                    ) : null}
                  </div>
                  <div className="admin-actions">
                    <button
                      className="admin-btn admin-restore"
                      onClick={() => decideVisitReport(v, "restore", "hidden")}
                      disabled={pendingId === v.id}
                    >
                      {pendingId === v.id ? "Working…" : "Restore"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {/* ── Pub photo wall queues ─────────────────────────────────────── */}
          <VenuePhotoModeration
            reported={reportedPhotos}
            hidden={hiddenPhotos}
            venueNames={venueNames}
            pendingId={pendingId}
            onDecide={decideVenuePhoto}
          />

          {/* ── Profile picture report queue (Social Launch WP4) ─────────────── */}
          <h2 className="admin-section">Reported profile pictures</h2>
          <p className="admin-sub">
            Check reported profile pictures. Keep the good visible, hide the rest.
            A report never hides a face on its own.
          </p>
          {reportedAvatars.length === 0 ? (
            <div className="admin-empty">
              <strong>No reported profile pictures</strong>
              <span>Faces appear here after a reader reports one.</span>
            </div>
          ) : (
            <div className="admin-list">
              {reportedAvatars.map((a) => (
                <article className="admin-card" key={a.profileId}>
                  <div className="admin-card-head">
                    <span className="admin-handle">{a.handle}</span>
                    {a.reportedAt ? (
                      <span className="admin-report">
                        Reported: {new Date(a.reportedAt).toLocaleString()}
                      </span>
                    ) : null}
                  </div>
                  {a.previewUrl ? (
                    <div className="admin-photos">
                      <Image
                        className="admin-photo"
                        src={a.previewUrl}
                        alt={`Profile picture for ${a.handle}`}
                        width={96}
                        height={96}
                        unoptimized
                      />
                    </div>
                  ) : null}
                  <div className="admin-meta">
                    {a.reportReason ? (
                      <span className="admin-report">Reason: {a.reportReason}</span>
                    ) : null}
                    <span className="admin-report">Reports: {a.reportCount || 1}</span>
                  </div>
                  <div className="admin-actions">
                    <button
                      className="admin-btn admin-restore"
                      onClick={() => decideProfileAvatar(a, "restore", "reported")}
                      disabled={pendingId === a.profileId}
                    >
                      {pendingId === a.profileId ? "Working…" : "Keep visible"}
                    </button>
                    <button
                      className="admin-btn admin-keep"
                      onClick={() => decideProfileAvatar(a, "hide", "reported")}
                      disabled={pendingId === a.profileId}
                    >
                      {pendingId === a.profileId ? "Working…" : "Hide"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          <h2 className="admin-section">Hidden profile pictures</h2>
          <p className="admin-sub">
            Profile pictures a moderator has hidden. Hiding never deletes one, so
            any of these can go back on the profile.
          </p>
          {hiddenAvatars.length === 0 ? (
            <div className="admin-empty">
              <strong>No hidden profile pictures</strong>
              <span>Faces you hide from the queue above appear here.</span>
            </div>
          ) : (
            <div className="admin-list">
              {hiddenAvatars.map((a) => (
                <article className="admin-card" key={a.profileId}>
                  <div className="admin-card-head">
                    <span className="admin-handle">{a.handle}</span>
                    {a.moderatedAt ? (
                      <span className="admin-report">
                        Hidden: {new Date(a.moderatedAt).toLocaleString()}
                      </span>
                    ) : null}
                  </div>
                  <div className="admin-meta">
                    {a.reportReason ? (
                      <span className="admin-report">Reason: {a.reportReason}</span>
                    ) : null}
                    <span className="admin-report">Reports: {a.reportCount || 0}</span>
                    {a.moderatorNote ? (
                      <span className="admin-report">Note: {a.moderatorNote}</span>
                    ) : null}
                  </div>
                  <div className="admin-actions">
                    <button
                      className="admin-btn admin-restore"
                      onClick={() => decideProfileAvatar(a, "restore", "hidden")}
                      disabled={pendingId === a.profileId}
                    >
                      {pendingId === a.profileId ? "Working…" : "Restore"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          <h2 className="admin-section">Reported cover photos</h2>
          <p className="admin-sub">
            Check reported photos in a profile rotation. Keep the good visible, hide the rest.
          </p>
          {reportedCovers.length === 0 ? (
            <div className="admin-empty">
              <strong>No reported cover photos</strong>
              <span>Rotation photos appear here after a reader reports one.</span>
            </div>
          ) : (
            <div className="admin-list">
              {reportedCovers.map((cover) => (
                <article className="admin-card" key={cover.id}>
                  <div className="admin-card-head">
                    <span className="admin-handle">{cover.handle}</span>
                    <span className="admin-report">Cover {cover.position}</span>
                  </div>
                  {cover.previewUrl ? (
                    <div className="admin-photos">
                      <Image
                        className="admin-photo"
                        src={cover.previewUrl}
                        alt={`Cover photo ${cover.position} for ${cover.handle}`}
                        width={160}
                        height={96}
                        unoptimized
                      />
                    </div>
                  ) : null}
                  <div className="admin-meta">
                    {cover.reportReason ? (
                      <span className="admin-report">Reason: {cover.reportReason}</span>
                    ) : null}
                    <span className="admin-report">Reports: {cover.reportCount || 1}</span>
                    {cover.reportedAt ? (
                      <span>Reported: {new Date(cover.reportedAt).toLocaleString()}</span>
                    ) : null}
                  </div>
                  <div className="admin-actions">
                    <button
                      className="admin-btn admin-restore"
                      onClick={() => decideProfileCover(cover, "restore", "reported")}
                      disabled={pendingId === cover.id}
                    >
                      {pendingId === cover.id ? "Working…" : "Keep visible"}
                    </button>
                    <button
                      className="admin-btn admin-keep"
                      onClick={() => decideProfileCover(cover, "hide", "reported")}
                      disabled={pendingId === cover.id}
                    >
                      {pendingId === cover.id ? "Working…" : "Hide"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          <h2 className="admin-section">Hidden cover photos</h2>
          <p className="admin-sub">
            Cover photos a moderator has hidden. Hiding never deletes one, so it can be restored.
          </p>
          {hiddenCovers.length === 0 ? (
            <div className="admin-empty">
              <strong>No hidden cover photos</strong>
              <span>Hidden rotation photos appear here after moderation.</span>
            </div>
          ) : (
            <div className="admin-list">
              {hiddenCovers.map((cover) => (
                <article className="admin-card" key={cover.id}>
                  <div className="admin-card-head">
                    <span className="admin-handle">{cover.handle}</span>
                    <span className="admin-report">Cover {cover.position}</span>
                  </div>
                  <div className="admin-meta">
                    {cover.reportReason ? (
                      <span className="admin-report">Reason: {cover.reportReason}</span>
                    ) : null}
                    <span className="admin-report">Reports: {cover.reportCount || 0}</span>
                    {cover.moderatedAt ? (
                      <span>Hidden: {new Date(cover.moderatedAt).toLocaleString()}</span>
                    ) : null}
                    {cover.moderatorNote ? (
                      <span className="admin-report">Note: {cover.moderatorNote}</span>
                    ) : null}
                  </div>
                  <div className="admin-actions">
                    <button
                      className="admin-btn admin-restore"
                      onClick={() => decideProfileCover(cover, "restore", "hidden")}
                      disabled={pendingId === cover.id}
                    >
                      {pendingId === cover.id ? "Working…" : "Restore"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      ) : tab === "import" ? (
        <>
          <h2 className="admin-section" style={{ marginTop: 0, borderTop: "none", paddingTop: 0 }}>
            Import note
          </h2>
          <p className="admin-sub">
            Queue a URL or research note for moderated review. Staff-entered only.
            No Reddit/X polling. Notes persist on disk when the server can write
            <code> .data/</code>.
          </p>

          {importMsg ? (
            <div className="admin-msg" role={importMsg.tone}>
              {importMsg.text}
            </div>
          ) : null}

          <form
            className="admin-import-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submitImportNote();
            }}
          >
            <label className="admin-field">
              <span>URL or note text</span>
              <textarea
                value={importBody}
                onChange={(e) => setImportBody(e.target.value)}
                rows={5}
                required
                placeholder="https://… or a short research note"
                aria-label="URL or note text"
              />
            </label>
            <label className="admin-field">
              <span>Venue id (optional)</span>
              <input
                type="text"
                value={importVenueId}
                onChange={(e) => setImportVenueId(e.target.value)}
                placeholder="venue-…"
                aria-label="Optional venue id"
              />
            </label>
            <label className="admin-field">
              <span>Venue name (optional)</span>
              <input
                type="text"
                value={importVenueName}
                onChange={(e) => setImportVenueName(e.target.value)}
                placeholder="The Example Arms"
                aria-label="Optional venue name"
              />
            </label>
            <label className="admin-field">
              <span>Source type</span>
              <select
                value={importProvenance}
                onChange={(e) =>
                  setImportProvenance(e.target.value as "sourced" | "contributor")
                }
                aria-label="Source type"
              >
                <option value="sourced">sourced</option>
                <option value="contributor">contributor</option>
              </select>
            </label>
            <button className="admin-btn" type="submit" disabled={importPending}>
              {importPending ? "Queuing…" : "Submit for review"}
            </button>
          </form>

          <div className="admin-import-queue">
            <div className="admin-import-queue-head">
              <h3 className="admin-section" style={{ marginTop: 28 }}>
                Review queue
              </h3>
              <div className="admin-import-queue-actions">
                <label className="admin-field admin-inline-check">
                  <input
                    type="checkbox"
                    checked={importShowDismissed}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setImportShowDismissed(checked);
                      void loadImportNotes({ includeDismissed: checked });
                    }}
                  />
                  <span>Show dismissed</span>
                </label>
                <button
                  type="button"
                  className="admin-btn"
                  onClick={() => void loadImportNotes()}
                  disabled={importLoading}
                >
                  {importLoading ? "Loading…" : "Refresh"}
                </button>
              </div>
            </div>
            {importNotes.length === 0 ? (
              <p className="admin-sub" role="status">
                {importLoading ? "Loading notes…" : "No notes in the queue."}
              </p>
            ) : (
              <ul className="admin-import-list">
                {importNotes.map((note) => (
                  <li key={note.id} className="admin-import-item">
                    <div className="admin-import-meta">
                      <span className={`admin-import-status admin-import-status-${note.status}`}>
                        {note.status}
                      </span>
                      <span className="admin-import-prov">{note.provenance}</span>
                      <time dateTime={note.createdAt}>
                        {new Date(note.createdAt).toLocaleString()}
                      </time>
                    </div>
                    <p className="admin-import-body">{note.body}</p>
                    {note.venueName || note.venueId ? (
                      <p className="admin-import-venue">
                        {note.venueName ?? "Venue"}
                        {note.venueId ? ` · ${note.venueId}` : ""}
                      </p>
                    ) : null}
                    <div className="admin-actions">
                      {note.status === "queued" ? (
                        <button
                          type="button"
                          className="admin-btn admin-keep"
                          onClick={() => void decideImportNote(note.id, "dismiss")}
                          disabled={importActionId === note.id}
                        >
                          {importActionId === note.id ? "Working…" : "Dismiss"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="admin-btn admin-restore"
                          onClick={() => void decideImportNote(note.id, "restore")}
                          disabled={importActionId === note.id}
                        >
                          {importActionId === note.id ? "Working…" : "Restore"}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : (
        <>
          <h2 className="admin-section" style={{ marginTop: 0, borderTop: "none", paddingTop: 0 }}>
            Operator rail
          </h2>
          <p className="admin-sub">
            Check claims from people who run each pub, then review their proposed updates. Accepting a
            proposal records who sent it. It never overwrites existing notes.
          </p>

          {operatorMsg ? (
            <div className="admin-msg" role={operatorMsg.tone}>
              {operatorMsg.text}
            </div>
          ) : null}

          <div className="admin-bar">
            <button
              type="button"
              className="admin-btn"
              onClick={() => void loadOperators()}
              disabled={operatorLoading}
            >
              {operatorLoading ? "Loading…" : "Refresh"}
            </button>
          </div>

          <h3 className="admin-section">Pending operator claims</h3>
          {operatorClaims.length === 0 ? (
            <div className="admin-empty">
              <strong>No pending claims</strong>
              <span>Check claims outside PUBMAXX by checking the email domain, ringing the bar or reading the document.</span>
            </div>
          ) : (
            <div className="admin-list">
              {operatorClaims.map((c) => (
                <article className="admin-card" key={c.id}>
                  <div className="admin-card-head">
                    <span className="admin-handle">{venueNames.get(c.venueId) ?? c.venueId}</span>
                    <span className="admin-report">{c.evidenceKind}</span>
                  </div>
                  <p className="admin-note">{c.evidenceNote}</p>
                  <div className="admin-meta">
                    <Link className="admin-venue-link" href={`/ledger/${encodeURIComponent(c.venueId)}`}>
                      Open the ledger
                    </Link>
                    <span>Filed: {new Date(c.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="admin-actions">
                    <button
                      className="admin-btn admin-restore"
                      onClick={() => void decideOperatorClaim(c.id, "verify")}
                      disabled={operatorActionId === c.id}
                    >
                      {operatorActionId === c.id ? "Working…" : "Approve"}
                    </button>
                    <button
                      className="admin-btn admin-keep"
                      onClick={() => void decideOperatorClaim(c.id, "reject")}
                      disabled={operatorActionId === c.id}
                    >
                      {operatorActionId === c.id ? "Working…" : "Reject"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          <h3 className="admin-section">Pending proposals</h3>
          {operatorProposals.length === 0 ? (
            <div className="admin-empty">
              <strong>No pending proposals</strong>
              <span>Proposals from approved pub operators land here for review before they show.</span>
            </div>
          ) : (
            <div className="admin-list">
              {operatorProposals.map((p) => (
                <article className="admin-card" key={p.id}>
                  <div className="admin-card-head">
                    <span className="admin-handle">{venueNames.get(p.venueId) ?? p.venueId}</span>
                    <span className="admin-report">{p.type}</span>
                  </div>
                  <p className="admin-note">
                    {p.payload.field ? <strong>{p.payload.field}: </strong> : null}
                    {p.payload.title ? <strong>{p.payload.title} </strong> : null}
                    {p.payload.startsAt ? <em>({p.payload.startsAt}) </em> : null}
                    {p.payload.body ?? ""}
                  </p>
                  <div className="admin-meta">
                    <Link className="admin-venue-link" href={`/ledger/${encodeURIComponent(p.venueId)}`}>
                      Open the ledger
                    </Link>
                    <span>Proposed: {new Date(p.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="admin-actions">
                    <button
                      className="admin-btn admin-restore"
                      onClick={() => void decideOperatorProposal(p.id, "accept")}
                      disabled={operatorActionId === p.id}
                    >
                      {operatorActionId === p.id ? "Working…" : "Accept"}
                    </button>
                    <button
                      className="admin-btn admin-keep"
                      onClick={() => void decideOperatorProposal(p.id, "decline")}
                      disabled={operatorActionId === p.id}
                    >
                      {operatorActionId === p.id ? "Working…" : "Decline"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
