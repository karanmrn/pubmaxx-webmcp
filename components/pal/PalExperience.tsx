"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  Eye,
  EyeOff,
  LockKeyhole,
  MapPinned,
  Mic,
  ShieldCheck,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import SignInButton from "@/components/auth/SignInButton";
import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import {
  DEFAULT_PAL_DRAFT,
  anonymousPalDraftOwner,
  clearPalOnboardingDraft,
  migrateLegacyPalOnboardingDraft,
  PAL_UNLOCKS,
  palMasteryProgress,
  PAL_ONBOARDING_SPECIES,
  PAL_VOICES,
  SIGNAL_FAMILIES,
  readPalOnboardingDraft,
  subscribePalOnboardingDraft,
  writePalOnboardingDraft,
  type PalAnimationState,
  type PalOnboardingPrivacy,
  type PubPal,
  type PubPalAppearance,
  type PubPalDraft,
  type PubPalPersonality,
  type PubPalMemory,
} from "@/lib/pubPal";
import PalPortrait from "./PalPortrait";
import PubPalVoice from "@/components/pubpal/PubPalVoice";
import { Button } from "@/components/ui/button";
import { setActivePlanPalContext } from "@/lib/activePlan";
import { readFirstRunCompanion } from "@/lib/firstRunTour";

const STORAGE_KEY = "pubmax_pub_pal_v1";
const PRIVACY_KEY = "pubmax_pub_pal_privacy_v1";

const speciesCopy = {
  robin: { title: "Circuit Robin", note: "Bright · grounded" },
  greyhound: { title: "Greyhound", note: "Loyal · perceptive" },
  cat: { title: "Black Cat", note: "Calm · mischievous" },
  fox: { title: "Fox", note: "Curious · quick" },
  pigeon: { title: "Pigeon", note: "Streetwise · social" },
  badger: { title: "Badger", note: "Steady · protective" },
  corgi: { title: "Corgi", note: "Bright · encouraging" },
  hound: { title: "Signal Hound", note: "Legacy companion" },
  raven: { title: "Raven", note: "Legacy companion" },
  rabbit: { title: "Rabbit", note: "Alert · spontaneous" },
  turtle: { title: "Turtle", note: "Steady · thoughtful" },
  squirrel: { title: "Squirrel", note: "Social · excitable" },
  bot: { title: "Night bot", note: "Precise · expressive" },
} as const;

const nameIdeas = {
  "Gen Z": ["Miso", "Nova", "Pixel", "Chilli"],
  "Gen X": ["Ripley", "Bowie", "Gizmo", "Trinity"],
  Classic: ["Mabel", "Teddy", "Bonnie", "Arthur"],
} as const;

const voiceCopy = {
  ember: "Warm and grounded",
  velvet: "Calm and nocturnal",
  signal: "Bright and synthetic",
} as const;

const signalCopy = {
  beer: "Amber",
  gin: "Crystal",
  rum: "Copper",
  whisky: "Faceted",
  brandy: "Polished",
  vodka: "Ice",
} as const;

const materialCopy: Record<PubPalAppearance["material"], string> = {
  hologram: "Hologram",
  chrome: "Chrome",
  glass: "Glass",
};

const accessoryCopy: Record<PubPalAppearance["accessory"], string> = {
  none: "None",
  collar: "Signal collar",
  monocle: "Data lens",
  "signal-ring": "Signal ring",
};

const relationshipCopy: Record<PubPalPersonality["relationship"], string> = {
  guide: "Guide",
  sidekick: "Sidekick",
  confidant: "Confidant",
};

type PrivacyState = PalOnboardingPrivacy;

const DEFAULT_PRIVACY: PrivacyState = {
  proposeMemories: false,
  visible: true,
  muted: false,
};

const palStateSpeech: Record<PalAnimationState, string> = {
  idle: "Ready when you are. I will never make a change without showing you first.",
  noticing: "I hear you. Getting the signal clear.",
  listening: "Listening. Nothing from this conversation becomes memory.",
  thinking: "Thinking through a grounded answer.",
  speaking: "Here's what I found. You choose what happens next.",
  celebrating: "Signal confirmed. Nice one.",
  sleeping: "Voice is muted. Tap the control when you want me back.",
  error: "The signal dropped. Text still works, and nothing was saved.",
};

function previewSpeech(step: number, draft: PubPalDraft): string {
  switch (step) {
    case 0: return "I'm for adults planning a night out.";
    case 1: return draft.name.trim() ? `${draft.name.trim()}. I like it.` : `A ${draft.appearance.species}. Give me a name.`;
    case 2: return `${materialCopy[draft.appearance.material]} tuned to ${signalCopy[draft.appearance.signalAffinity].toLowerCase()}.`;
    case 3: return `${voiceCopy[draft.voice.id]}. Your ${relationshipCopy[draft.personality.relationship].toLowerCase()}.`;
    default: return "Nothing becomes memory unless you approve it.";
  }
}

function readStoredPal(ownerId: string): PubPal | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as (PubPal & { proposalPreferences?: PubPal["proposalPreferences"] }) | null;
    return value?.ownerId === ownerId
      ? { ...value, proposalPreferences: value.proposalPreferences ?? { memories: false, routes: true } }
      : null;
  } catch {
    return null;
  }
}

function ChoiceButton({
  selected,
  title,
  note,
  onClick,
}: {
  selected: boolean;
  title: string;
  note?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`palChoice ${selected ? "isSelected" : ""}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span>{title}</span>
      {note && <small>{note}</small>}
      {selected && <Check size={17} aria-hidden="true" />}
    </button>
  );
}

function RangeControl({
  label,
  low,
  high,
  value,
  onChange,
}: {
  label: string;
  low: string;
  high: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="palRange">
      <span className="palRangeLabel">{label}</span>
      <input
        type="range"
        min="0"
        max="100"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="palRangeEnds"><small>{low}</small><small>{high}</small></span>
    </label>
  );
}

export default function PalExperience() {
  const { user, loading, configured } = useAuth();
  const palViewerSession = useViewerSession();
  // The account gate is a claim about the viewer, so it waits for the live
  // session rather than reading a null user as a settled sign-out.
  const showPalAccountGate = palViewerSession.signedOut;
  const [anonymousOwner] = useState(anonymousPalDraftOwner);
  const [draftOwner, setDraftOwner] = useState("");
  const [mode, setMode] = useState<"meeting" | "onboarding" | "home">("meeting");
  const [step, setStep] = useState<number>(0);
  const [draft, setDraft] = useState<PubPalDraft>(DEFAULT_PAL_DRAFT);
  const [privacy, setPrivacy] = useState<PrivacyState>(DEFAULT_PRIVACY);
  const [pal, setPal] = useState<PubPal | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memories, setMemories] = useState<PubPalMemory[]>([]);
  const [palAnimationState, setPalAnimationState] = useState<PalAnimationState>("idle");
  const [editingMemoryId, setEditingMemoryId] = useState("");
  const [editingMemoryValue, setEditingMemoryValue] = useState("");
  const [controlSaving, setControlSaving] = useState(false);
  const [activeOwnerId, setActiveOwnerId] = useState("");
  const activeOwnerRef = useRef("");
  const palMutationRef = useRef<{ ownerId: string; requestId: number } | null>(null);
  const controlSavingRef = useRef<{ ownerId: string; requestId: number } | null>(null);
  const controlRequestIdRef = useRef(0);

  useEffect(() => {
    if (loading) return;
    const owner = user?.id ?? anonymousOwner;
    if (owner === draftOwner) return;
    let restored = readPalOnboardingDraft(owner);
    if (user && !restored) {
      const anonymousDraft = readPalOnboardingDraft(anonymousOwner);
      if (anonymousDraft) {
        restored = anonymousDraft;
        writePalOnboardingDraft(owner, { step: restored.step, draft: restored.draft, privacy: restored.privacy });
        clearPalOnboardingDraft(anonymousOwner);
      }
    }
    restored ??= migrateLegacyPalOnboardingDraft(owner);
    const rememberedCompanion = readFirstRunCompanion();
    const firstRunDraft = rememberedCompanion
      ? {
          ...DEFAULT_PAL_DRAFT,
          appearance: {
            ...DEFAULT_PAL_DRAFT.appearance,
            species: rememberedCompanion,
          },
        }
      : DEFAULT_PAL_DRAFT;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setDraftOwner(owner);
      setMode(restored ? "onboarding" : "meeting");
      setStep(restored?.step ?? 0);
      setDraft(restored?.draft ?? firstRunDraft);
      setPrivacy(restored?.privacy ?? DEFAULT_PRIVACY);
    });
    return () => { cancelled = true; };
  }, [anonymousOwner, draftOwner, loading, user]);

  useEffect(() => {
    if (mode !== "onboarding" || !draftOwner) return;
    const timer = window.setTimeout(() => writePalOnboardingDraft(draftOwner, {
      step: Math.max(0, Math.min(4, step)) as 0 | 1 | 2 | 3 | 4,
      draft,
      privacy,
    }), 200);
    return () => window.clearTimeout(timer);
  }, [draft, draftOwner, mode, privacy, step]);

  useEffect(() => {
    if (!draftOwner) return;
    return subscribePalOnboardingDraft(draftOwner, () => {
      const restored = readPalOnboardingDraft(draftOwner);
      if (!restored) return;
      setStep(restored.step);
      setDraft(restored.draft);
      setPrivacy(restored.privacy);
      setMode("onboarding");
    });
  }, [draftOwner]);

  useEffect(() => {
    const ownerId = user?.id ?? "";
    const controller = new AbortController();
    activeOwnerRef.current = ownerId;
    queueMicrotask(() => {
      if (activeOwnerRef.current !== ownerId) return;
      setActiveOwnerId(ownerId);
      setPal(null);
      setMemories([]);
      setEditingMemoryId("");
      setEditingMemoryValue("");
      setError(null);
      setActivePlanPalContext(null);
      palMutationRef.current = null;
      setSaving(false);
      controlSavingRef.current = null;
      setControlSaving(false);
      setReady(!user);
    });
    if (!user) return () => controller.abort();

    void authedActionFetch("/api/pub-pal", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as { pal?: PubPal | null };
        if (controller.signal.aborted || activeOwnerRef.current !== ownerId) return;
        const next = response.ok ? body.pal ?? null : readStoredPal(user.id);
        if (next?.ownerId === ownerId) {
          setActivePlanPalContext({ id: next.id, name: next.name });
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          setPal(next);
          setDraft({
            adultConfirmed: true,
            name: next.name,
            appearance: next.appearance,
            personality: next.personality,
            voice: next.voice,
          });
          setPrivacy((current) => ({ ...current, proposeMemories: next.proposalPreferences?.memories === true, visible: !next.hidden, muted: next.muted }));
          setMode("home");
          const storedPrivacy = localStorage.getItem(`${PRIVACY_KEY}:${user.id}`);
          if (storedPrivacy) {
            try {
              const parsed = JSON.parse(storedPrivacy) as { proposeMemories?: unknown };
              setPrivacy((current) => ({
                ...current,
                proposeMemories: next.proposalPreferences?.memories ?? parsed.proposeMemories === true,
                visible: !next.hidden,
                muted: next.muted,
              }));
            } catch {
              // Invalid local consent fails closed: proposals remain disabled.
            }
          }
          void authedActionFetch("/api/pub-pal/memories", { signal: controller.signal })
            .then(async (memoryResponse) => {
              const memoryBody = await memoryResponse.json().catch(() => ({})) as { memories?: PubPalMemory[] };
              if (!controller.signal.aborted && activeOwnerRef.current === ownerId && memoryResponse.ok) setMemories(memoryBody.memories ?? []);
            })
            .catch(() => {});
        }
        if (!controller.signal.aborted && activeOwnerRef.current === ownerId) setReady(true);
      })
      .catch(() => {
        if (controller.signal.aborted || activeOwnerRef.current !== ownerId) return;
        const next = readStoredPal(user.id);
        if (next?.ownerId === ownerId) {
          setActivePlanPalContext({ id: next.id, name: next.name });
          setPal(next);
          setMode("home");
        }
        setReady(true);
      });
    return () => controller.abort();
  }, [user]);

  const previewName = draft.name.trim() || `Your ${speciesCopy[draft.appearance.species].title}`;
  const level = useMemo(() => Math.floor((pal?.masteryPoints ?? 0) / 50) + 1, [pal]);
  const canContinue = step !== 0 || draft.adultConfirmed;

  const updateAppearance = (patch: Partial<PubPalAppearance>) => {
    setDraft((current) => ({
      ...current,
      appearance: { ...current.appearance, ...patch },
    }));
  };

  const updatePersonality = (patch: Partial<PubPalPersonality>) => {
    setDraft((current) => ({
      ...current,
      personality: { ...current.personality, ...patch },
    }));
  };

  const createPal = async () => {
    if (!user) return;
    if (palMutationRef.current || controlSavingRef.current) return;
    const ownerId = user.id;
    const lock = { ownerId, requestId: ++controlRequestIdRef.current };
    palMutationRef.current = lock;
    setSaving(true);
    setError(null);
    try {
      const response = await authedActionFetch("/api/pub-pal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...draft,
          hidden: !privacy.visible,
          muted: privacy.muted,
          proposalPreferences: { memories: privacy.proposeMemories, routes: true },
        }),
      });
      const body = await response.json().catch(() => ({})) as { pal?: PubPal; error?: string };
      if (!response.ok || !body.pal) throw new Error(errorMessageFrom(body, "Your Pal could not be created."));

      const next = body.pal;
      if (activeOwnerRef.current !== ownerId || next.ownerId !== ownerId) return;

      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      localStorage.setItem(`${PRIVACY_KEY}:${ownerId}`, JSON.stringify({ proposeMemories: privacy.proposeMemories }));
      setPal(next);
      setActivePlanPalContext({ id: next.id, name: next.name });
      setMode("home");
      clearPalOnboardingDraft(draftOwner);
    } catch (cause) {
      if (activeOwnerRef.current !== ownerId) return;
      setError(cause instanceof Error ? cause.message : "Your Pal could not be created.");
    } finally {
      if (palMutationRef.current === lock) {
        palMutationRef.current = null;
        setSaving(false);
      }
    }
  };

  const updateControl = async (patch: Partial<Pick<PubPal, "muted" | "hidden">>) => {
    if (!pal || controlSavingRef.current || palMutationRef.current) return;
    const ownerId = pal.ownerId;
    const lock = { ownerId, requestId: ++controlRequestIdRef.current };
    controlSavingRef.current = lock;
    setControlSaving(true);
    const optimistic = { ...pal, ...patch, updatedAt: new Date().toISOString() };
    setPal(optimistic);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(optimistic));
    try {
      const response = await authedActionFetch("/api/pub-pal", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await response.json().catch(() => ({})) as { pal?: PubPal; error?: unknown };
      if (!response.ok || !body.pal) {
        throw new Error(errorMessageFrom(body, "Pal control update could not be saved."));
      }
      if (activeOwnerRef.current !== ownerId || body.pal.ownerId !== ownerId) return;
      setPal(body.pal);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(body.pal));
      setPalAnimationState("celebrating");
      window.setTimeout(() => setPalAnimationState("idle"), 900);
    } catch (cause) {
      if (activeOwnerRef.current !== ownerId) return;
      setPalAnimationState("error");
      setPal(pal);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pal));
      setError(
        offlineOrMessage(cause instanceof Error
            ? cause.message
            : "Pal control update could not be saved.")
      );
    } finally {
      if (controlSavingRef.current === lock) {
        controlSavingRef.current = null;
        setControlSaving(false);
      }
    }
  };

  const updateProposalPreference = async (kind: "memories" | "routes", enabled: boolean) => {
    if (!pal || controlSavingRef.current || palMutationRef.current) return;
    const ownerId = pal.ownerId;
    const lock = { ownerId, requestId: ++controlRequestIdRef.current };
    controlSavingRef.current = lock;
    setControlSaving(true);
    const previous = { ...pal, proposalPreferences: pal.proposalPreferences ?? { memories: false, routes: true } };
    const proposalPreferences = { ...previous.proposalPreferences, [kind]: enabled };
    const optimistic = { ...pal, proposalPreferences, updatedAt: new Date().toISOString() };
    setPal(optimistic);
    if (kind === "memories") setPrivacy((current) => ({ ...current, proposeMemories: enabled }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(optimistic));
    try {
      const response = await authedActionFetch("/api/pub-pal", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proposalPreferences }),
      });
      const body = await response.json().catch(() => ({})) as { pal?: PubPal; error?: string };
      if (!response.ok || !body.pal) throw new Error(errorMessageFrom(body, "Pal proposal controls could not be saved."));
      if (activeOwnerRef.current !== ownerId || body.pal.ownerId !== ownerId) return;
      setPal(body.pal);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(body.pal));
      setPalAnimationState("celebrating");
      window.setTimeout(() => setPalAnimationState("idle"), 900);
    } catch (cause) {
      if (activeOwnerRef.current !== ownerId) return;
      setPal(previous);
      setPrivacy((current) => ({ ...current, proposeMemories: previous.proposalPreferences.memories }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(previous));
      setError(cause instanceof Error ? cause.message : "Pal proposal controls could not be saved.");
      setPalAnimationState("error");
    } finally {
      if (controlSavingRef.current === lock) {
        controlSavingRef.current = null;
        setControlSaving(false);
      }
    }
  };

  const beginMemoryCorrection = (memory: PubPalMemory) => {
    setEditingMemoryId(memory.id);
    setEditingMemoryValue(memory.value);
  };

  const saveMemoryCorrection = async (memoryId: string) => {
    if (!editingMemoryValue.trim() || !pal || palMutationRef.current || controlSavingRef.current) return;
    const ownerId = pal.ownerId;
    const lock = { ownerId, requestId: ++controlRequestIdRef.current };
    palMutationRef.current = lock;
    setSaving(true);
    setError(null);
    try {
      const response = await authedActionFetch(`/api/pub-pal/memories/${encodeURIComponent(memoryId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: editingMemoryValue }),
      });
      const body = await response.json().catch(() => ({})) as { memory?: PubPalMemory; error?: string };
      if (!response.ok || !body.memory) throw new Error(errorMessageFrom(body, "That memory correction could not be saved."));
      if (activeOwnerRef.current !== ownerId) return;
      setMemories((current) => current.map((memory) => memory.id === memoryId ? body.memory! : memory));
      setEditingMemoryId("");
      setEditingMemoryValue("");
      setPalAnimationState("celebrating");
      window.setTimeout(() => setPalAnimationState("idle"), 900);
    } catch (cause) {
      if (activeOwnerRef.current !== ownerId) return;
      setError(cause instanceof Error ? cause.message : "That memory correction could not be saved.");
      setPalAnimationState("error");
    } finally {
      if (palMutationRef.current === lock) {
        palMutationRef.current = null;
        setSaving(false);
      }
    }
  };

  const removeMemory = async (memory: PubPalMemory) => {
    if (!pal || palMutationRef.current || controlSavingRef.current || !window.confirm(`Delete this confirmed memory?\n\n${memory.value}`)) return;
    const ownerId = pal.ownerId;
    const lock = { ownerId, requestId: ++controlRequestIdRef.current };
    palMutationRef.current = lock;
    setSaving(true);
    setError(null);
    try {
      const response = await authedActionFetch(`/api/pub-pal/memories/${encodeURIComponent(memory.id)}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(errorMessageFrom(body, "That memory could not be deleted."));
      if (activeOwnerRef.current !== ownerId) return;
      setMemories((current) => current.filter((item) => item.id !== memory.id));
      if (editingMemoryId === memory.id) {
        setEditingMemoryId("");
        setEditingMemoryValue("");
      }
    } catch (cause) {
      if (activeOwnerRef.current !== ownerId) return;
      setError(cause instanceof Error ? cause.message : "That memory could not be deleted.");
    } finally {
      if (palMutationRef.current === lock) {
        palMutationRef.current = null;
        setSaving(false);
      }
    }
  };

  const exportMemories = async () => {
    if (!pal || palMutationRef.current || controlSavingRef.current) return;
    const ownerId = pal.ownerId;
    const palName = pal.name;
    const lock = { ownerId, requestId: ++controlRequestIdRef.current };
    palMutationRef.current = lock;
    setSaving(true);
    setError(null);
    try {
      const response = await authedActionFetch("/api/pub-pal/memories/export");
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(errorMessageFrom(body, "Your Pal memory export could not be prepared."));
      }
      const blob = await response.blob();
      if (activeOwnerRef.current !== ownerId) return;
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `pubmaxx-pal-memory-${palName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "export"}.json`;
      anchor.click();
      URL.revokeObjectURL(href);
    } catch (cause) {
      if (activeOwnerRef.current !== ownerId) return;
      setError(cause instanceof Error ? cause.message : "Your Pal memory export could not be prepared.");
    } finally {
      if (palMutationRef.current === lock) {
        palMutationRef.current = null;
        setSaving(false);
      }
    }
  };

  const removePal = async () => {
    if (!pal || palMutationRef.current || controlSavingRef.current || !window.confirm(`Delete ${pal.name} and every confirmed memory?`)) return;
    const ownerId = pal.ownerId;
    const lock = { ownerId, requestId: ++controlRequestIdRef.current };
    palMutationRef.current = lock;
    setSaving(true);
    setError(null);
    try {
      const response = await authedActionFetch("/api/pub-pal", { method: "DELETE" });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(errorMessageFrom(body, "Your Pal could not be deleted."));
      if (activeOwnerRef.current !== ownerId) return;
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(`${PRIVACY_KEY}:${ownerId}`);
      setActivePlanPalContext(null);
      setMemories([]);
      setPal(null);
      setDraft(DEFAULT_PAL_DRAFT);
      setPrivacy(DEFAULT_PRIVACY);
      setStep(0);
      setMode("meeting");
      clearPalOnboardingDraft(draftOwner);
    } catch (cause) {
      if (activeOwnerRef.current !== ownerId) return;
      setError(cause instanceof Error ? cause.message : "Your Pal could not be deleted.");
    } finally {
      if (palMutationRef.current === lock) {
        palMutationRef.current = null;
        setSaving(false);
      }
    }
  };

  const ownerTransitioning = !loading && (
    activeOwnerId !== (user?.id ?? "") ||
    draftOwner !== (user?.id ?? anonymousOwner)
  );
  if (loading || !ready || ownerTransitioning) {
    return <main id="main" className="palExperience"><div className="palLoading" role="status">Waking your Pub Pal</div></main>;
  }

  if (mode === "home" && pal && user && pal.ownerId === user.id) {
    const visiblePalState: PalAnimationState = pal.muted ? "sleeping" : palAnimationState;
    const proposalPreferences = pal.proposalPreferences ?? { memories: false, routes: true };
    const mastery = palMasteryProgress(pal.masteryPoints);
    return (
      <main id="main" className="palExperience palHome">
        <div className="palTopbar">
          <Link href="/map"><ArrowLeft size={17} /> Map</Link>
          <span>Level {level}</span>
        </div>
        <section className="palHomeHero" aria-labelledby="pal-home-title">
          <div className="palHomePortrait">
            <PalPortrait appearance={pal.appearance} name={pal.name} state={visiblePalState} />
            <p className="palSpeech">{palStateSpeech[visiblePalState]}</p>
          </div>
          <div className="palHomeCopy">
            <p className="palEyebrow">Your Pub Pal</p>
            <h1 id="pal-home-title">{pal.name}</h1>
            <p>A {signalCopy[pal.appearance.signalAffinity].toLowerCase()} {pal.appearance.species} shaped around your night, with boundaries you control.</p>
            <Link className="palPrimary" href="/plan">Plan with {pal.name}<ArrowRight size={18} /></Link>
            <PubPalVoice muted={pal.muted} onStateChange={setPalAnimationState} />
          </div>
        </section>
        <section className="palControls" aria-labelledby="pal-controls-title">
          <div>
            <p className="palEyebrow">Boundaries</p>
            <h2 id="pal-controls-title">You stay in control.</h2>
            <p>Your Pal speaks only when invited. Approved facts are the only memories it can keep.</p>
          </div>
          <div className="palControlGrid">
            <button type="button" disabled={controlSaving || saving} onClick={() => void updateControl({ muted: !pal.muted })} aria-pressed={pal.muted}>
              {pal.muted ? <VolumeX /> : <Volume2 />}
              <span><strong>{pal.muted ? "Muted" : "Voice available"}</strong><small>{pal.muted ? "Tap to allow voice" : "Tap to mute everywhere"}</small></span>
            </button>
            <button type="button" disabled={controlSaving || saving} onClick={() => void updateControl({ hidden: !pal.hidden })} aria-pressed={pal.hidden}>
              {pal.hidden ? <EyeOff /> : <Eye />}
              <span><strong>{pal.hidden ? "Hidden" : "Visible"}</strong><small>{pal.hidden ? "Pal shortcuts are hidden" : "Pal can appear in shortcuts"}</small></span>
            </button>
            <button type="button" disabled={controlSaving || saving} onClick={() => void updateProposalPreference("memories", !proposalPreferences.memories)} aria-pressed={proposalPreferences.memories}>
              <ShieldCheck />
              <span><strong>Memory proposals {proposalPreferences.memories ? "on" : "off"}</strong><small>{proposalPreferences.memories ? "Every suggestion still needs your approval" : "Pal will not suggest facts to remember"}</small></span>
            </button>
            <button type="button" disabled={controlSaving || saving} onClick={() => void updateProposalPreference("routes", !proposalPreferences.routes)} aria-pressed={proposalPreferences.routes}>
              <MapPinned />
              <span><strong>Route proposals {proposalPreferences.routes ? "on" : "off"}</strong><small>{proposalPreferences.routes ? "Suggestions only; you confirm every change" : "Pal will not propose route changes"}</small></span>
            </button>
            <div className="palUnlockSummary" aria-label="Pub Pal progression">
              <strong>{pal.masteryPoints} mastery points</strong>
              <p className="palMasteryNext">{mastery.line}</p>
              <div className="palMasteryTrack" aria-hidden="true"><span style={{ width: `${Math.round(mastery.fraction * 100)}%` }} /></div>
              <ul>{PAL_UNLOCKS.map((unlock) => <li key={unlock.id} className={pal.masteryPoints >= unlock.pointsRequired ? "isUnlocked" : ""}>{unlock.label}<span>{unlock.pointsRequired}</span></li>)}</ul>
            </div>
            <button className="palDanger" type="button" disabled={controlSaving || saving} onClick={() => void removePal()}>
              <Trash2 />
              <span><strong>Delete {pal.name}</strong><small>Deletes the Pal and every confirmed memory</small></span>
            </button>
          </div>
        </section>
        <section className="palMemoryControls" aria-labelledby="pal-memory-title">
          <div className="palMemoryControls__header">
            <div>
              <p className="palEyebrow">Visible context</p>
              <h2 id="pal-memory-title">What {pal.name} remembers.</h2>
              <p>Only these confirmed facts can shape suggestions. Correct or delete any item; conversations and voice content never appear here.</p>
            </div>
            <button type="button" onClick={() => void exportMemories()} disabled={saving}><Download size={17} /> Export my context</button>
          </div>
          {memories.length ? (
            <ul className="palMemoryList">
              {memories.map((memory) => (
                <li key={memory.id}>
                  <div className="palMemoryList__meta"><span>{memory.kind.replaceAll("_", " ")}</span><small>{memory.provenance.replaceAll("_", " ")}</small></div>
                  {editingMemoryId === memory.id ? (
                    <div className="palMemoryList__edit">
                      <label><span>Correct this memory</span><textarea value={editingMemoryValue} onChange={(event) => setEditingMemoryValue(event.target.value)} maxLength={500} rows={3} disabled={saving} /></label>
                      <div><button type="button" disabled={saving || !editingMemoryValue.trim()} onClick={() => void saveMemoryCorrection(memory.id)}>Save correction</button><button type="button" className="palSecondary" disabled={saving} onClick={() => { setEditingMemoryId(""); setEditingMemoryValue(""); }}>Cancel</button></div>
                    </div>
                  ) : (
                    <p>{memory.value}</p>
                  )}
                  <div className="palMemoryList__actions">
                    {editingMemoryId !== memory.id ? <button type="button" disabled={saving} onClick={() => beginMemoryCorrection(memory)}>Correct</button> : null}
                    <button type="button" className="palDanger" disabled={saving} onClick={() => void removeMemory(memory)}><Trash2 size={16} /> Delete</button>
                  </div>
                </li>
              ))}
            </ul>
          ) : <div className="palMemoryEmpty"><ShieldCheck /><p>No confirmed context. {pal.name} can still help with the route in front of you.</p></div>}
          {error ? <p className="palError" role="alert">{error}</p> : null}
        </section>
      </main>
    );
  }

  if (mode === "meeting") {
    return (
      <main id="main" className="palExperience palMeeting">
        <div className="palTopbar">
          <Link href="/map"><ArrowLeft size={17} /> Map</Link>
          <span><LockKeyhole size={14} /> Private by default</span>
        </div>
        <section className="palMeetingStage" aria-labelledby="pal-meeting-title">
          <div className="palMeetingPortrait">
            <PalPortrait appearance={draft.appearance} name="Unclaimed Pub Pal" state="noticing" />
            <p className="palSpeech" aria-live="polite">There you are. What kind of night are we making?</p>
          </div>
          <div className="palMeetingCopy">
            <p className="palEyebrow">Meet your companion</p>
            <h1 id="pal-meeting-title">A little signal that becomes yours.</h1>
            <p>Choose its form, voice and boundaries. It can help plan the night. You choose what it may do.</p>
            <div className="palMeetingActions">
              <Button className="palPrimary" size="large" type="button" onClick={() => setMode("onboarding")}>Meet your Pub Pal<ArrowRight size={18} /></Button>
              <Link href="/map">Use PUBMAXX without a Pal</Link>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main id="main" className="palExperience palOnboarding">
      <div className="palTopbar">
        <button type="button" onClick={() => step === 0 ? setMode("meeting") : setStep((current) => current - 1)}><ArrowLeft size={17} /> Back</button>
        <span>{step + 1} of 5</span>
        <Link href="/map">Skip Pal</Link>
      </div>
      <div className="palProgress" aria-hidden="true"><span style={{ width: `${((step + 1) / 5) * 100}%` }} /></div>
      <div className="palOnboardingLayout">
        <div className="palOnboardingPreview">
          <PalPortrait
            appearance={draft.appearance}
            name={previewName}
            state={(["listening", "noticing", "celebrating", "speaking", "thinking"] as PalAnimationState[])[step] ?? "idle"}
          />
          <p className="palSpeech" aria-live="polite">{previewSpeech(step, draft)}</p>
        </div>
        <section className="palOnboardingPanel" aria-live="polite">
          {step === 0 && (
            <div className="palStep">
              <p className="palEyebrow">Eligibility</p>
              <h1>The grown-up bit first.</h1>
              <p>Pub Pal is designed for adults planning nights out.</p>
              <label className="palToggleRow">
                <input type="checkbox" checked={draft.adultConfirmed} onChange={(event) => setDraft((current) => ({ ...current, adultConfirmed: event.target.checked }))} />
                <span><strong>I confirm I&rsquo;m 18 or over</strong><small>We save the confirmation time, never your date of birth.</small></span>
              </label>
            </div>
          )}
          {step === 1 && (
            <div className="palStep">
              <p className="palEyebrow">Form and name</p>
              <h1>Who finds you?</h1>
              <p>Each Pal has the same planning intelligence. Choose the presence you want beside you.</p>
              <div className="palChoiceList palSpeciesGrid">{PAL_ONBOARDING_SPECIES.map((species) => <ChoiceButton key={species} selected={draft.appearance.species === species} title={speciesCopy[species].title} note={speciesCopy[species].note} onClick={() => updateAppearance({ species })} />)}</div>
              <label className="palField"><span>Name</span><input value={draft.name} maxLength={32} autoComplete="off" placeholder="Anything feels right" onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /><small>This is yours. Change it whenever you want.</small></label>
              <div className="palNameIdeas" aria-label="Name inspiration">
                {Object.entries(nameIdeas).map(([generation, names]) => (
                  <div key={generation}>
                    <span>{generation}</span>
                    <div>{names.map((name) => <button key={name} type="button" onClick={() => setDraft((current) => ({ ...current, name }))}>{name}</button>)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="palStep">
              <p className="palEyebrow">Appearance</p>
              <h1>Tune the signal.</h1>
              <fieldset><legend>Affinity</legend><div className="palChoiceGrid palChoiceGridThree">{SIGNAL_FAMILIES.map((signal) => <ChoiceButton key={signal} selected={draft.appearance.signalAffinity === signal} title={signalCopy[signal]} onClick={() => updateAppearance({ signalAffinity: signal })} />)}</div></fieldset>
              <fieldset><legend>Material</legend><div className="palChoiceGrid">{(["hologram", "chrome", "glass"] as const).map((material) => <ChoiceButton key={material} selected={draft.appearance.material === material} title={materialCopy[material]} onClick={() => updateAppearance({ material })} />)}</div></fieldset>
              <fieldset><legend>Accessory</legend><div className="palChoiceGrid">{(["none", "collar", "monocle", "signal-ring"] as const).map((accessory) => <ChoiceButton key={accessory} selected={draft.appearance.accessory === accessory} title={accessoryCopy[accessory]} onClick={() => updateAppearance({ accessory })} />)}</div></fieldset>
            </div>
          )}
          {step === 3 && (
            <div className="palStep">
              <p className="palEyebrow">Personality</p>
              <h1>Set the chemistry.</h1>
              <fieldset><legend>Relationship</legend><div className="palChoiceGrid">{(["guide", "sidekick", "confidant"] as const).map((relationship) => <ChoiceButton key={relationship} selected={draft.personality.relationship === relationship} title={relationshipCopy[relationship]} onClick={() => updatePersonality({ relationship })} />)}</div></fieldset>
              <RangeControl label="Temper" low="Dry" high="Playful" value={draft.personality.playfulness} onChange={(playfulness) => updatePersonality({ playfulness })} />
              <RangeControl label="Energy" low="Calm" high="Chaotic" value={draft.personality.energy} onChange={(energy) => updatePersonality({ energy })} />
              <RangeControl label="Conversation" low="Concise" high="Storytelling" value={draft.personality.storytelling} onChange={(storytelling) => updatePersonality({ storytelling })} />
              <fieldset><legend>Voice</legend>
              <div className="palChoiceList">{PAL_VOICES.map((voice) => <ChoiceButton key={voice} selected={draft.voice.id === voice} title={voice[0].toUpperCase() + voice.slice(1)} note={voiceCopy[voice]} onClick={() => setDraft((current) => ({ ...current, voice: { ...current.voice, id: voice } }))} />)}</div>
              </fieldset>
            </div>
          )}
          {step === 4 && (
            <div className="palStep">
              <p className="palEyebrow">Privacy and review</p>
              <h1>You decide what stays.</h1>
              <p>Audio and transcripts are not memories. Pub Pal can only propose short, structured facts for your approval.</p>
              <label className="palToggleRow">
                <input type="checkbox" checked={privacy.proposeMemories} onChange={(event) => setPrivacy((current) => ({ ...current, proposeMemories: event.target.checked }))} />
                <span><strong>Allow memory proposals</strong><small>{privacy.proposeMemories ? "Show each suggested fact for approval" : "Never suggest facts to remember"}</small></span>
              </label>
              <div className="palPrivacyFacts"><ShieldCheck /><p>You can inspect, correct and delete every approved memory. Safety and factuality controls can&rsquo;t be disabled.</p></div>
              <div className="palReview">
                <div><span>Name</span><strong>{draft.name.trim() || "Add a name"}</strong></div>
                <div><span>Form</span><strong>{speciesCopy[draft.appearance.species].title}, {materialCopy[draft.appearance.material]}</strong></div>
                <div><span>Voice</span><strong>{draft.voice.id}</strong></div>
                <div><span>Relationship</span><strong>{relationshipCopy[draft.personality.relationship]}</strong></div>
              </div>
              <label className="palToggleRow"><input type="checkbox" checked={privacy.visible} onChange={(event) => setPrivacy((current) => ({ ...current, visible: event.target.checked }))} /><span><strong>Show Pal shortcuts</strong><small>You can hide the Pal from Home, Plan and Map at any time.</small></span></label>
              <label className="palToggleRow"><input type="checkbox" checked={!privacy.muted} onChange={(event) => setPrivacy((current) => ({ ...current, muted: !event.target.checked }))} /><span><strong>Allow voice controls</strong><small>Your Pal still speaks only after you ask.</small></span></label>
              {showPalAccountGate && <div className="palAccountGate"><LockKeyhole /><div><strong>Sign in to make this Pal yours</strong><p>Your preview stays on this screen until you choose to sign in. Nothing is saved to an account yet.</p>{configured ? <SignInButton /> : <Link href="/map">Explore the map</Link>}</div></div>}
              {error && <p className="palError" role="alert">{error}</p>}
            </div>
          )}
          <div className="palOnboardingActions">
            <button type="button" onClick={() => step === 0 ? setMode("meeting") : setStep((current) => current - 1)}>Back</button>
            {step < 4 ? (
              <Button className="palPrimary" size="large" type="button" disabled={!canContinue || (step === 1 && !draft.name.trim())} onClick={() => setStep((current) => current + 1)}>Continue<ArrowRight size={18} /></Button>
            ) : user ? (
              <Button className="palPrimary" size="large" type="button" disabled={saving || !draft.name.trim()} onClick={() => void createPal()}>{saving ? "Creating your Pal" : "Create my Pal"}<Mic size={18} /></Button>
            ) : (
              <button type="button" onClick={() => setStep(0)}>Start over</button>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
