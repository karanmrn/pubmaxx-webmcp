import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearA2hsInstallPrompt,
  consumeA2hsInstallPrompt,
  getA2hsInstallPrompt,
  storeA2hsInstallPrompt,
  subscribeA2hsInstallPrompt,
  type BeforeInstallPromptEvent,
} from "@/lib/a2hsInstallEvent";

function makeInstallEvent(): BeforeInstallPromptEvent {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  return Object.assign(event, {
    platforms: ["web"],
    prompt: vi.fn(() => Promise.resolve()),
    userChoice: Promise.resolve({ outcome: "dismissed" as const, platform: "web" }),
  });
}

afterEach(() => {
  clearA2hsInstallPrompt();
});

describe("A2HS install event handoff", () => {
  it("retains an event captured before the lazy consumer subscribes", () => {
    const event = makeInstallEvent();
    storeA2hsInstallPrompt(event);

    const listener = vi.fn();
    const unsubscribe = subscribeA2hsInstallPrompt(listener);

    expect(getA2hsInstallPrompt()).toBe(event);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("publishes future captures and consumes each event once", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeA2hsInstallPrompt(listener);
    const event = makeInstallEvent();

    storeA2hsInstallPrompt(event);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(consumeA2hsInstallPrompt()).toBe(event);
    expect(getA2hsInstallPrompt()).toBeNull();
    expect(consumeA2hsInstallPrompt()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
  });
});
