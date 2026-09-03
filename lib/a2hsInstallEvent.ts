/** The Chromium install event, which is not part of TypeScript's DOM map. */
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt: () => Promise<void>;
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
}

type PromptListener = () => void;
type InstalledListener = () => void;

let currentPrompt: BeforeInstallPromptEvent | null = null;
const promptListeners = new Set<PromptListener>();
const installedListeners = new Set<InstalledListener>();

function publishPromptChange(): void {
  for (const listener of promptListeners) listener();
}

export function isBeforeInstallPromptEvent(
  event: Event,
): event is BeforeInstallPromptEvent {
  try {
    const candidate = event as Partial<BeforeInstallPromptEvent>;
    return (
      typeof candidate.prompt === "function" &&
      typeof candidate.userChoice?.then === "function"
    );
  } catch {
    return false;
  }
}

/** Retains Chromium's one-shot event until the lazy install surface can use it. */
export function storeA2hsInstallPrompt(event: BeforeInstallPromptEvent): void {
  currentPrompt = event;
  publishPromptChange();
}

export function getA2hsInstallPrompt(): BeforeInstallPromptEvent | null {
  return currentPrompt;
}

/** Returns the retained event once and clears it before its prompt is invoked. */
export function consumeA2hsInstallPrompt(): BeforeInstallPromptEvent | null {
  const event = currentPrompt;
  if (!event) return null;
  currentPrompt = null;
  publishPromptChange();
  return event;
}

export function clearA2hsInstallPrompt(): void {
  if (!currentPrompt) return;
  currentPrompt = null;
  publishPromptChange();
}

export function subscribeA2hsInstallPrompt(listener: PromptListener): () => void {
  promptListeners.add(listener);
  return () => promptListeners.delete(listener);
}

/** Internal handoff from the early native owner to any visible install surface. */
export function publishA2hsAppInstalled(): void {
  clearA2hsInstallPrompt();
  for (const listener of installedListeners) listener();
}

export function subscribeA2hsAppInstalled(listener: InstalledListener): () => void {
  installedListeners.add(listener);
  return () => installedListeners.delete(listener);
}
