import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDualBackendStore,
  createFailSoftGuard,
  errorMessage,
  isMissingTableSchema,
  missingTables,
  selectStore,
} from "@/lib/storeBackend";

describe("storeBackend", () => {
  it("selectStore prefers supabase when configured", () => {
    type Backend = { kind: "memory" | "supabase" };
    const memory: Backend = { kind: "memory" };
    const supabase: Backend = { kind: "supabase" };
    const prevUrl = process.env.SUPABASE_URL;
    const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      expect(selectStore(memory, supabase)).toBe(memory);
      process.env.SUPABASE_URL = "https://example.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
      expect(selectStore(memory, supabase)).toBe(supabase);
    } finally {
      if (prevUrl === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = prevUrl;
      if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
    }
  });

  it("createDualBackendStore curries selectStore into a zero-arg getter", () => {
    type Backend = { kind: "memory" | "supabase" };
    const memory: Backend = { kind: "memory" };
    const supabase: Backend = { kind: "supabase" };
    const getStore = createDualBackendStore(memory, supabase);
    const prevUrl = process.env.SUPABASE_URL;
    const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      expect(getStore()).toBe(memory);
      process.env.SUPABASE_URL = "https://example.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
      expect(getStore()).toBe(supabase);
    } finally {
      if (prevUrl === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = prevUrl;
      if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
    }
  });

  it("detects missing-table PostgREST shapes", () => {
    const miss = missingTables("price_confirms");
    expect(
      miss(new Error("Could not find the table 'public.price_confirms' in the schema cache")),
    ).toBe(true);
    expect(miss(new Error('relation "public.price_confirms" does not exist'))).toBe(true);
    expect(isMissingTableSchema(new Error("schema cache"), "plans")).toBe(true);
    expect(miss(new Error("permission denied"))).toBe(false);
  });

  it("stringifies unknown errors", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
  });
});

describe("createFailSoftGuard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the run result on success without warning or falling back", async () => {
    const guardObj = createFailSoftGuard({
      tag: "test-store",
      tables: "widgets",
      migrationHint: "apply migration 9999",
    });
    const onSchemaMiss = vi.fn(async () => "fallback");
    const result = await guardObj.guard<string>({
      context: "read",
      run: async () => "ok",
      onSchemaMiss,
      onError: () => "soft",
    });
    expect(result).toBe("ok");
    expect(onSchemaMiss).not.toHaveBeenCalled();
  });

  it("routes a missing-table error to onSchemaMiss and warns once (deduped)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const guardObj = createFailSoftGuard({
      tag: "test-store",
      tables: ["widgets", "gadgets"],
      migrationHint: "apply migration 9999",
    });
    const schemaMiss = () =>
      Promise.reject(new Error("Could not find the table 'public.widgets' in the schema cache"));
    const run = async () => {
      await schemaMiss();
      return "durable";
    };
    const first = await guardObj.guard<string>({
      context: "read",
      run,
      onSchemaMiss: async () => "memory",
      onError: () => "soft",
    });
    const second = await guardObj.guard<string>({
      context: "read",
      run,
      onSchemaMiss: async () => "memory",
      onError: () => "soft",
    });
    expect(first).toBe("memory");
    expect(second).toBe("memory");
    // One warn per context for the whole guard lifetime (deduped).
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("applying schema-miss policy"),
      expect.any(String),
    );
    // resetWarnings re-arms the dedupe.
    guardObj.resetWarnings();
    await guardObj.guard<string>({
      context: "read",
      run,
      onSchemaMiss: async () => "memory",
      onError: () => "soft",
    });
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it("logs with the bound tag then returns onError for a non-schema error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const guardObj = createFailSoftGuard({
      tag: "test-store",
      tables: "widgets",
      migrationHint: "apply migration 9999",
    });
    const result = await guardObj.guard<string>({
      context: "read",
      run: async () => {
        throw new Error("connection reset");
      },
      onSchemaMiss: async () => "memory",
      message: "read failed — returning empty",
      onError: () => "soft",
    });
    expect(result).toBe("soft");
    expect(errorSpy).toHaveBeenCalledWith(
      "[test-store] read failed — returning empty:",
      "connection reset",
    );
  });

  it("rethrows a non-schema error when no onError is given", async () => {
    const guardObj = createFailSoftGuard({
      tag: "test-store",
      tables: "widgets",
      migrationHint: "apply migration 9999",
    });
    await expect(
      guardObj.guard<string>({
        context: "write",
        run: async () => {
          throw new Error("boom");
        },
        onSchemaMiss: async () => "memory",
      }),
    ).rejects.toThrow("boom");
  });

  it("exposes a bound schema-miss predicate for manual branching", () => {
    const guardObj = createFailSoftGuard({
      tag: "test-store",
      tables: "widgets",
      migrationHint: "apply migration 9999",
    });
    expect(
      guardObj.isSchemaMiss(new Error('relation "public.widgets" does not exist')),
    ).toBe(true);
    expect(guardObj.isSchemaMiss(new Error("permission denied"))).toBe(false);
  });
});
