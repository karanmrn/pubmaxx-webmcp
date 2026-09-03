// Loading the browser auth client is a READ, and a read that could not run
// answers neither state.
//
// The Supabase browser client is a lazily imported chunk (lib/authClient.ts).
// When that import fails - a deploy has just moved the chunk URLs out from
// under a tab, a phone drops its connection mid-download - the load REJECTS.
// AuthProvider had no handler for that, so the rejection went unhandled, the
// 20 second bootstrap ceiling fired instead, and the app published a confident
// "signed out" for the life of the tab while the account's session sat intact
// in local storage. Every page then painted its signed-out variant.
//
// Three outcomes, never two:
//   ready         - the client is here.
//   unconfigured  - the public Supabase env is absent. A truthful answer: this
//                   deployment has no browser auth, so signed-out is honest.
//   unavailable   - we could not look. Publish NOTHING about the viewer.

export type AuthClientLoadOutcome<TClient> =
  | { status: "ready"; client: TClient }
  | { status: "unconfigured" }
  | { status: "unavailable" };

/**
 * Backoff between attempts. Short enough that an ordinary flaky download is
 * recovered well inside the bootstrap ceiling, and bounded so a genuinely
 * broken deployment settles rather than retrying for the life of the tab.
 */
export const AUTH_CLIENT_LOAD_RETRY_DELAYS_MS: readonly number[] = [400, 1_600, 4_000];
export const AUTH_CLIENT_LOAD_TIMEOUT_MS = 15_000;

export type AuthClientLoadDeps = {
  /** Resolve after `ms`. Injected so the policy is testable without timers. */
  delay: (ms: number) => Promise<void>;
  /** Overrides the backoff table. Tests pass an empty list for no waiting. */
  retryDelaysMs?: readonly number[];
  timeoutMs?: number;
};

/**
 * Load the browser auth client, retrying a REJECTED load with bounded backoff.
 *
 * A null resolution is not retried: that is the env answering, and it will
 * answer the same way every time. Only a thrown load is retried, because that
 * is the transport rather than the configuration.
 */
export async function loadAuthClientWithRetry<TClient>(
  load: () => Promise<TClient | null>,
  deps: AuthClientLoadDeps,
): Promise<AuthClientLoadOutcome<TClient>> {
  const delays = deps.retryDelaysMs ?? AUTH_CLIENT_LOAD_RETRY_DELAYS_MS;
  const attempts = (async (): Promise<AuthClientLoadOutcome<TClient>> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const client = await load();
        if (client === null) return { status: "unconfigured" };
        return { status: "ready", client };
      } catch {
        if (attempt >= delays.length) return { status: "unavailable" };
        await deps.delay(delays[attempt] ?? 0);
      }
    }
  })();

  const timeoutMs = deps.timeoutMs ?? AUTH_CLIENT_LOAD_TIMEOUT_MS;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<AuthClientLoadOutcome<TClient>>((resolve) => {
    timeout = setTimeout(() => resolve({ status: "unavailable" }), timeoutMs);
  });

  try {
    return await Promise.race([attempts, deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
