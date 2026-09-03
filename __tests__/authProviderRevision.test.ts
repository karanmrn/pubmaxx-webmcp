import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createProviderIdentityRevisionStore,
  resolveSupabaseAuthState,
  type ProviderAuthState,
} from "@/lib/authProviderRevision";

afterEach(() => {
  vi.useRealTimers();
});

describe("provider identity revision", () => {
  it("increments only when the combined provider identity changes", () => {
    const store = createProviderIdentityRevisionStore();

    expect(store.read()).toBe(0);
    expect(store.set("clerk", "clerk-actor-a")).toBe(1);
    expect(store.set("clerk", "clerk-actor-a")).toBe(1);
    expect(store.set("supabase", "supabase-actor-a")).toBe(2);
    expect(store.set("clerk", "clerk-actor-b")).toBe(3);
    expect(store.set("clerk", null)).toBe(4);
  });

  it("notifies subscribers after either provider changes", () => {
    const store = createProviderIdentityRevisionStore();
    const revisions: number[] = [];
    const unsubscribe = store.subscribe(() => revisions.push(store.read()));

    store.set("clerk", "clerk-actor-a");
    store.set("supabase", "supabase-actor-a");
    store.set("supabase", "supabase-actor-a");
    unsubscribe();
    store.set("clerk", null);

    expect(revisions).toEqual([1, 2]);
  });

  it("aborts the old provider revision signal and rotates to a live signal", () => {
    const store = createProviderIdentityRevisionStore();
    const before = store.signal();
    const callbackOrder: string[] = [];
    const signalsAtNotification: AbortSignal[] = [];
    before.addEventListener("abort", () => callbackOrder.push("abort"), {
      once: true,
    });
    store.subscribe(() => {
      callbackOrder.push("notify");
      signalsAtNotification.push(store.signal());
      expect(before.aborted).toBe(true);
      expect(store.signal().aborted).toBe(false);
    });
    expect(before.aborted).toBe(false);

    store.set("supabase", "supabase-actor-a");

    const after = store.signal();
    expect(callbackOrder).toEqual(["abort", "notify"]);
    expect(signalsAtNotification).toEqual([after]);
    expect(before.aborted).toBe(true);
    expect(before.reason).toMatchObject({ name: "AbortError" });
    expect(after).not.toBe(before);
    expect(after.aborted).toBe(false);

    store.set("supabase", "supabase-actor-a");
    expect(store.signal()).toBe(after);
  });

  it("publishes provider authentication readiness without exposing provider identity", () => {
    const store = createProviderIdentityRevisionStore();

    expect(store.authState("clerk")).toBe("unresolved");
    expect(store.setAuthState("clerk", "signed-out")).toBe(1);
    expect(store.authState("clerk")).toBe("signed-out");
    expect(store.setAuthState("clerk", "authenticated")).toBe(2);
    expect(store.authState("clerk")).toBe("authenticated");
  });

  it("keeps Supabase unresolved for a null INITIAL_SESSION event", () => {
    expect(resolveSupabaseAuthState("initial-session", false, null)).toBe("unresolved");
  });

  it("settles signed-out after bootstrap proves no account exists", () => {
    expect(resolveSupabaseAuthState("bootstrap", false, null)).toBe("signed-out");
  });

  it("does not let a bootstrap timeout replace an authenticated session", () => {
    vi.useFakeTimers();
    let state: ProviderAuthState = "unresolved";
    let currentUserId: string | null = null;

    const timeout = setTimeout(() => {
      const next = resolveSupabaseAuthState("timeout", currentUserId !== null, currentUserId);
      if (next) state = next;
    }, 20_000);

    const sessionEvent = resolveSupabaseAuthState("auth-event", true, "supabase-user-a");
    currentUserId = "supabase-user-a";
    if (sessionEvent) state = sessionEvent;
    vi.advanceTimersByTime(20_000);

    expect(state).toBe("authenticated");
    clearTimeout(timeout);
  });
});
