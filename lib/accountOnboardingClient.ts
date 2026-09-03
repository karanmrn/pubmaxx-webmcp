import { authedActionFetch } from "@/lib/authedFetch";

type AccountOnboardingRequest = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type AccountOnboardingStatus =
  | { status: "complete"; handle?: string }
  | { status: "incomplete"; handle?: string }
  | { status: "interrupted" }
  | { status: "unavailable"; error: string };

export const ACCOUNT_ONBOARDING_RETRY_DELAY_MS = 250;
export const ACCOUNT_ONBOARDING_RETRY_DELAYS_MS = [
  ACCOUNT_ONBOARDING_RETRY_DELAY_MS,
  1_500,
] as const;

type AccountHandleAvailability =
  | { status: "available" }
  | { status: "taken" }
  | { status: "unavailable"; error: string };

export async function loadAccountOnboardingStatus(
  request: AccountOnboardingRequest = authedActionFetch,
  signal?: AbortSignal,
): Promise<AccountOnboardingStatus> {
  try {
    const response = await request("/api/identity/onboarding", {
      cache: "no-store",
      signal,
    });
    const body = (await response.json().catch(() => ({}))) as {
      complete?: unknown;
      handle?: unknown;
      error?: unknown;
    };
    if (!response.ok) {
      return {
        status: "unavailable",
        error:
          typeof body.error === "string"
            ? body.error
            : "Account setup is unavailable right now.",
      };
    }
    const handle =
      typeof body.handle === "string" && body.handle.trim()
        ? body.handle
        : undefined;
    return body.complete === true
      ? { status: "complete", ...(handle ? { handle } : {}) }
      : {
          status: "incomplete",
          ...(handle ? { handle } : {}),
        };
  } catch (error) {
    if ((error as { name?: unknown })?.name === "AbortError") {
      return { status: "interrupted" };
    }
    return {
      status: "unavailable",
      error: "Account setup is unavailable right now.",
    };
  }
}

function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      timer = null;
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, delayMs);
    const onAbort = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      resolve(false);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * A session-backed status read can cross the last edge of auth restoration.
 * Keep that transient failure out of the UI with one bounded, abort-safe retry.
 */
export async function loadAccountOnboardingStatusWithRetry(
  request: AccountOnboardingRequest = authedActionFetch,
  signal?: AbortSignal,
): Promise<AccountOnboardingStatus> {
  let result = await loadAccountOnboardingStatus(request, signal);
  for (const delayMs of ACCOUNT_ONBOARDING_RETRY_DELAYS_MS) {
    if (result.status !== "unavailable" || signal?.aborted) return result;
    if (!(await waitForRetry(delayMs, signal))) return result;
    result = await loadAccountOnboardingStatus(request, signal);
  }
  return result;
}

export async function checkAccountHandleAvailability(
  handle: string,
  request: AccountOnboardingRequest = fetch,
  signal?: AbortSignal,
): Promise<AccountHandleAvailability> {
  try {
    const query = new URLSearchParams({ handle });
    const response = await request(
      `/api/identity/handle/availability?${query.toString()}`,
      { cache: "no-store", signal },
    );
    const body = (await response.json().catch(() => ({}))) as {
      available?: unknown;
      reason?: unknown;
      error?: unknown;
    };
    if (!response.ok) {
      return {
        status: "unavailable",
        error:
          typeof body.error === "string"
            ? body.error
            : "Could not check that handle. Try again.",
      };
    }
    if (body.available === true) return { status: "available" };
    if (body.available === false && body.reason === "taken") {
      return { status: "taken" };
    }
    return {
      status: "unavailable",
      error: "Could not check that handle. Try again.",
    };
  } catch (error) {
    if ((error as { name?: unknown })?.name === "AbortError") {
      return {
        status: "unavailable",
        error: "Handle check was interrupted.",
      };
    }
    return {
      status: "unavailable",
      error: "Could not check that handle. Try again.",
    };
  }
}
