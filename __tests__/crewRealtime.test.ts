import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (payload: unknown) => void;
let changeHandler: Handler | null = null;
let statusHandler: ((status: string) => void) | null = null;

const channel = {
  on(_event: string, _filter: unknown, handler: Handler) {
    changeHandler = handler;
    return this;
  },
  subscribe(handler: (status: string) => void) {
    statusHandler = handler;
    return this;
  },
};
const client = { channel: () => channel, removeChannel: vi.fn() };

vi.mock("@/lib/authClient", () => ({
  getSupabaseBrowser: () => client,
  isAuthConfigured: () => true,
}));

import { subscribeToPlanCrew } from "@/lib/crewRealtime";

beforeEach(() => {
  vi.useFakeTimers();
  changeHandler = null;
  statusHandler = null;
  client.removeChannel.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("Plan crew realtime", () => {
  it("treats database events as payload-free signals", () => {
    const refetch = vi.fn();
    const unsubscribe = subscribeToPlanCrew("plan-1", refetch);
    statusHandler?.("SUBSCRIBED");
    changeHandler?.({ new: { name: "must not leak", token_hash: "secret" } });
    expect(refetch).toHaveBeenCalledOnce();
    expect(refetch.mock.calls[0]).toHaveLength(0);
    unsubscribe();
  });

  it("falls back to polling when realtime cannot join", () => {
    const poll = vi.fn();
    const unsubscribe = subscribeToPlanCrew("plan-1", () => {}, { poll });
    vi.advanceTimersByTime(5_000);
    vi.advanceTimersByTime(30_000);
    expect(poll).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("keeps a safety poll when RLS makes a subscribed channel silent", () => {
    const poll = vi.fn();
    const unsubscribe = subscribeToPlanCrew("plan-1", () => {}, { poll });
    statusHandler?.("SUBSCRIBED");
    vi.advanceTimersByTime(30_000);
    expect(poll).toHaveBeenCalledOnce();
    unsubscribe();
  });
});
