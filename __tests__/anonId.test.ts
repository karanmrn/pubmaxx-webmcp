import { afterEach, describe, expect, it, vi } from "vitest";

import { getAnonId } from "@/lib/anonId";

const STORAGE_KEY = "pubmax:anonId:v1";

function makeMemoryStorage(initial?: Record<string, string>): Storage {
  const values = new Map(Object.entries(initial ?? {}));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  };
}

function installWindow(storage: Storage): void {
  (globalThis as { window?: { localStorage: Storage } }).window = {
    localStorage: storage,
  };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getAnonId", () => {
  it("degrades to an empty actor id during server rendering", () => {
    expect(getAnonId()).toBe("");
  });

  it("reuses the device id already persisted in local storage", () => {
    const storage = makeMemoryStorage({ [STORAGE_KEY]: "existing-device" });
    const setItem = vi.spyOn(storage, "setItem");
    installWindow(storage);

    expect(getAnonId()).toBe("existing-device");
    expect(setItem).not.toHaveBeenCalled();
  });

  it("mints with randomUUID once and persists the id for later calls", () => {
    const storage = makeMemoryStorage();
    installWindow(storage);
    const randomUUID = vi.fn(() => "new-device-id");
    vi.stubGlobal("crypto", { randomUUID });

    expect(getAnonId()).toBe("new-device-id");
    expect(getAnonId()).toBe("new-device-id");
    expect(storage.getItem(STORAGE_KEY)).toBe("new-device-id");
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("uses URL-safe random bytes when randomUUID is unavailable", () => {
    const storage = makeMemoryStorage();
    installWindow(storage);
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.set(Array.from({ length: 16 }, (_, index) => index));
      return bytes;
    });
    vi.stubGlobal("crypto", { getRandomValues });

    expect(getAnonId()).toBe("000102030405060708090a0b0c0d0e0f");
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it("falls back without throwing when browser crypto fails", () => {
    const storage = makeMemoryStorage();
    installWindow(storage);
    vi.stubGlobal("crypto", {
      randomUUID: () => {
        throw new Error("crypto unavailable");
      },
    });
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const id = getAnonId();

    expect(id).toMatch(/^a[0-9a-z]+$/);
    expect(storage.getItem(STORAGE_KEY)).toBe(id);
  });

  it("fails soft when reading or writing local storage is blocked", () => {
    const readBlocked = makeMemoryStorage();
    vi.spyOn(readBlocked, "getItem").mockImplementation(() => {
      throw new Error("read blocked");
    });
    installWindow(readBlocked);
    expect(getAnonId()).toBe("");

    const writeBlocked = makeMemoryStorage();
    vi.spyOn(writeBlocked, "setItem").mockImplementation(() => {
      throw new Error("write blocked");
    });
    installWindow(writeBlocked);
    expect(getAnonId()).toBe("");
  });
});
