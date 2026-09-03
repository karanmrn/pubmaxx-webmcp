import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSupabaseBrowser, isAuthConfigured } = vi.hoisted(() => ({
  getSupabaseBrowser: vi.fn(),
  isAuthConfigured: vi.fn(),
}));

vi.mock("@/lib/authClient", () => ({ getSupabaseBrowser, isAuthConfigured }));

import { subscribeToMessages } from "@/lib/messagesRealtime";

type StatusCallback = (status: string) => void;
type SignalCallback = () => void;

function realtimeFixture(options?: {
  removeChannel?: (channel: unknown) => void;
  subscribe?: (callback: StatusCallback) => void;
}) {
  let signal: SignalCallback = () => {};
  let status: StatusCallback = () => {};
  const channel = {
    on: vi.fn((_event, _filter, callback: SignalCallback) => {
      signal = callback;
      return channel;
    }),
    subscribe: vi.fn((callback: StatusCallback) => {
      status = callback;
      options?.subscribe?.(callback);
      return channel;
    }),
  };
  const removeChannel = vi.fn(options?.removeChannel ?? (() => {}));
  const client = {
    channel: vi.fn(() => channel),
    removeChannel,
  };

  return {
    channel,
    client,
    removeChannel,
    emitSignal: () => signal(),
    emitStatus: (nextStatus: string) => status(nextStatus),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  getSupabaseBrowser.mockReset();
  isAuthConfigured.mockReset();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("message realtime subscription", () => {
  it("returns a pure no-op for a missing conversation id", () => {
    const unsubscribe = subscribeToMessages("", vi.fn(), { poll: vi.fn() });

    unsubscribe();
    vi.advanceTimersByTime(20_000);
    expect(getSupabaseBrowser).not.toHaveBeenCalled();
  });

  it("degrades to a cancellable polling interval when realtime is unavailable", () => {
    const poll = vi.fn();
    getSupabaseBrowser.mockReturnValue(null);

    const unsubscribe = subscribeToMessages("conversation-1", vi.fn(), { poll });

    vi.advanceTimersByTime(20_000);
    expect(poll).toHaveBeenCalledTimes(2);
    expect(isAuthConfigured).not.toHaveBeenCalled();

    unsubscribe();
    vi.advanceTimersByTime(10_000);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("does nothing when realtime is unavailable and no poll fallback was supplied", () => {
    getSupabaseBrowser.mockReturnValue(null);

    const unsubscribe = subscribeToMessages("conversation-1", vi.fn());

    expect(() => unsubscribe()).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("subscribes only to inserts for the requested conversation and emits no payload", () => {
    const fixture = realtimeFixture();
    const onMessage = vi.fn();
    getSupabaseBrowser.mockReturnValue(fixture.client);
    isAuthConfigured.mockReturnValue(true);

    const unsubscribe = subscribeToMessages("conversation-42", onMessage);

    expect(fixture.client.channel).toHaveBeenCalledWith("live:messages:conversation-42");
    expect(fixture.channel.on).toHaveBeenCalledWith(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: "conversation_id=eq.conversation-42",
      },
      expect.any(Function),
    );

    fixture.emitSignal();
    expect(onMessage).toHaveBeenCalledOnce();
    expect(onMessage).toHaveBeenCalledWith();

    unsubscribe();
    fixture.emitSignal();
    expect(onMessage).toHaveBeenCalledOnce();
    expect(fixture.removeChannel).toHaveBeenCalledWith(fixture.channel);
  });

  it("keeps realtime active after a successful join", () => {
    const fixture = realtimeFixture();
    const poll = vi.fn();
    getSupabaseBrowser.mockReturnValue(fixture.client);
    isAuthConfigured.mockReturnValue(true);

    const unsubscribe = subscribeToMessages("conversation-1", vi.fn(), { poll });
    fixture.emitStatus("SUBSCRIBED");
    vi.advanceTimersByTime(20_000);

    expect(poll).not.toHaveBeenCalled();
    expect(fixture.removeChannel).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("falls back to polling when the join times out", () => {
    const fixture = realtimeFixture();
    const poll = vi.fn();
    getSupabaseBrowser.mockReturnValue(fixture.client);
    isAuthConfigured.mockReturnValue(true);

    const unsubscribe = subscribeToMessages("conversation-1", vi.fn(), { poll });
    vi.advanceTimersByTime(5_000);

    expect(fixture.removeChannel).toHaveBeenCalledOnce();
    expect(fixture.removeChannel).toHaveBeenCalledWith(fixture.channel);
    vi.advanceTimersByTime(20_000);
    expect(poll).toHaveBeenCalledTimes(2);

    unsubscribe();
    vi.advanceTimersByTime(10_000);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it.each(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"])(
    "falls back exactly once when the channel reports %s",
    (failureStatus) => {
      const fixture = realtimeFixture();
      const poll = vi.fn();
      getSupabaseBrowser.mockReturnValue(fixture.client);
      isAuthConfigured.mockReturnValue(true);

      subscribeToMessages("conversation-1", vi.fn(), { poll });
      fixture.emitStatus(failureStatus);
      fixture.emitStatus("CLOSED");
      vi.advanceTimersByTime(20_000);

      expect(fixture.removeChannel).toHaveBeenCalledOnce();
      expect(poll).toHaveBeenCalledTimes(2);
    },
  );

  it("guards synchronous CLOSED re-entry while removing a failed channel", () => {
    let emitClosed = () => {};
    const fixture = realtimeFixture({ removeChannel: () => emitClosed() });
    emitClosed = () => fixture.emitStatus("CLOSED");
    const poll = vi.fn();
    getSupabaseBrowser.mockReturnValue(fixture.client);
    isAuthConfigured.mockReturnValue(true);

    subscribeToMessages("conversation-1", vi.fn(), { poll });
    fixture.emitStatus("CHANNEL_ERROR");
    vi.advanceTimersByTime(10_000);

    expect(fixture.removeChannel).toHaveBeenCalledOnce();
    expect(poll).toHaveBeenCalledOnce();
  });

  it("fails soft and polls when channel setup throws", () => {
    const poll = vi.fn();
    const client = {
      channel: vi.fn(() => {
        throw new Error("websocket blocked");
      }),
      removeChannel: vi.fn(),
    };
    getSupabaseBrowser.mockReturnValue(client);
    isAuthConfigured.mockReturnValue(true);

    expect(() => subscribeToMessages("conversation-1", vi.fn(), { poll })).not.toThrow();
    vi.advanceTimersByTime(10_000);

    expect(poll).toHaveBeenCalledOnce();
    expect(client.removeChannel).not.toHaveBeenCalled();
  });

  it("fails soft when removing a channel throws during fallback or cleanup", () => {
    const fixture = realtimeFixture({
      removeChannel: () => {
        throw new Error("already removed");
      },
    });
    getSupabaseBrowser.mockReturnValue(fixture.client);
    isAuthConfigured.mockReturnValue(true);

    const unsubscribeAfterFailure = subscribeToMessages("conversation-1", vi.fn(), {
      poll: vi.fn(),
    });
    expect(() => fixture.emitStatus("CLOSED")).not.toThrow();
    expect(() => unsubscribeAfterFailure()).not.toThrow();

    const second = realtimeFixture({
      removeChannel: () => {
        throw new Error("already removed");
      },
    });
    getSupabaseBrowser.mockReturnValue(second.client);
    const unsubscribeWhileLive = subscribeToMessages("conversation-2", vi.fn());
    expect(() => unsubscribeWhileLive()).not.toThrow();
  });

  it("cancels a pending join without starting fallback polling", () => {
    const fixture = realtimeFixture();
    const poll = vi.fn();
    getSupabaseBrowser.mockReturnValue(fixture.client);
    isAuthConfigured.mockReturnValue(true);

    const unsubscribe = subscribeToMessages("conversation-1", vi.fn(), { poll });
    unsubscribe();
    vi.advanceTimersByTime(20_000);
    fixture.emitStatus("CLOSED");

    expect(poll).not.toHaveBeenCalled();
    expect(fixture.removeChannel).toHaveBeenCalledOnce();
  });
});
