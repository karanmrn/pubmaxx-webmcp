import { describe, expect, it, vi } from "vitest";

import {
  registerWebMcpTools,
  type WebMcpRegistrationStatus,
  type WebMcpToolImplementations,
} from "@/lib/webmcp/modelContext";

type RegisteredTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, boolean>;
  execute: (
    input: unknown,
    context: WebMcpToolExecutionContext,
  ) => Promise<WebMcpJsonValue>;
};

type Registration = {
  tool: RegisteredTool;
  signal: AbortSignal;
};

function implementations(): WebMcpToolImplementations {
  return {
    search_pubmaxx_venues: vi.fn(async () => ({ status: "ok" })),
    read_london_night_context: vi.fn(async () => ({ status: "ok" })),
    draft_pub_crawl: vi.fn(async () => ({ status: "ok" })),
    swap_crawl_stop: vi.fn(async () => ({ status: "ok" })),
    open_crawl_in_pubmaxx: vi.fn(async () => ({ status: "ok" })),
  };
}

function deferredRegistration() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<undefined>((settle, fail) => {
    resolve = () => settle(undefined);
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("WebMCP tool registration", () => {
  it("reports unavailable without trying to register in an unsupported browser", () => {
    const statuses: WebMcpRegistrationStatus[] = [];

    const cleanup = registerWebMcpTools({
      modelContext: undefined,
      implementations: implementations(),
      onStatus: (status) => statuses.push(status),
    });

    expect(statuses).toEqual(["unavailable"]);
    expect(cleanup).toEqual(expect.any(Function));
    cleanup();
  });

  it("registers the exact five top-level tools with narrow schemas", async () => {
    const registrations: Registration[] = [];
    const statuses: WebMcpRegistrationStatus[] = [];
    const modelContext = {
      registerTool: vi.fn(
        (tool: RegisteredTool, options: { signal: AbortSignal }) => {
          registrations.push({ tool, signal: options.signal });
          return Promise.resolve(undefined);
        },
      ),
    };

    registerWebMcpTools({
      modelContext,
      implementations: implementations(),
      onStatus: (status) => statuses.push(status),
    });
    await vi.waitFor(() => expect(statuses).toEqual(["registering", "ready"]));

    expect(registrations.map(({ tool }) => tool.name)).toEqual([
      "search_pubmaxx_venues",
      "read_london_night_context",
      "draft_pub_crawl",
      "swap_crawl_stop",
      "open_crawl_in_pubmaxx",
    ]);
    expect(registrations.map(({ tool }) => tool.inputSchema)).toEqual([
      {
        type: "object",
        properties: {
          query: { type: "string", minLength: 2, maxLength: 80 },
          limit: { type: "integer", minimum: 1, maximum: 8 },
        },
        required: ["query"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          request: { type: "string", minLength: 3, maxLength: 500 },
          expectedRevision: { type: "integer", minimum: 0 },
        },
        required: ["request", "expectedRevision"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          position: { type: "integer", minimum: 1, maximum: 6 },
          expectedRevision: { type: "integer", minimum: 0 },
        },
        required: ["position", "expectedRevision"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          expectedRevision: { type: "integer", minimum: 0 },
        },
        required: ["expectedRevision"],
        additionalProperties: false,
      },
    ]);
    expect(registrations.map(({ tool }) => tool.annotations)).toEqual([
      { readOnlyHint: true },
      { readOnlyHint: true, untrustedContentHint: true },
      { readOnlyHint: false, untrustedContentHint: true },
      { readOnlyHint: false, untrustedContentHint: true },
      { readOnlyHint: false },
    ]);
  });

  it("waits for every registration before reporting ready", async () => {
    const pending = Array.from({ length: 5 }, deferredRegistration);
    const statuses: WebMcpRegistrationStatus[] = [];
    let index = 0;

    registerWebMcpTools({
      modelContext: {
        registerTool: () => pending[index++].promise,
      },
      implementations: implementations(),
      onStatus: (status) => statuses.push(status),
    });

    pending.slice(0, 4).forEach(({ resolve }) => resolve());
    await Promise.resolve();
    expect(statuses).toEqual(["registering"]);

    pending[4].resolve();
    await vi.waitFor(() => expect(statuses).toEqual(["registering", "ready"]));
  });

  it("rejects invalid, extra, and over-limit input before handler dispatch", async () => {
    const registrations: Registration[] = [];
    const toolImplementations = implementations();
    const signal = new AbortController().signal;

    registerWebMcpTools({
      modelContext: {
        registerTool: (tool: RegisteredTool, options: { signal: AbortSignal }) => {
          registrations.push({ tool, signal: options.signal });
          return Promise.resolve(undefined);
        },
      },
      implementations: toolImplementations,
      onStatus: () => {},
    });

    const invalidCalls: Array<{ name: keyof WebMcpToolImplementations; input: unknown }> = [
      { name: "search_pubmaxx_venues", input: { query: "x" } },
      { name: "search_pubmaxx_venues", input: { query: "   " } },
      { name: "search_pubmaxx_venues", input: { query: "x".repeat(81) } },
      { name: "read_london_night_context", input: { extra: true } },
      { name: "draft_pub_crawl", input: { request: "Camden", expectedRevision: -1 } },
      { name: "swap_crawl_stop", input: { position: 7, expectedRevision: 0 } },
      { name: "open_crawl_in_pubmaxx", input: { expectedRevision: 0, extra: true } },
    ];

    for (const { name, input } of invalidCalls) {
      const tool = registrations.find(({ tool: candidate }) => candidate.name === name)?.tool;
      expect(tool).toBeDefined();
      await expect(tool!.execute(input, { signal })).resolves.toEqual({
        status: "error",
        error: {
          code: "invalid_input",
          message: expect.stringContaining(`Invalid input for ${name}. Expected`),
        },
      });
      expect(toolImplementations[name]).not.toHaveBeenCalled();
    }
  });

  it("forwards valid input and the unchanged execution context", async () => {
    const registrations: Registration[] = [];
    const toolImplementations = implementations();

    registerWebMcpTools({
      modelContext: {
        registerTool: (tool: RegisteredTool, options: { signal: AbortSignal }) => {
          registrations.push({ tool, signal: options.signal });
          return Promise.resolve(undefined);
        },
      },
      implementations: toolImplementations,
      onStatus: () => {},
    });

    const input = { query: "Camden", limit: 4 };
    const context = { signal: new AbortController().signal };
    const tool = registrations.find(
      ({ tool: candidate }) => candidate.name === "search_pubmaxx_venues",
    )!.tool;

    await expect(tool.execute(input, context)).resolves.toEqual({ status: "ok" });
    expect(toolImplementations.search_pubmaxx_venues).toHaveBeenCalledWith(
      input,
      context,
    );
  });

  it("aborts every registration and reports failed when one rejects", async () => {
    const registrations: Registration[] = [];
    const statuses: WebMcpRegistrationStatus[] = [];
    const failure = deferredRegistration();
    let index = 0;

    registerWebMcpTools({
      modelContext: {
        registerTool: (tool: RegisteredTool, options: { signal: AbortSignal }) => {
          registrations.push({ tool, signal: options.signal });
          index += 1;
          return index === 3 ? failure.promise : Promise.resolve(undefined);
        },
      },
      implementations: implementations(),
      onStatus: (status) => statuses.push(status),
    });

    failure.reject(new Error("registration refused"));
    await vi.waitFor(() => expect(statuses).toEqual(["registering", "failed"]));

    expect(registrations).toHaveLength(5);
    expect(new Set(registrations.map(({ signal }) => signal)).size).toBe(1);
    expect(registrations.every(({ signal }) => signal.aborted)).toBe(true);
  });

  it("uses one abort signal and aborts it once during cleanup", () => {
    const registrations: Registration[] = [];
    const onAbort = vi.fn();

    const cleanup = registerWebMcpTools({
      modelContext: {
        registerTool: (tool: RegisteredTool, options: { signal: AbortSignal }) => {
          registrations.push({ tool, signal: options.signal });
          options.signal.addEventListener("abort", onAbort);
          return Promise.resolve(undefined);
        },
      },
      implementations: implementations(),
      onStatus: () => {},
    });

    expect(new Set(registrations.map(({ signal }) => signal)).size).toBe(1);
    expect(registrations[0].signal.aborted).toBe(false);

    cleanup();
    cleanup();

    expect(registrations[0].signal.aborted).toBe(true);
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it("does not report ready when cleanup precedes pending registration settlement", async () => {
    const pending = Array.from({ length: 5 }, deferredRegistration);
    const statuses: WebMcpRegistrationStatus[] = [];
    let index = 0;

    const cleanup = registerWebMcpTools({
      modelContext: {
        registerTool: () => pending[index++].promise,
      },
      implementations: implementations(),
      onStatus: (status) => statuses.push(status),
    });

    cleanup();
    pending.forEach(({ resolve }) => resolve());
    await Promise.all(pending.map(({ promise }) => promise));
    await Promise.resolve();

    expect(statuses).toEqual(["registering"]);
  });

  it("aborts partial registration and reports failed after a synchronous throw", () => {
    const registrations: Registration[] = [];
    const statuses: WebMcpRegistrationStatus[] = [];
    let index = 0;

    registerWebMcpTools({
      modelContext: {
        registerTool: (tool: RegisteredTool, options: { signal: AbortSignal }) => {
          index += 1;
          if (index === 3) throw new Error("registration refused synchronously");
          registrations.push({ tool, signal: options.signal });
          return Promise.resolve(undefined);
        },
      },
      implementations: implementations(),
      onStatus: (status) => statuses.push(status),
    });

    expect(registrations).toHaveLength(2);
    expect(registrations.every(({ signal }) => signal.aborted)).toBe(true);
    expect(statuses).toEqual(["registering", "failed"]);
  });
});
