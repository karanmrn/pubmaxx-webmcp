export const DEPLOYMENT_SKEW_RELOAD_KEY = "pubmax:deployment-skew-reloaded:v1";

/**
 * Ask the recovery component to check the deployment now, rather than at the
 * next tab wake. A browser that cannot load a lazily imported chunk is the
 * strongest evidence of a stale document there is, and a drinker who is
 * actively browsing through a deploy never fires a wake event at all.
 */
export const DEPLOYMENT_SKEW_CHECK_EVENT = "pubmax:deployment-skew-check";

/** Fire that ask. Safe on the server and in a browser with no listener. */
export function requestDeploymentSkewCheck(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(DEPLOYMENT_SKEW_CHECK_EVENT));
  } catch {
    // A browser that refuses a synthetic event simply waits for the next wake.
  }
}

export type DeploymentSkewRecoveryResult =
  | "same"
  | "reloaded"
  | "guarded"
  | "deferred"
  | "unavailable";

export type DeploymentSkewStorage = Pick<Storage, "getItem" | "setItem">;

export type DeploymentSkewRecoveryInput = {
  clientDeploymentId: string | null;
  currentDeploymentId: string | null;
  storage: DeploymentSkewStorage | null;
  isDirty: () => boolean;
  reload: () => void;
};

type DirtyControl = {
  tagName?: string;
  type?: string;
  value?: string;
  defaultValue?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  files?: { length: number } | null;
  options?: ArrayLike<{ selected: boolean; defaultSelected: boolean }>;
  isContentEditable?: boolean;
  contentEditable?: string;
  textContent?: string | null;
};

type DirtyDocument = Pick<Document, "querySelectorAll">;

/**
 * Return true when a user-editable browser control no longer matches its
 * initial value. This is a conservative boundary for automatic recovery:
 * navigation still loads the current deployment, but a wake never destroys
 * input that the user has started to enter.
 */
export function hasUnsavedUserInput(documentTarget: DirtyDocument): boolean {
  const controls = Array.from(
    documentTarget.querySelectorAll(
      "input, textarea, select, [contenteditable='true']",
    ),
  ) as unknown as DirtyControl[];

  return controls.some((control) => {
    const tagName = control.tagName?.toLowerCase();
    if (tagName === "input") {
      const type = control.type?.toLowerCase();
      if (["button", "hidden", "reset", "submit"].includes(type ?? "")) {
        return false;
      }
      if (type === "checkbox" || type === "radio") {
        return control.checked !== control.defaultChecked;
      }
      if (type === "file") return Boolean(control.files?.length);
      return control.value !== control.defaultValue;
    }
    if (tagName === "textarea") {
      return control.value !== control.defaultValue;
    }
    if (tagName === "select") {
      const options = control.options ? Array.from(control.options) : [];
      return options.some((option) => option.selected !== option.defaultSelected);
    }
    if (control.isContentEditable || control.contentEditable === "true") {
      return Boolean(control.textContent?.trim());
    }
    return false;
  });
}

export function recoverDeploymentSkew({
  clientDeploymentId,
  currentDeploymentId,
  storage,
  isDirty,
  reload,
}: DeploymentSkewRecoveryInput): DeploymentSkewRecoveryResult {
  if (!clientDeploymentId || !currentDeploymentId) return "unavailable";
  if (clientDeploymentId === currentDeploymentId) return "same";
  if (!storage) return "unavailable";

  const guardKey = `${DEPLOYMENT_SKEW_RELOAD_KEY}:${currentDeploymentId}`;
  try {
    if (storage.getItem(guardKey) === "1") return "guarded";
    if (isDirty()) return "deferred";
    storage.setItem(guardKey, "1");
  } catch {
    // A storage failure makes a one-shot guard impossible. Keep the stale tab
    // interactive instead of risking an automatic reload loop.
    return "unavailable";
  }

  reload();
  return "reloaded";
}

export function getClientDeploymentId(): string | null {
  const nextDeploymentId = (globalThis as typeof globalThis & {
    NEXT_DEPLOYMENT_ID?: unknown;
  }).NEXT_DEPLOYMENT_ID;
  if (typeof nextDeploymentId === "string" && nextDeploymentId) {
    return nextDeploymentId;
  }
  const publicBuildId = process.env.NEXT_PUBLIC_SW_VERSION;
  return typeof publicBuildId === "string" && publicBuildId ? publicBuildId : null;
}

export function getSessionStorage(): DeploymentSkewStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export async function fetchCurrentDeploymentId(
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const response = await fetcher("/api/version", {
      cache: "no-store",
      headers: { "cache-control": "no-cache" },
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!body || typeof body !== "object") return null;
    const deploymentId = (body as { deploymentId?: unknown }).deploymentId;
    return typeof deploymentId === "string" && deploymentId ? deploymentId : null;
  } catch {
    return null;
  }
}
