import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

type Listener = (event: unknown) => void;

function workerHarness() {
  const listeners = new Map<string, Listener>();
  const showNotification = vi.fn(async () => undefined);
  const openWindow = vi.fn(async () => undefined);
  const fakeSelf = {
    location: { href: "https://pubmaxxing.com/sw.js?v=test", origin: "https://pubmaxxing.com" },
    registration: { showNotification },
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => []),
      openWindow,
    },
    addEventListener(type: string, listener: Listener) {
      listeners.set(type, listener);
    },
  };
  const fakeCaches = { open: vi.fn(), keys: vi.fn() };
  const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
  Function("self", "caches", source)(fakeSelf, fakeCaches);
  return { listeners, showNotification, openWindow };
}

describe("service worker web push", () => {
  it("shows a payload and reduces external click-through to /today", async () => {
    const { listeners, showNotification } = workerHarness();
    let pending: Promise<unknown> = Promise.resolve();
    listeners.get("push")!({
      data: { json: () => ({
        title: "Today in London",
        body: "Warm and dry.",
        tag: "daily-brief",
        data: { url: "https://evil.example/steal" },
      }) },
      waitUntil(value: Promise<unknown>) { pending = value; },
    });
    await pending;
    expect(showNotification).toHaveBeenCalledWith("Today in London", expect.objectContaining({
      body: "Warm and dry.",
      tag: "daily-brief",
      data: { url: "/today" },
    }));
  });

  it("shows a useful fallback for a malformed push", async () => {
    const { listeners, showNotification } = workerHarness();
    let pending: Promise<unknown> = Promise.resolve();
    listeners.get("push")!({
      data: { json: () => { throw new Error("bad json"); } },
      waitUntil(value: Promise<unknown>) { pending = value; },
    });
    await pending;
    expect(showNotification).toHaveBeenCalledWith("PUBMAXX", expect.objectContaining({
      body: "Your London brief is ready.",
      data: { url: "/today" },
    }));
  });

  it.each([null, [], "text", 42])(
    "normalizes non-object JSON payload %j to the fallback",
    async (payload) => {
      const { listeners, showNotification } = workerHarness();
      let pending: Promise<unknown> = Promise.resolve();
      listeners.get("push")!({
        data: { json: () => payload },
        waitUntil(value: Promise<unknown>) { pending = value; },
      });
      await pending;
      expect(showNotification).toHaveBeenCalledWith("PUBMAXX", expect.objectContaining({
        body: "Your London brief is ready.",
        data: { url: "/today" },
      }));
    },
  );

  it("normalizes array notification data instead of reading array properties", async () => {
    const { listeners, showNotification } = workerHarness();
    let pending: Promise<unknown> = Promise.resolve();
    const data: unknown[] & { url?: string } = [];
    data.url = "/should-not-open";
    listeners.get("push")!({
      data: { json: () => ({ data }) },
      waitUntil(value: Promise<unknown>) { pending = value; },
    });
    await pending;
    expect(showNotification).toHaveBeenCalledWith("PUBMAXX", expect.objectContaining({
      data: { url: "/today" },
    }));
  });

  it("opens only a same-origin URL when the notification is clicked", async () => {
    const { listeners, openWindow } = workerHarness();
    let pending: Promise<unknown> = Promise.resolve();
    const close = vi.fn();
    listeners.get("notificationclick")!({
      notification: { data: { url: "/tonight?from=push" }, close },
      waitUntil(value: Promise<unknown>) { pending = value; },
    });
    await pending;
    expect(close).toHaveBeenCalledOnce();
    expect(openWindow).toHaveBeenCalledWith("https://pubmaxxing.com/tonight?from=push");
  });
});
