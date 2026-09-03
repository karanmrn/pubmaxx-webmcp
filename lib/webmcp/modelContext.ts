import { MAX_PLAN_STOP_COUNT } from "@/lib/planStopCount";

const WEBMCP_TOOL_NAMES = [
  "search_pubmaxx_venues",
  "read_london_night_context",
  "draft_pub_crawl",
  "swap_crawl_stop",
  "open_crawl_in_pubmaxx",
] as const;

export type WebMcpToolName = (typeof WEBMCP_TOOL_NAMES)[number];
export type WebMcpRegistrationStatus =
  | "unavailable"
  | "registering"
  | "ready"
  | "failed";

export interface WebMcpToolInputMap {
  search_pubmaxx_venues: { query: string; limit?: number };
  read_london_night_context: Record<string, never>;
  draft_pub_crawl: { request: string; expectedRevision: number };
  swap_crawl_stop: { position: number; expectedRevision: number };
  open_crawl_in_pubmaxx: { expectedRevision: number };
}

export type WebMcpToolImplementation<Name extends WebMcpToolName> = (
  input: WebMcpToolInputMap[Name],
  context: WebMcpToolExecutionContext,
) => Promise<WebMcpJsonValue>;

export type WebMcpToolImplementations = {
  [Name in WebMcpToolName]: WebMcpToolImplementation<Name>;
};

type UnknownObject = Record<string, unknown>;

function objectWithOnlyKeys(
  value: unknown,
  allowedKeys: readonly string[],
): value is UnknownObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function boundedString(value: unknown, minimum: number, maximum: number): boolean {
  return typeof value === "string"
    && value.trim().length >= minimum
    && value.length <= maximum;
}

function boundedInteger(value: unknown, minimum: number, maximum?: number): boolean {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= minimum
    && (maximum === undefined || value <= maximum);
}

function validToolInput(name: WebMcpToolName, input: unknown): boolean {
  switch (name) {
    case "search_pubmaxx_venues":
      return objectWithOnlyKeys(input, ["query", "limit"])
        && boundedString(input.query, 2, 80)
        && (input.limit === undefined || boundedInteger(input.limit, 1, 8));
    case "read_london_night_context":
      return objectWithOnlyKeys(input, []) && Object.keys(input).length === 0;
    case "draft_pub_crawl":
      return objectWithOnlyKeys(input, ["request", "expectedRevision"])
        && boundedString(input.request, 3, 500)
        && boundedInteger(input.expectedRevision, 0);
    case "swap_crawl_stop":
      return objectWithOnlyKeys(input, ["position", "expectedRevision"])
        && boundedInteger(input.position, 1, MAX_PLAN_STOP_COUNT)
        && boundedInteger(input.expectedRevision, 0);
    case "open_crawl_in_pubmaxx":
      return objectWithOnlyKeys(input, ["expectedRevision"])
        && boundedInteger(input.expectedRevision, 0);
  }
}

const INPUT_EXPECTATIONS: Record<WebMcpToolName, string> = {
  search_pubmaxx_venues:
    "an object with query as 2-80 non-blank characters and optional limit as an integer from 1 to 8, with no other fields.",
  read_london_night_context: "an empty object.",
  draft_pub_crawl:
    "an object with request as 3-500 characters and expectedRevision as a non-negative integer, with no other fields.",
  swap_crawl_stop:
    `an object with position as an integer from 1 to ${MAX_PLAN_STOP_COUNT} and expectedRevision as a non-negative integer, with no other fields.`,
  open_crawl_in_pubmaxx:
    "an object with expectedRevision as a non-negative integer, with no other fields.",
};

function invalidInput(name: WebMcpToolName): WebMcpJsonValue {
  return {
    status: "error",
    error: {
      code: "invalid_input",
      message: `Invalid input for ${name}. Expected ${INPUT_EXPECTATIONS[name]}`,
    },
  };
}

type ToolRegistration = Omit<WebMcpToolDescriptor, "name" | "execute">;

const TOOL_REGISTRATIONS: Record<WebMcpToolName, ToolRegistration> = {
  search_pubmaxx_venues: {
    description:
      "Search the curated PUBMAXX Venue Dataset by venue name or area.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 2, maxLength: 80 },
        limit: { type: "integer", minimum: 1, maximum: 8 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  read_london_night_context: {
    description:
      "Read current London weather, transport, and tonight evidence.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
  },
  draft_pub_crawl: {
    description:
      "Draft a grounded PUBMAXX Crawl Route from a request and board revision.",
    inputSchema: {
      type: "object",
      properties: {
        request: { type: "string", minLength: 3, maxLength: 500 },
        expectedRevision: { type: "integer", minimum: 0 },
      },
      required: ["request", "expectedRevision"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
  },
  swap_crawl_stop: {
    description:
      "Replace one Crawl Stop with the first unused server-provided alternative.",
    inputSchema: {
      type: "object",
      properties: {
        position: {
          type: "integer",
          minimum: 1,
          maximum: MAX_PLAN_STOP_COUNT,
        },
        expectedRevision: { type: "integer", minimum: 0 },
      },
      required: ["position", "expectedRevision"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
  },
  open_crawl_in_pubmaxx: {
    description:
      "Write the current Crawl Route to Plan and open it in PUBMAXX.",
    inputSchema: {
      type: "object",
      properties: {
        expectedRevision: { type: "integer", minimum: 0 },
      },
      required: ["expectedRevision"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
  },
};

export function registerWebMcpTools({
  modelContext,
  implementations,
  onStatus,
}: {
  modelContext: WebMcpModelContext | undefined;
  implementations: WebMcpToolImplementations;
  onStatus: (status: WebMcpRegistrationStatus) => void;
}): () => void {
  if (!modelContext) {
    onStatus("unavailable");
    return () => {};
  }

  const controller = new AbortController();
  onStatus("registering");

  let registrations: Promise<undefined>[];
  try {
    registrations = WEBMCP_TOOL_NAMES.map((name) =>
      modelContext.registerTool(
        {
          name,
          ...TOOL_REGISTRATIONS[name],
          execute: async (input, context) => {
            if (!validToolInput(name, input)) return invalidInput(name);
            return await implementations[name](input as never, context);
          },
        },
        { signal: controller.signal },
      ),
    );
  } catch {
    controller.abort();
    onStatus("failed");
    return () => controller.abort();
  }

  Promise.all(registrations).then(
    () => {
      if (!controller.signal.aborted) onStatus("ready");
    },
    () => {
      if (controller.signal.aborted) return;
      controller.abort();
      onStatus("failed");
    },
  );

  return () => controller.abort();
}
