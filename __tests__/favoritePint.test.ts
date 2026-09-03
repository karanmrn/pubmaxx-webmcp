import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Pure-ish coverage for lib/favoritePint.ts — the demo "favourite pint"
// preference. It is a thin localStorage wrapper, but its wrapper LOGIC is worth
// pinning: an SSR guard (server / no-storage reads return null, writes are
// no-ops), a blank-value → null normalization on read, and a silent-degrade
// try/catch on both read and write so a throwing / private-mode storage never
// surfaces an error.
//
// vitest runs in the `node` environment, so there is no `window` by default —
// exactly the server/SSR case. We install a minimal in-memory `window.localStorage`
// stub for the "storage present" cases and delete it again in afterEach so the
// SSR-guard cases see a true absence. We re-import a fresh module copy per case
// (resetModules) is unnecessary here because the module holds no module-level
// state — all state lives in the (stubbed) storage.

import { getFavoritePint, setFavoritePint, clearFavoritePint } from "@/lib/favoritePint";

const STORAGE_KEY = "pubmax:favoritePint:v1";

type WindowLike = { localStorage: Storage };

// A tiny spec-shaped localStorage backed by a Map — enough for get/set/remove.
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

// A storage whose every access throws — the private-mode / disabled case.
function makeThrowingStorage(): Storage {
  const boom = () => {
    throw new Error("SecurityError: storage disabled");
  };
  return {
    length: 0,
    clear: boom,
    getItem: boom,
    key: boom,
    removeItem: boom,
    setItem: boom,
  } as unknown as Storage;
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

describe("favoritePint — storage present (browser case)", () => {
  beforeEach(() => {
    installWindow(makeMemoryStorage());
  });

  it("get returns null when nothing has been set", () => {
    expect(getFavoritePint()).toBeNull();
  });

  it("round-trips a set value through get", () => {
    setFavoritePint("guinness");
    expect(getFavoritePint()).toBe("guinness");
  });

  it("set overwrites a previous favourite (single value, not a list)", () => {
    setFavoritePint("guinness");
    setFavoritePint("neck-oil");
    expect(getFavoritePint()).toBe("neck-oil");
  });

  it("clear removes the value so get returns null again", () => {
    setFavoritePint("guinness");
    clearFavoritePint();
    expect(getFavoritePint()).toBeNull();
  });

  it("writes under the versioned storage key", () => {
    const storage = makeMemoryStorage();
    installWindow(storage);
    setFavoritePint("guinness");
    expect(storage.getItem(STORAGE_KEY)).toBe("guinness");
  });

  it("normalizes a blank / whitespace stored value to null on read", () => {
    const storage = makeMemoryStorage();
    installWindow(storage);
    // A directly-written empty/whitespace value must read back as null, not "".
    storage.setItem(STORAGE_KEY, "   ");
    expect(getFavoritePint()).toBeNull();
    storage.setItem(STORAGE_KEY, "");
    expect(getFavoritePint()).toBeNull();
  });
});

describe("favoritePint — SSR / no-window (server case)", () => {
  it("get returns null on the server (no window)", () => {
    // afterEach cleared any window; this is the true SSR path.
    expect(getFavoritePint()).toBeNull();
  });

  it("set is a no-op on the server (does not throw)", () => {
    expect(() => setFavoritePint("guinness")).not.toThrow();
  });

  it("clear is a no-op on the server (does not throw)", () => {
    expect(() => clearFavoritePint()).not.toThrow();
  });
});

describe("favoritePint — degrades silently when storage throws (private mode)", () => {
  beforeEach(() => {
    installWindow(makeThrowingStorage());
  });

  it("get returns null instead of throwing", () => {
    expect(getFavoritePint()).toBeNull();
  });

  it("set swallows the error and does not throw", () => {
    expect(() => setFavoritePint("guinness")).not.toThrow();
  });

  it("clear swallows the error and does not throw", () => {
    expect(() => clearFavoritePint()).not.toThrow();
  });
});
