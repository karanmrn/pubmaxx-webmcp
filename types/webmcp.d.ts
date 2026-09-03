export {};

declare global {
  type WebMcpJsonValue =
    | null
    | boolean
    | number
    | string
    | WebMcpJsonValue[]
    | { [key: string]: WebMcpJsonValue };

  type WebMcpJsonObject = { [key: string]: WebMcpJsonValue };

  interface WebMcpToolAnnotations {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
  }

  interface WebMcpToolExecutionContext {
    signal: AbortSignal;
  }

  interface WebMcpToolDescriptor {
    name: string;
    description: string;
    inputSchema?: WebMcpJsonObject;
    annotations?: WebMcpToolAnnotations;
    execute: (
      input: unknown,
      context?: WebMcpToolExecutionContext,
    ) => Promise<WebMcpJsonValue>;
  }

  interface WebMcpModelContext {
    registerTool(
      tool: WebMcpToolDescriptor,
      options?: { signal?: AbortSignal },
    ): Promise<undefined>;
  }

  interface Document {
    modelContext?: WebMcpModelContext;
  }
}
