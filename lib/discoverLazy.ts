export type DiscoverLazyWindow = {
  IntersectionObserver?: typeof IntersectionObserver;
  requestIdleCallback?: (
    callback: IdleRequestCallback,
    options?: IdleRequestOptions,
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
  setTimeout?: (callback: () => void, delay?: number) => number;
  clearTimeout?: (handle: number) => void;
};

export type DiscoverLoadStatus = "idle" | "loading" | "ready" | "error";

type ScheduleDiscoverAnalysisLoadOptions = {
  start: () => void;
  target: Element | null;
  win?: DiscoverLazyWindow;
  rootMargin?: string;
  idleDelayMs?: number;
};

type RunDiscoverAnalysisLoadOptions<TDataset, TDrops> = {
  signal: AbortSignal;
  setStatus: (status: Exclude<DiscoverLoadStatus, "idle">) => void;
  loadDataset: () => Promise<TDataset>;
  applyDataset: (dataset: TDataset) => void;
  loadDrops: (dataset: TDataset) => Promise<TDrops>;
  applyDrops: (dataset: TDataset, drops: TDrops) => void;
  isAbortError?: (error: unknown) => boolean;
  onDropsError?: (error: unknown, dataset: TDataset) => void;
};

const DEFAULT_ROOT_MARGIN = "240px 0px";
const DEFAULT_IDLE_DELAY_MS = 1500;

function defaultIsAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export async function runDiscoverAnalysisLoad<TDataset, TDrops>({
  signal,
  setStatus,
  loadDataset,
  applyDataset,
  loadDrops,
  applyDrops,
  isAbortError = defaultIsAbortError,
  onDropsError,
}: RunDiscoverAnalysisLoadOptions<TDataset, TDrops>): Promise<void> {
  const isAborted = () => signal.aborted;

  setStatus("loading");

  try {
    const dataset = await loadDataset();
    if (isAborted()) return;
    applyDataset(dataset);

    try {
      const drops = await loadDrops(dataset);
      if (isAborted()) return;
      applyDrops(dataset, drops);
      if (isAborted()) return;
      setStatus("ready");
    } catch (error) {
      if (isAborted() || isAbortError(error)) return;
      onDropsError?.(error, dataset);
      setStatus("ready");
    }
  } catch (error) {
    if (isAborted() || isAbortError(error)) return;
    setStatus("error");
  }
}

export function scheduleDiscoverAnalysisLoad({
  start,
  target,
  win = typeof window === "undefined" ? undefined : window,
  rootMargin = DEFAULT_ROOT_MARGIN,
  idleDelayMs = DEFAULT_IDLE_DELAY_MS,
}: ScheduleDiscoverAnalysisLoadOptions): () => void {
  let started = false;
  let cleaned = false;
  const cleanupFns: Array<() => void> = [];

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    for (const cleanupFn of cleanupFns) cleanupFn();
  };

  const startOnce = () => {
    if (cleaned) return;
    if (started) return;
    started = true;
    cleanup();
    start();
  };

  if (!win) return cleanup;

  if (target && win.IntersectionObserver) {
    const observer = new win.IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) startOnce();
    }, { rootMargin });

    observer.observe(target);
    cleanupFns.push(() => observer.disconnect());
  }

  if (win.requestIdleCallback) {
    const idleId = win.requestIdleCallback(() => startOnce(), {
      timeout: idleDelayMs,
    });
    cleanupFns.push(() => win.cancelIdleCallback?.(idleId));
    return cleanup;
  }

  const timeoutId = win.setTimeout?.(() => startOnce(), idleDelayMs);
  if (typeof timeoutId === "number") {
    cleanupFns.push(() => win.clearTimeout?.(timeoutId));
  }
  return cleanup;
}
