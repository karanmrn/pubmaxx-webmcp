"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/authContext";
import { readActiveRoundCode } from "@/lib/activeRound";
import { getAnonId } from "@/lib/anonId";
import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { trackEvent } from "@/lib/analytics";
import type { CityId } from "@/lib/cities";
import { unresolvedVenueLabel } from "@/lib/cityVenueIds";
import type { PintDropDTO } from "@/lib/feed";
import {
  buildOptimisticSpillDrop,
  buildOptimisticSpillRetryPayload,
  emitOptimisticSpillChange,
  failOptimisticSpill,
  newOptimisticSpillClientId,
  readOptimisticSpills,
  reconcileOptimisticSpill,
  shouldOptimisticallyAppearInFeed,
  upsertOptimisticSpill,
  writeOptimisticSpills,
} from "@/lib/optimisticSpillPost";
import { lastTrainComposeFields } from "@/lib/lastTrainBadge";
import {
  filterMapPintDropEntries,
  type MapPintDropVenue,
} from "@/lib/mapPintDropPolicy";
import { clearPintDropDraft } from "@/lib/pintDropDraft";
import { pintDropAuthorValue } from "@/lib/pintDropComposerIdentity";
import { notifyCheapPintPingQualified } from "@/lib/cheapPintPingQualifyClient";
import type { PintDrop, VibeTag } from "@/lib/pintDropShared";
import {
  captureRoundAppendSnapshot,
  captureRoundRequestIdentity,
  roundJsonRequest,
  runRoundMutationForCurrentUser,
  type RoundAppendSnapshot,
  type RoundRequestIdentity,
} from "@/lib/roundRequest";
import {
  appendWithSuffix,
  DEFAULT_VISIBILITY,
  spillHasSubmissionEvidence,
  type Visibility,
} from "@/lib/spill";
import type { LastPintDecision } from "@/lib/tfl";
import { venueMapUrl } from "@/lib/venueMapUrl";
import { corroboratedPriceDrop } from "@/lib/venues";

// The API DTO carries photo URLs on every drop; lib/pintDrops owns the base
// shape, so we augment it here at the client boundary rather than editing lib/*.
export type DropWithPhotos = PintDrop & {
  pintPhotoUrl: string | null;
  venuePhotoUrl: string | null;
  optimistic?: PintDropDTO["optimistic"];
};

export type PhotoSlot = { file: File; previewUrl: string };
export type PhotoSlotName = "pint" | "venue";

/** Success/error banner after a drop — optional next-action links for Loop 2. */
export type DropMsg = {
  ok: boolean;
  text: string;
  links?: Array<{ href: string; label: string }>;
};

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB — server re-validates.
const ACCEPTED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_VIBE_TAGS = 4; // mirrors the server cap in lib/pintDrops.ts.

function localStorageSafe(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Best-effort: append this venue as a stop on the open Round. Fail-soft — a
 * miss (closed / network) must never undo a successful drop. Joins first so a
 * viewer who stamped the Round from the page can append without a separate
 * join step, then uses the existing `addStop` action.
 */
async function appendStopToActiveRound(input: {
  identity: RoundRequestIdentity;
  code: string;
  handle: string;
  venueId: string;
  venueName: string;
  dropRef?: string;
}): Promise<boolean> {
  try {
    const path = `/api/rounds/${encodeURIComponent(input.code)}`;
    const joinRes = await roundJsonRequest(path, input.identity, {
      action: "join",
      handle: input.handle,
    });
    // Join may 409 if already a member — still attempt addStop (idempotent join).
    // Other join failures must not call addStop or pretend the stop landed.
    if (!joinRes.ok && joinRes.status !== 409) {
      return false;
    }
    const res = await roundJsonRequest(
      path,
      input.identity,
      {
        action: "addStop",
        handle: input.handle,
        venueId: input.venueId,
        venueName: input.venueName,
        ...(input.dropRef ? { dropRef: input.dropRef } : {}),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

function pintDropId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

async function appendPintDropStopToActiveRound(input: {
  round: RoundAppendSnapshot | null;
  currentUserId: () => string | null;
  venueId: string;
  venueName: string;
  dropRef?: string;
}): Promise<boolean> {
  const round = input.round;
  if (!round) return false;
  const completion = await runRoundMutationForCurrentUser(
    round.identity,
    input.currentUserId,
    () =>
      appendStopToActiveRound({
        identity: round.identity,
        code: round.code,
        handle: round.handle,
        venueId: input.venueId,
        venueName: input.venueName,
        dropRef: input.dropRef,
      }),
  );
  return completion.current && completion.value;
}

function groupDropsByVenueId(drops: DropWithPhotos[]): Map<string, DropWithPhotos[]> {
  const grouped = new Map<string, DropWithPhotos[]>();
  for (const drop of drops) {
    grouped.set(drop.venueId, [...(grouped.get(drop.venueId) ?? []), drop]);
  }
  return grouped;
}

// Owns all client-side /api/pint-drops interaction: fetch, per-venue refresh,
// submit (multipart), report, composer form + photo slot state. API contract unchanged.
// `cityId` scopes the unscoped map-layer fetch so Manchester demo seeds colour
// Manchester pins without leaking into the London feed.
export function usePintDrops(
  cityId: CityId = "london",
  mapVenues?: readonly MapPintDropVenue[],
) {
  const {
    user,
    session,
    loading: authLoading,
    configured: authConfigured,
    handle: accountHandle,
    identityResolved,
    getCurrentUserId,
  } = useAuth();
  const signedIn = Boolean(user && session);
  const identityReady = !authLoading && identityResolved;
  const roundIdentity = useMemo(
    () =>
      authLoading
        ? null
        : captureRoundRequestIdentity(user?.id ?? null, session),
    [authLoading, session, user?.id],
  );
  const [handle, setHandle] = useState(() =>
    typeof window === "undefined" ? "" : (window.localStorage.getItem("pubmax_handle") ?? ""),
  );
  const [dropsByVenueId, setDropsByVenueId] = useState<Map<string, DropWithPhotos[]>>(
    () => new Map(),
  );
  const [composerOpen, setComposerOpen] = useState(false);
  const [dropForm, setDropForm] = useState({ price: "", drink: "", note: "", era: "", withWho: "" });
  // Visibility (issue #29 backbone; this composer is the first writer of it).
  // Additive field — defaults to `public`, matching the server default exactly.
  const [visibility, setVisibility] = useState<Visibility>(DEFAULT_VISIBILITY);
  // Selected vibe tags (client-side UX only — the server re-filters against its
  // own allowlist). Multi-select, capped at MAX_VIBE_TAGS by toggleVibeTag.
  const [vibeTags, setVibeTags] = useState<VibeTag[]>([]);
  const [pintPhoto, setPintPhoto] = useState<PhotoSlot | null>(null);
  const [venuePhoto, setVenuePhoto] = useState<PhotoSlot | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dropMsg, setDropMsg] = useState<DropMsg | null>(null);
  const pintInputRef = useRef<HTMLInputElement>(null);
  const venueInputRef = useRef<HTMLInputElement>(null);
  // Ref guard + optimistic removal is the whole "pending state" for reports —
  // the button unmounts on click, so double-submit can't happen.
  const reportsInFlight = useRef(new Set<string>());
  // Abort in-flight city-scoped list fetches when city changes or a newer
  // refresh supersedes an older one (avoids stale London drops painting Manchester).
  const cityListAbortRef = useRef<AbortController | null>(null);

  // Refresh the WHOLE drops layer from the public list (city-scoped). This is
  // the same read the initial load uses — so #29 visibility filtering re-applies —
  // and re-groups by venue, which repaints every pin halo / venue signal. Live
  // updates (issue #37, useLiveDrops) call this on a new-drop signal. Fail-soft:
  // a failed refresh leaves the current layer intact (does NOT wipe it), so a
  // transient hiccup never blanks the map.
  const refreshAllDrops = useCallback(() => {
    cityListAbortRef.current?.abort();
    const ac = new AbortController();
    cityListAbortRef.current = ac;
    const qs = new URLSearchParams({ city: cityId });
    fetch(`/api/pint-drops?${qs.toString()}`, { signal: ac.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("bad status"))))
      .then((data: { drops?: DropWithPhotos[] }) => {
        if (!ac.signal.aborted) {
          setDropsByVenueId(groupDropsByVenueId(data.drops ?? []));
        }
      })
      .catch(() => {
        // Keep the existing layer — a live refresh failure / abort is not a
        // reason to blank the map (unlike the initial load).
      });
  }, [cityId]);

  useEffect(() => {
    cityListAbortRef.current?.abort();
    const ac = new AbortController();
    cityListAbortRef.current = ac;
    const qs = new URLSearchParams({ city: cityId });
    fetch(`/api/pint-drops?${qs.toString()}`, { signal: ac.signal })
      .then((response) => (response.ok ? response.json() : { drops: [] }))
      .then((data: { drops?: DropWithPhotos[] }) => {
        if (!ac.signal.aborted) {
          setDropsByVenueId(groupDropsByVenueId(data.drops ?? []));
        }
      })
      .catch(() => {
        if (!ac.signal.aborted) setDropsByVenueId(new Map());
      });
    return () => ac.abort();
  }, [cityId]);

  // Refresh one venue's drops; returns a cancel function for effect cleanup.
  const refreshVenueDrops = useCallback((venueId: string) => {
    let active = true;
    fetch(`/api/pint-drops?venueId=${encodeURIComponent(venueId)}`)
      .then((response) => (response.ok ? response.json() : { drops: [] }))
      .then((data: { drops?: DropWithPhotos[] }) => {
        if (active) {
          setDropsByVenueId((current) => {
            const next = new Map(current);
            next.set(venueId, data.drops ?? []);
            return next;
          });
        }
      })
      .catch(() => {
        if (active) {
          setDropsByVenueId((current) => {
            const next = new Map(current);
            next.set(venueId, []);
            return next;
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  // Pick a photo for one slot: pre-validate (type + size) before we ever build a
  // preview or submit, so bad files are caught client-side. Object URLs are
  // revoked when the slot is replaced/removed and on unmount (effect below).
  function pickPhoto(slot: PhotoSlotName, file: File | undefined, inputEl: HTMLInputElement | null) {
    const current = slot === "pint" ? pintPhoto : venuePhoto;
    const setSlot = slot === "pint" ? setPintPhoto : setVenuePhoto;
    if (!file) return;
    if (!ACCEPTED_PHOTO_TYPES.includes(file.type)) {
      setDropMsg({ ok: false, text: "Photos must be JPEG, PNG, or WebP." });
      if (inputEl) inputEl.value = "";
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setDropMsg({ ok: false, text: "Each photo must be under 5MB." });
      if (inputEl) inputEl.value = "";
      return;
    }
    if (current) URL.revokeObjectURL(current.previewUrl);
    setDropMsg(null);
    setSlot({ file, previewUrl: URL.createObjectURL(file) });
  }

  // Toggle a vibe tag on/off. Multi-select, but silently ignores a new
  // selection once MAX_VIBE_TAGS is reached (the server caps identically).
  function toggleVibeTag(tag: VibeTag) {
    setVibeTags((current) =>
      current.includes(tag)
        ? current.filter((t) => t !== tag)
        : current.length >= MAX_VIBE_TAGS
          ? current
          : [...current, tag],
    );
  }

  function removePhoto(slot: PhotoSlotName) {
    const current = slot === "pint" ? pintPhoto : venuePhoto;
    const setSlot = slot === "pint" ? setPintPhoto : setVenuePhoto;
    const inputEl = slot === "pint" ? pintInputRef.current : venueInputRef.current;
    if (current) URL.revokeObjectURL(current.previewUrl);
    setSlot(null);
    if (inputEl) inputEl.value = "";
  }

  const resetComposer = useCallback(() => {
    setPintPhoto((current) => {
      if (current) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    setVenuePhoto((current) => {
      if (current) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    setDropForm({ price: "", drink: "", note: "", era: "", withWho: "" });
    setVibeTags([]);
    setVisibility(DEFAULT_VISIBILITY);
    if (pintInputRef.current) pintInputRef.current.value = "";
    if (venueInputRef.current) venueInputRef.current.value = "";
  }, []);

  // Revoke any live preview URLs when the component unmounts.
  useEffect(() => {
    return () => {
      if (pintPhoto) URL.revokeObjectURL(pintPhoto.previewUrl);
      if (venuePhoto) URL.revokeObjectURL(venuePhoto.previewUrl);
    };
  }, [pintPhoto, venuePhoto]);

  function updateOptimisticFeedStorage(
    update: (current: ReturnType<typeof readOptimisticSpills>) => ReturnType<typeof readOptimisticSpills>,
  ) {
    if (typeof window === "undefined") return;
    const next = update(readOptimisticSpills(window.localStorage));
    writeOptimisticSpills(window.localStorage, next);
    emitOptimisticSpillChange();
  }

  function submitDrop(
    event: FormEvent,
    venueId: string,
    options?: { venueName?: string; lastTrainDecision?: LastPintDecision | null },
  ) {
    event.preventDefault();
    if (
      !spillHasSubmissionEvidence({
        price: dropForm.price,
        note: dropForm.note,
        withWho: dropForm.withWho,
      })
    ) {
      setDropMsg({ ok: false, text: "Add a price or a passed-down note." });
      return;
    }
    return submitDropRequest(venueId, options);
  }

  async function submitDropRequest(
    venueId: string,
    options?: { venueName?: string; lastTrainDecision?: LastPintDecision | null },
  ) {
    const submittedRound = captureRoundAppendSnapshot(
      roundIdentity,
      accountHandle,
      readActiveRoundCode(),
      localStorageSafe(),
    );
    setSubmitting(true);
    setDropMsg(null);
    const clientRequestId = newOptimisticSpillClientId();
    const submittedAuthor = pintDropAuthorValue({
      accountHandle,
      draftHandle: handle,
      signedIn,
      identityReady,
      authRequired: authConfigured,
    });
    if (!submittedAuthor.canSubmit) {
      setSubmitting(false);
      setDropMsg({
        ok: false,
        text:
          authConfigured && !signedIn
            ? "Sign in to post a Pint Drop."
            : "Finish setting your PUBMAXX Handle before posting.",
      });
      return;
    }
    const passedDownNote = appendWithSuffix(dropForm.note, dropForm.withWho);
    // Wave G1: only stamp leave-by + decision when a LIVE Last Pint verdict is
    // on screen — never attach live_data_unavailable or a missing leave-by.
    const trainFields = lastTrainComposeFields(options?.lastTrainDecision ?? null);
    const optimisticInput = {
      clientRequestId,
      venueId,
      venueName: options?.venueName,
      handle: submittedAuthor.handle,
      priceGbp: dropForm.price,
      drink: dropForm.drink,
      passedDownNote,
      era: dropForm.era,
      visibility,
      vibeTags,
      pintPhotoUrl: pintPhoto?.previewUrl ?? null,
      venuePhotoUrl: venuePhoto?.previewUrl ?? null,
      createdAt: new Date().toISOString(),
      ...(trainFields ?? {}),
    };
    const optimisticDrop = buildOptimisticSpillDrop(optimisticInput);
    const publishToFeed = shouldOptimisticallyAppearInFeed(visibility);
    if (publishToFeed) {
      updateOptimisticFeedStorage((current) =>
        upsertOptimisticSpill(
          current,
          optimisticDrop,
          buildOptimisticSpillRetryPayload(optimisticInput),
        ),
      );
    }
    const optimisticMapDrop: DropWithPhotos = {
      id: optimisticDrop.id,
      venueId,
      handle: optimisticDrop.handle,
      drink: optimisticDrop.drink,
      priceGbp: optimisticDrop.priceGbp,
      passedDownNote: optimisticDrop.passedDownNote,
      era: optimisticDrop.era,
      vibeTags: optimisticDrop.vibeTags as VibeTag[],
      provenance: optimisticDrop.provenance,
      status: "visible",
      visibility,
      createdAt: optimisticDrop.createdAt,
      pintPhotoUrl: optimisticDrop.pintPhotoUrl,
      venuePhotoUrl: optimisticDrop.venuePhotoUrl,
      optimistic: optimisticDrop.optimistic,
      ...(trainFields
        ? { leaveByIso: trainFields.leaveByIso, lastTrainDecision: trainFields.lastTrainDecision }
        : {}),
    };
    setDropsByVenueId((current) => {
      const next = new Map(current);
      next.set(venueId, [optimisticMapDrop, ...(next.get(venueId) ?? [])]);
      return next;
    });

    // Instant post UX (IDEAS A2): close the composer immediately and reconcile
    // in the background. Failures keep the optimistic card in a retryable state.
    // Capture form fields BEFORE resetComposer clears them.
    const submittedHandle = submittedAuthor.handle.trim();
    const submittedDrink = dropForm.drink;
    const submittedPrice = dropForm.price;
    const submittedEra = dropForm.era;
    const submittedVisibility = visibility;
    const submittedVibeTags = [...vibeTags];
    const submittedPintFile = pintPhoto?.file ?? null;
    const submittedVenueFile = venuePhoto?.file ?? null;
    clearPintDropDraft(
      typeof window === "undefined" ? null : window.sessionStorage,
      venueId,
    );
    try {
      window.localStorage.setItem("pubmax_handle", submittedHandle);
    } catch {
      // Storage blocked — handle can be re-entered later.
    }
    resetComposer();
    setComposerOpen(false);
    setSubmitting(false);
    setDropMsg({
      ok: true,
      text: "Cheers. Saving your Pint Drop…",
      links: [{ href: "/social", label: "Open Social" }],
    });

    const markFailed = (message: string) => {
      if (publishToFeed) {
        updateOptimisticFeedStorage((current) => failOptimisticSpill(current, clientRequestId, message));
      }
      setDropsByVenueId((current) => {
        const next = new Map(current);
        next.set(
          venueId,
          (next.get(venueId) ?? []).map((drop) =>
            drop.id === optimisticDrop.id
              ? {
                  ...drop,
                  optimistic: {
                    state: "failed",
                    message,
                    uploadProgress: null,
                    canRetry: true,
                    clientRequestId,
                  },
                }
              : drop,
          ),
        );
        return next;
      });
      setDropMsg({ ok: false, text: message });
    };

    try {
      // multipart/form-data — do NOT set Content-Type, the browser adds the boundary.
      const body = new FormData();
      body.set("venueId", venueId);
      body.set("handle", submittedHandle);
      body.set("drink", submittedDrink);
      body.set("priceGbp", submittedPrice);
      // "With" has no server column (frozen API contract) — folded into the
      // note as a structured suffix ("— with @sam, @priya") at submit time, so
      // every surface that renders passedDownNote gets it for free. See
      // lib/spill.ts for the exact format.
      body.set("passedDownNote", passedDownNote);
      body.set("era", submittedEra);
      body.set("visibility", submittedVisibility);
      // Repeated field entries — the route also accepts one comma-separated
      // value; the server re-filters against its allowlist either way.
      for (const tag of submittedVibeTags) body.append("vibe_tags", tag);
      if (trainFields) {
        body.set("leaveByIso", trainFields.leaveByIso);
        body.set("lastTrainDecision", trainFields.lastTrainDecision);
      }
      if (submittedPintFile) body.set("pint_photo", submittedPintFile);
      if (submittedVenueFile) body.set("venue_photo", submittedVenueFile);

      const response = await authedActionFetch("/api/pint-drops", { method: "POST", body });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        markFailed(errorMessageFrom(data, "Could not save that drop."));
        return;
      }
      trackEvent("night_moment_saved", { kind: "pint_drop", visibility: submittedVisibility });
      notifyCheapPintPingQualified();

      const reconciledDrop = {
        ...(data.drop as PintDropDTO),
        venueName: options?.venueName,
        venueMapUrl: venueMapUrl(venueId),
      };
      if (publishToFeed) {
        updateOptimisticFeedStorage((current) =>
          reconcileOptimisticSpill(current, clientRequestId, reconciledDrop),
        );
      }
      setDropsByVenueId((current) => {
        const next = new Map(current);
        next.set(venueId, [
          data.drop,
          ...(next.get(venueId) ?? []).filter((drop) => drop.id !== optimisticDrop.id),
        ]);
        return next;
      });

      // Loop 2: if a Round is open, append this pub as a stop (existing
      // addStop API). Fail-soft — the drop already landed.
      const addedToNight = await appendPintDropStopToActiveRound({
        round: submittedRound,
        currentUserId: getCurrentUserId,
        venueId,
        venueName: options?.venueName ?? unresolvedVenueLabel(venueId),
        dropRef: pintDropId(data.drop),
      });

      const links: NonNullable<DropMsg["links"]> = [
        { href: "/social", label: "Open Social" },
      ];
      if (addedToNight) {
        links.push({
          href: `/bar-tab/${encodeURIComponent(venueId)}`,
          label: "Bar tab",
        });
        const cleanHandle = submittedRound?.handle.replace(/^@+/, "") ?? "";
        if (cleanHandle) {
          links.push({ href: `/u/${encodeURIComponent(cleanHandle)}`, label: "Your profile" });
        }
      }
      setDropMsg({
        ok: true,
        text: addedToNight
          ? "Cheers. Added to your night."
          : "Cheers. Your Pint Drop is live.",
        links,
      });
    } catch {
      markFailed("Network or storage error. Try again.");
    }
  }

  async function reportDrop(venueId: string, id: string) {
    if (reportsInFlight.current.has(id)) return;
    reportsInFlight.current.add(id);
    const reportedDrop = dropsByVenueId.get(venueId)?.find((drop) => drop.id === id);
    // Optimistic remove — moderation is minimal, no reason UI.
    setDropsByVenueId((current) => {
      const next = new Map(current);
      next.set(venueId, (next.get(venueId) ?? []).filter((drop) => drop.id !== id));
      return next;
    });
    try {
      // `actor` is the device's stable anon id (same attribution reactions and
      // comments use) — the server hashes it into the per-actor report key, so
      // devices behind a shared IP (pub wifi / NAT) stay distinct actors.
      // Called from an event handler, so `window` exists; getAnonId() returns
      // "" when storage is unavailable and the server degrades to its shared
      // anon sentinel.
      const res = await authedActionFetch("/api/pint-drops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "report", id, actor: getAnonId() }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        if (reportedDrop) {
          setDropsByVenueId((current) => {
            const next = new Map(current);
            next.set(venueId, [
              reportedDrop,
              ...(next.get(venueId) ?? []).filter((drop) => drop.id !== id),
            ]);
            return next;
          });
        }
        reportsInFlight.current.delete(id);
        setDropMsg({
          ok: false,
          text:
            offlineOrMessage(errorMessageFrom(body, "Could not report that Pint Drop. Try again."))
        });
        return;
      }
      setDropMsg({ ok: true, text: "Report received. That Pint Drop is hidden." });
    } catch {
      if (reportedDrop) {
        setDropsByVenueId((current) => {
          const next = new Map(current);
          next.set(venueId, [
            reportedDrop,
            ...(next.get(venueId) ?? []).filter((drop) => drop.id !== id),
          ]);
          return next;
        });
      }
      reportsInFlight.current.delete(id);
      setDropMsg({
        ok: false,
        text:
          offlineOrMessage("Could not report that Pint Drop. Try again.")
      });
    }
  }

  // Reset composer chrome when the inspected venue changes.
  const closeComposer = useCallback(() => {
    setDropMsg(null);
    setComposerOpen(false);
  }, []);

  const mapDropsByVenueId = useMemo(
    () =>
      mapVenues
        ? filterMapPintDropEntries(mapVenues, dropsByVenueId)
        : dropsByVenueId,
    [dropsByVenueId, mapVenues],
  );

  const venueSignals = useMemo(() => {
    const signals = new Map<
      string,
      {
        hasPintDrops: boolean;
        dropCount: number;
        latestContributorPrice: number | null;
        /**
         * Epoch ms that contributor price was logged, or null. Carried so a
         * freshest-wins merge (community price submissions) can tell which
         * observation is actually newer instead of guessing.
         */
        latestContributorAt: number | null;
        /** Display-only demo price for pin colour when the slim index has null cheapestPrice. */
        latestDemoPrice: number | null;
      }
    >();
    for (const [venueId, venueDrops] of mapDropsByVenueId) {
      // Demo seeds never feed the "latest contributor price" signal — a seeded
      // price must not read as a community log. And a lone organic drop never
      // feeds it either: AGENTS.md pin law, "an uncorroborated report cannot
      // reach either lane" (band or printed figure). corroboratedPriceDrop
      // (lib/venues.ts) is the drop lane's trust gate — same predicates as
      // community submissions. The ungated drop still shows on the venue sheet
      // (dropsByVenueId) and earns the provisional mark through its own seam.
      const latestContributorDrop = corroboratedPriceDrop(venueDrops);
      const latestContributorPrice = latestContributorDrop?.priceGbp ?? null;
      const createdAtMs = latestContributorDrop
        ? Date.parse(latestContributorDrop.createdAt)
        : NaN;
      const latestContributorAt = Number.isFinite(createdAtMs) ? createdAtMs : null;
      // Pin colour fallback only: when a city pack has null cheapestPrice,
      // a demo seed can still tint the pin. Never merges into venue.cheapestPrice.
      const latestDemoPrice =
        venueDrops.find(
          (drop) => drop.provenance === "demo" && typeof drop.priceGbp === "number",
        )?.priceGbp ?? null;
      // dropCount/hasPintDrops match the map halo: any visible drop counts
      // (seeds included) so the "has drops" signal is consistent everywhere.
      signals.set(venueId, {
        hasPintDrops: venueDrops.length > 0,
        dropCount: venueDrops.length,
        latestContributorPrice,
        latestContributorAt,
        latestDemoPrice,
      });
    }
    return signals;
  }, [mapDropsByVenueId]);

  return {
    dropsByVenueId: mapDropsByVenueId,
    venueSignals,
    refreshVenueDrops,
    refreshAllDrops,
    handle,
    setHandle,
    accountHandle,
    authConfigured,
    signedIn,
    identityReady,
    composerOpen,
    setComposerOpen,
    closeComposer,
    dropForm,
    setDropForm,
    vibeTags,
    setVibeTags,
    toggleVibeTag,
    visibility,
    setVisibility,
    pintPhoto,
    venuePhoto,
    pintInputRef,
    venueInputRef,
    pickPhoto,
    removePhoto,
    resetComposer,
    submitting,
    dropMsg,
    submitDrop,
    reportDrop,
  };
}

export type PintDropsState = ReturnType<typeof usePintDrops>;
