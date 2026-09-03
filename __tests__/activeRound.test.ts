import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACTIVE_ROUND_KEY,
  clearActiveRoundCode,
  normalizeRoundCodeForStorage,
  readActiveRoundCode,
  writeActiveRoundCode,
} from "@/lib/activeRound";

type WindowLike = { localStorage: Storage };

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
  (globalThis as { window?: WindowLike }).window = { localStorage: storage };
}

function clearWindow(): void {
  delete (globalThis as { window?: WindowLike }).window;
}

afterEach(() => {
  clearWindow();
});

describe("activeRound storage", () => {
  beforeEach(() => {
    installWindow(makeMemoryStorage());
  });

  it("reads empty when unset", () => {
    expect(readActiveRoundCode()).toBe("");
  });

  it("round-trips a write", () => {
    writeActiveRoundCode("jxkq7m");
    expect(readActiveRoundCode()).toBe("JXKQ7M");
    expect(window.localStorage.getItem(ACTIVE_ROUND_KEY)).toBe("JXKQ7M");
  });

  it("normalizes for storage (trim + uppercase + alphabet filter)", () => {
    expect(normalizeRoundCodeForStorage(" jxkq-7m ")).toBe("JXKQ7M");
    writeActiveRoundCode(" jxkq7m ");
    expect(readActiveRoundCode()).toBe("JXKQ7M");
  });

  it("ignores invalid codes on write", () => {
    writeActiveRoundCode("short");
    expect(readActiveRoundCode()).toBe("");
    expect(window.localStorage.getItem(ACTIVE_ROUND_KEY)).toBeNull();
  });

  it("clears unconditionally", () => {
    writeActiveRoundCode("JXKQ7M");
    clearActiveRoundCode();
    expect(readActiveRoundCode()).toBe("");
    expect(window.localStorage.getItem(ACTIVE_ROUND_KEY)).toBeNull();
  });

  it("clear onlyIfMatches leaves other codes alone", () => {
    writeActiveRoundCode("JXKQ7M");
    clearActiveRoundCode("OTHER1");
    expect(readActiveRoundCode()).toBe("JXKQ7M");
    clearActiveRoundCode("jxkq7m");
    expect(readActiveRoundCode()).toBe("");
  });

  it("returns empty on SSR (no window)", () => {
    clearWindow();
    expect(readActiveRoundCode()).toBe("");
    writeActiveRoundCode("JXKQ7M");
    expect(readActiveRoundCode()).toBe("");
  });

  it("returns empty when storage throws", () => {
    const storage = makeMemoryStorage();
    vi.spyOn(storage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    installWindow(storage);
    expect(readActiveRoundCode()).toBe("");
  });
});
