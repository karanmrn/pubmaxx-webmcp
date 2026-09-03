import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  markCheapPintPingQualified,
  syncCheapPintPingPromptFromServer,
} from "@/lib/cheapPintPingPrompt";

function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
}

function installWindow(storage: Storage): void {
  (globalThis as { window?: { localStorage: Storage } }).window = { localStorage: storage };
}

function readQualified(storage: Storage): boolean {
  return storage.getItem("pubmax:cheap-pint-ping:qualified:v1") === "1";
}

function readDismissed(storage: Storage): boolean {
  return storage.getItem("pubmax:cheap-pint-ping:dismissed:v1") === "1";
}

function readEnabled(storage: Storage): boolean {
  return storage.getItem("pubmax:cheap-pint-ping:enabled:v1") === "1";
}

describe("cheap pint ping prompt server sync", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = makeMemoryStorage();
    installWindow(storage);
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "test-vapid");
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    vi.unstubAllEnvs();
  });

  it("marks qualified when the server says canPrompt", () => {
    syncCheapPintPingPromptFromServer({ canPrompt: true });
    expect(readQualified(storage)).toBe(true);
    expect(readDismissed(storage)).toBe(false);
    expect(readEnabled(storage)).toBe(false);
  });

  it("clears stale qualified when the account declined on the server", () => {
    markCheapPintPingQualified();
    expect(readQualified(storage)).toBe(true);

    syncCheapPintPingPromptFromServer({ declined: true });
    expect(readQualified(storage)).toBe(false);
    expect(readDismissed(storage)).toBe(true);
  });

  it("marks enabled when the account opted in on another device", () => {
    markCheapPintPingQualified();
    syncCheapPintPingPromptFromServer({ enabled: true });
    expect(readEnabled(storage)).toBe(true);
    expect(readQualified(storage)).toBe(false);
    expect(readDismissed(storage)).toBe(false);
  });
});
