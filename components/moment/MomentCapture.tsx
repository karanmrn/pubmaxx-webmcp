"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Camera, ImagePlus, LockKeyhole, MapPin, Sparkles, Upload, X } from "lucide-react";
import {
  ChangeEvent,
  Component,
  DragEvent as ReactDragEvent,
  FormEvent,
  MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import SignInButton from "@/components/auth/SignInButton";
import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import SiteNav from "@/components/nav/SiteNav";
import { safeMomentReturnTo } from "@/components/nav/navigationModel";
import { trackEvent } from "@/lib/analytics";
import { MOBILE_MEDIA_QUERY } from "@/lib/breakpoints";
import { recordMomentNudgeTrigger } from "@/lib/identityNudge";
import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { captureNativePhoto } from "@/lib/nativeCamera";
import { isNativeApp } from "@/lib/nativePlatform";
import {
  MOMENT_MAX_PHOTO_BYTES,
  MOMENT_PHOTO_TYPES,
  replaceMomentMediaWithEditedBlob,
} from "@/lib/momentPhotoEditor";
import {
  createMomentDraft,
  deleteMomentDraft,
  loadMomentDraft,
  MOMENT_DRAFT_CHANNEL,
  saveMomentDraft,
  selectMomentMedia,
  type MomentDraftV1,
  type MomentMediaDraft,
} from "@/lib/momentDraft";

import "./moment.css";

const GUEST_OWNER = "guest";

const MomentImageEditor = dynamic(() => import("./MomentImageEditor"), {
  ssr: false,
  loading: () => <div className="momentEditorLoading" role="status">Opening editor...</div>,
});

type MomentImageEditorBoundaryProps = {
  children: ReactNode;
  onError: () => void;
};

type MomentImageEditorBoundaryState = {
  hasError: boolean;
};

class MomentImageEditorBoundary extends Component<
  MomentImageEditorBoundaryProps,
  MomentImageEditorBoundaryState
> {
  state: MomentImageEditorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): MomentImageEditorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(): void {
    this.props.onError();
  }

  render(): ReactNode {
    return this.state.hasError ? null : this.props.children;
  }
}

/** Phone shell (≤640): camera-first. Wider: upload / drag-drop primacy. */
function subscribeMobileViewport(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia(MOBILE_MEDIA_QUERY);
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}

function getMobileViewportSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

type SaveState = "idle" | "saving" | "saved";
type EditorSession = { mediaId: string; file: File };

function newDraft(ownerKey: string): MomentDraftV1 {
  return createMomentDraft(ownerKey);
}

function makeMedia(file: File): MomentMediaDraft {
  return {
    id: crypto.randomUUID(),
    type: "image",
    name: file.name,
    mimeType: file.type,
    size: file.size,
    blob: file,
    objectUrl: URL.createObjectURL(file),
    width: null,
    height: null,
    focalX: 0.5,
    focalY: 0.5,
    alt: "",
  };
}

function withPreviewUrls(draft: MomentDraftV1): MomentDraftV1 {
  return {
    ...draft,
    media: draft.media.map((item) => ({
      ...item,
      objectUrl: item.blob ? URL.createObjectURL(item.blob) : null,
    })),
  };
}

export default function MomentCapture(): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = safeMomentReturnTo(searchParams?.get("returnTo"));
  const { user, loading: authLoading } = useAuth();
  const viewerSession = useViewerSession();
  const ownerKey = user?.id ?? GUEST_OWNER;
  const isPhone = useSyncExternalStore(
    subscribeMobileViewport,
    getMobileViewportSnapshot,
    () => false,
  );
  const [draft, setDraft] = useState<MomentDraftV1>(() => newDraft(GUEST_OWNER));
  const [hydrated, setHydrated] = useState(false);
  const [message, setMessage] = useState("Your draft stays on this device until you save it.");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedMemoryId, setSavedMemoryId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [editingMediaId, setEditingMediaId] = useState<string | null>(null);
  const [editorSession, setEditorSession] = useState<EditorSession | null>(null);
  const editorSessionRef = useRef<EditorSession | null>(null);
  const editorOpenerRef = useRef<HTMLElement | null>(null);
  const previewUrls = useRef<Set<string>>(new Set());
  // Arm the identity nudge once per composer visit, the first time a signed-out
  // guest has a Moment draft worth keeping. The server save path requires auth,
  // so a signed-out capture is always a local draft — exactly when "own your
  // memories" is honest. The gate (lib/identityNudge.ts) still self-guards.
  const momentNudgeArmed = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      const owned = await loadMomentDraft(ownerKey);
      const guest = ownerKey !== GUEST_OWNER && !owned ? await loadMomentDraft(GUEST_OWNER) : null;
      const restored = owned ?? guest;
      if (cancelled) return;
      if (restored) {
        const next = withPreviewUrls({ ...restored, ownerKey });
        next.media.forEach((item) => { if (item.objectUrl) previewUrls.current.add(item.objectUrl); });
        setDraft(next);
        setMessage("Your unfinished Moment is back.");
        if (guest && ownerKey !== GUEST_OWNER) void deleteMomentDraft(GUEST_OWNER);
      } else {
        setDraft(newDraft(ownerKey));
      }
      setHydrated(true);
    }
    void restore();
    return () => { cancelled = true; };
  }, [ownerKey]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      void saveMomentDraft(draft);
      if (!user && !momentNudgeArmed.current && (draft.caption.trim() || draft.media.length)) {
        momentNudgeArmed.current = true;
        recordMomentNudgeTrigger();
      }
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel(MOMENT_DRAFT_CHANNEL);
        channel.postMessage({ ownerKey: draft.ownerKey, revision: draft.revision });
        channel.close();
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft, hydrated, user]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(MOMENT_DRAFT_CHANNEL);
    channel.onmessage = (event: MessageEvent<{ ownerKey?: string; revision?: number }>) => {
      if (event.data.ownerKey === draft.ownerKey && Number(event.data.revision) > draft.revision) {
        setMessage("This Moment changed in another tab. Refresh to load the latest draft.");
      }
    };
    return () => channel.close();
  }, [draft.ownerKey, draft.revision]);

  useEffect(() => () => {
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrls.current.clear();
  }, []);

  const canSave = useMemo(
    () => Boolean(draft.caption.trim() || draft.media.length) && !authLoading && saveState !== "saving",
    [authLoading, draft.caption, draft.media.length, saveState],
  );

  function update(patch: Partial<MomentDraftV1>) {
    setDraft((current) => ({
      ...current,
      ...patch,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
    }));
    setSavedMemoryId(null);
    if (saveState === "saved") setSaveState("idle");
  }

  function chooseMedia(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    addFiles(files);
  }

  // Inside the Capacitor shell the picker label routes through the native
  // camera seam (lib/nativeCamera.ts) instead of the file input; on the web
  // this handler is a no-op and the label opens the input as before.
  async function chooseNativeMedia(event: ReactMouseEvent<HTMLLabelElement>) {
    if (!isNativeApp()) return;
    event.preventDefault();
    const file = await captureNativePhoto();
    if (file) addFiles([file]);
  }

  function onPickerDragEnter(event: ReactDragEvent<HTMLLabelElement>) {
    if (isPhone || isNativeApp()) return;
    event.preventDefault();
    event.stopPropagation();
    setDragOver(true);
  }

  function onPickerDragOver(event: ReactDragEvent<HTMLLabelElement>) {
    if (isPhone || isNativeApp()) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  }

  function onPickerDragLeave(event: ReactDragEvent<HTMLLabelElement>) {
    if (isPhone || isNativeApp()) return;
    event.preventDefault();
    // Only clear when leaving the label itself (not a child).
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragOver(false);
  }

  function onPickerDrop(event: ReactDragEvent<HTMLLabelElement>) {
    if (isPhone || isNativeApp()) return;
    event.preventDefault();
    event.stopPropagation();
    setDragOver(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    addFiles(files);
  }

  function addFiles(files: File[]) {
    if (!files.length) return;
    const invalid = files.find((file) => !MOMENT_PHOTO_TYPES.has(file.type) || file.size > MOMENT_MAX_PHOTO_BYTES);
    if (invalid) {
      setMessage("Choose JPEG, PNG, or WebP photos up to 10MB each.");
      return;
    }
    const incoming = files.map(makeMedia);
    const selection = selectMomentMedia(draft.media, incoming);
    if (selection.error) {
      incoming.forEach((item) => { if (item.objectUrl) URL.revokeObjectURL(item.objectUrl); });
      setMessage(selection.error);
      return;
    }
    incoming.forEach((item) => { if (item.objectUrl) previewUrls.current.add(item.objectUrl); });
    update({ media: selection.media, kind: "photo" });
    setMessage(selection.media.length === 1 ? "Photo added. It's still private." : `${selection.media.length} photos added. They're still private.`);
  }

  const pickerPrimary = draft.media.length
    ? "Add another"
    : isPhone
      ? "Take a photo"
      : "Upload a photo";
  const pickerSecondary = isPhone
    ? "Camera or library"
    : "JPEG, PNG, or WebP · drag and drop or browse";

  // Author-written alt text lives on the draft media item. This is the ONLY way
  // a description is set in v1 — the author types it. AI-suggestion seam: a
  // provider could compute a suggestion and pass it as a prefill for this field
  // to edit, but it must never auto-fill or auto-confirm (see the field below).
  function updateMediaAlt(id: string, value: string) {
    update({ media: draft.media.map((item) => (item.id === id ? { ...item, alt: value } : item)) });
  }

  function removeMedia(id: string) {
    const target = draft.media.find((item) => item.id === id);
    if (editingMediaId === id) {
      editorSessionRef.current = null;
      setEditorSession(null);
    }
    if (target?.objectUrl) {
      URL.revokeObjectURL(target.objectUrl);
      previewUrls.current.delete(target.objectUrl);
    }
    update({ media: draft.media.filter((item) => item.id !== id) });
  }

  function openPhotoEditor(mediaId: string, opener: HTMLElement) {
    const media = draft.media.find((item) => item.id === mediaId);
    if (!media?.blob) return;
    const file = media.blob instanceof File
      ? media.blob
      : new File([media.blob], media.name, {
        type: media.mimeType,
        lastModified: 0,
      });
    const session = { mediaId, file };
    editorSessionRef.current = session;
    setEditorSession(session);
    editorOpenerRef.current = opener;
    setEditingMediaId(mediaId);
  }

  function closePhotoEditor() {
    editorSessionRef.current = null;
    setEditorSession(null);
    setEditingMediaId(null);
  }

  function finishPhotoEdit(session: EditorSession | null, result: { blob: Blob }) {
    if (!session || editorSessionRef.current !== session || editingMediaId !== session.mediaId) return;
    const current = draft.media.find((item) => item.id === session.mediaId);
    if (!current) {
      closePhotoEditor();
      return;
    }
    const replacement = replaceMomentMediaWithEditedBlob(current, result);
    if (replacement.error) {
      closePhotoEditor();
      setMessage(replacement.error);
      return;
    }
    if (current.objectUrl) {
      URL.revokeObjectURL(current.objectUrl);
      previewUrls.current.delete(current.objectUrl);
    }
    if (replacement.media.objectUrl) previewUrls.current.add(replacement.media.objectUrl);
    update({ media: draft.media.map((item) => (item.id === current.id ? replacement.media : item)) });
    closePhotoEditor();
    setMessage("Edited photo ready.");
  }

  function handlePhotoEditorError(
    session: EditorSession | null,
    reason: "open" | "save" = "open",
  ) {
    if (!session || editorSessionRef.current !== session || editingMediaId !== session.mediaId) return;
    closePhotoEditor();
    setMessage(
      reason === "save"
        ? "Edited photo could not be saved. Original photo kept."
        : "Editor could not open. Original photo kept.",
    );
  }

  const editingMedia = editingMediaId
    ? draft.media.find((item) => item.id === editingMediaId)
    : null;
  const editingFile = editingMedia && editorSession?.mediaId === editingMedia.id
    ? editorSession.file
    : null;

  async function saveMoment(event: FormEvent) {
    event.preventDefault();
    if (!user) {
      setMessage("Sign in to save this Moment. Your draft will stay here.");
      return;
    }
    if (!canSave) return;
    setSaveState("saving");
    setMessage("Saving privately...");

    let memoryId = draft.serverMemoryId;
    if (!memoryId) {
      const memoryResponse = await authedActionFetch("/api/night-memories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: draft.memoryTitle.trim() || "Tonight's Memory" }),
      }).catch(() => null);
      const memoryBody = memoryResponse
        ? await memoryResponse.json().catch(() => ({})) as { memory?: { id: string }; error?: string }
        : {};
      if (!memoryResponse?.ok || !memoryBody.memory) {
        setSaveState("idle");
        setMessage(
          typeof navigator !== "undefined" && navigator.onLine === false
            ? "You look offline. Reconnect, then try again. Your draft is safe."
            : errorMessageFrom(memoryBody, "That Memory could not be created. Your draft is safe."),
        );
        return;
      }
      memoryId = memoryBody.memory.id;
      update({ serverMemoryId: memoryId });
    }

    const items: Array<MomentMediaDraft | null> = draft.media.length ? draft.media : [null];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const body = item ? new FormData() : JSON.stringify({
        kind: draft.kind === "photo" ? "side_quest" : draft.kind,
        caption: draft.caption,
        venueId: draft.venueId || null,
        occurredAt: draft.occurredAt,
      });
      if (item && body instanceof FormData) {
        body.set("photo", item.blob, item.name);
        body.set("caption", index === 0 ? draft.caption : "");
        body.set("venueId", draft.venueId);
        body.set("occurredAt", draft.occurredAt);
        // Author-confirmed alt text travels with the photo. Empty is allowed for a
        // private save; it only blocks publication later, never this save.
        body.set("altText", item.alt ?? "");
      }
      const response = await authedActionFetch(
        `/api/night-memories/${encodeURIComponent(memoryId)}/moments`,
        {
          method: "POST",
          ...(body instanceof FormData ? {} : { headers: { "content-type": "application/json" } }),
          body,
        },
      ).catch(() => null);
      const responseBody = response
        ? await response.json().catch(() => ({})) as { error?: string }
        : {};
      if (!response?.ok) {
        const remaining = draft.media.slice(index);
        update({
          media: remaining,
          caption: index > 0 ? "" : draft.caption,
          serverMemoryId: response?.status === 400 ? null : memoryId,
        });
        setSaveState("idle");
        setMessage(errorMessageFrom(responseBody, "Some photos could not be saved. The remaining draft is safe."));
        return;
      }
    }

    await deleteMomentDraft(ownerKey);
    draft.media.forEach((item) => {
      if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
    });
    previewUrls.current.clear();
    setSavedMemoryId(memoryId);
    setDraft(newDraft(ownerKey));
    setSaveState("saved");
    setMessage("Moment saved privately. You decide if it becomes a Story.");
    trackEvent("night_moment_saved", { kind: draft.media.length ? "photo" : draft.kind, visibility: "private" });
    router.replace(returnTo);
  }

  return (
    <div className="momentPage">
      <SiteNav />
      <main id="main" className="momentMain">
        <header className="momentIntro">
          <div className="momentIntroRail">
            <span className="momentPrivacy"><LockKeyhole size={14} aria-hidden="true" /> Private first</span>
            <Link href={returnTo} className="momentCancel">Cancel</Link>
          </div>
          <h1>Keep this one.</h1>
          <p>
            {isPhone
              ? "Take the photo now. Decide what it means, and who sees it, when the night slows down."
              : "Add a photo from this computer. Decide what it means, and who sees it, when the night slows down."}
          </p>
        </header>

        <section className="momentIntent" aria-label="Choose what to save">
          <div className="momentIntentCurrent">
            {isPhone ? <Camera size={21} aria-hidden="true" /> : <Upload size={21} aria-hidden="true" />}
            <div>
              <strong>Private Moment</strong>
              <span>
                {isPhone
                  ? "Photos, people, places and detours"
                  : "Upload photos, then caption the night"}
              </span>
            </div>
          </div>
          <Link href="/map?log=1" className="momentIntentLink">
            <MapPin size={21} aria-hidden="true" />
            <div><strong>Log a Pint Drop</strong><span>Pub, drink and price</span></div>
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </section>

        <form className="momentComposer" onSubmit={saveMoment} aria-label="Private Moment composer">
          <div className={`momentMediaGrid momentMediaGrid${draft.media.length || 1}`}>
            {draft.media.map((item) => (
              <figure className="momentMedia" key={item.id}>
                {item.objectUrl ? (
                  <Image
                    src={item.objectUrl}
                    alt={item.alt || "Moment preview"}
                    fill
                    sizes="(max-width: 640px) 50vw, 280px"
                    unoptimized
                  />
                ) : null}
                <div className="momentMediaActions">
                  <button type="button" disabled={saveState === "saving"} onClick={(event) => openPhotoEditor(item.id, event.currentTarget)} aria-label={`Edit ${item.name}`}>
                    Edit
                  </button>
                  <button type="button" onClick={() => removeMedia(item.id)} aria-label={`Remove ${item.name}`}>
                    <X size={17} aria-hidden="true" />
                  </button>
                </div>
              </figure>
            ))}
            {draft.media.length < 4 ? (
              <label
                className={
                  dragOver ? "momentMediaPicker momentMediaPickerDragOver" : "momentMediaPicker"
                }
                onClick={chooseNativeMedia}
                onDragEnter={onPickerDragEnter}
                onDragOver={onPickerDragOver}
                onDragLeave={onPickerDragLeave}
                onDrop={onPickerDrop}
              >
                {isPhone ? (
                  <ImagePlus size={28} aria-hidden="true" />
                ) : (
                  <Upload size={28} aria-hidden="true" />
                )}
                <strong>{pickerPrimary}</strong>
                <span>{pickerSecondary}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  // Rear camera only on phone / native. Desktop is file pick.
                  {...(isPhone ? { capture: "environment" as const } : {})}
                  multiple
                  onChange={chooseMedia}
                />
              </label>
            ) : null}
          </div>

          {draft.media.length ? (
            <fieldset className="momentAltText">
              <legend>Describe each photo</legend>
              <p className="momentAltText__hint">
                Describe the photo for someone who cannot see it. One clear line
                each. It is what a screen reader reads aloud when you publish.
              </p>
              {draft.media.map((item, index) => (
                <label className="momentAltText__row" key={`alt-${item.id}`}>
                  <span>Photo {index + 1}</span>
                  {/* AI-suggestion seam (v1: none): a provider could prefill this with
                      a suggestion for the author to edit and confirm. It must never
                      auto-fill or auto-confirm — the author's typed words are the
                      confirmation the publish gate checks for. */}
                  <textarea
                    value={item.alt}
                    onChange={(event) => updateMediaAlt(item.id, event.target.value)}
                    maxLength={200}
                    rows={2}
                    placeholder="e.g. Four friends toasting pints at a candlelit table."
                  />
                </label>
              ))}
            </fieldset>
          ) : null}

          <div className="momentFields">
            <label>
              <span>What happened?</span>
              <textarea
                value={draft.caption}
                onChange={(event) => update({ caption: event.target.value })}
                maxLength={500}
                rows={4}
                placeholder="One line you will still remember next year."
              />
            </label>
            <div className="momentFieldPair">
              <label>
                <span>Name this night</span>
                <input value={draft.memoryTitle} onChange={(event) => update({ memoryTitle: event.target.value })} maxLength={120} placeholder="Friday detour" />
              </label>
              <label>
                <span>Venue reference <small>optional</small></span>
                <input value={draft.venueId} onChange={(event) => update({ venueId: event.target.value })} maxLength={80} placeholder="Choose from the map later" />
              </label>
            </div>
          </div>

          <div className="momentStatus" aria-live="polite">
            <Sparkles size={17} aria-hidden="true" />
            <span>{message}</span>
          </div>

          {user ? (
            <button className="momentSave" type="submit" disabled={!canSave}>
              {saveState === "saving" ? "Saving privately..." : "Save private Moment"}
            </button>
          ) : viewerSession.unresolved ? null : (
            <div className="momentSignIn">
              <p>Sign in when you are ready to keep this Moment across devices.</p>
              <SignInButton />
            </div>
          )}
        </form>

        {editingFile ? (
          <MomentImageEditorBoundary onError={() => handlePhotoEditorError(editorSession)}>
            <MomentImageEditor
              file={editingFile}
              openerRef={editorOpenerRef}
              onSave={(result) => finishPhotoEdit(editorSession, result)}
              onCancel={() => {
                if (editorSessionRef.current !== editorSession) return;
                closePhotoEditor();
                setMessage("Original photo kept.");
              }}
              onError={(reason) => handlePhotoEditorError(editorSession, reason)}
            />
          </MomentImageEditorBoundary>
        ) : null}

        {savedMemoryId ? (
          <section className="momentSaved" aria-labelledby="moment-saved-title">
            <h2 id="moment-saved-title">Saved. Still yours.</h2>
            <p>Add more Moments, choose which to include, and shape a Story when you are ready.</p>
            <div className="momentSavedActions">
              <Link href="/u/you#night-memories" className="momentSavedPrimary">Build your Story</Link>
              <Link href="/tonight" className="momentSavedSecondary">Back to Tonight</Link>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
