import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import { join } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..");
const PROBE = join(REPO_ROOT, "scripts/probe-api-budgets.mjs");

type ProbeResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

async function startServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not expose a port.");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function stopServer(server: Server): Promise<void> {
  server.closeAllConnections();
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function validBodyForPath(pathname: string): Record<string, unknown> {
  switch (pathname) {
    case "/api/whats-on":
      return { rows: [], servedAt: "2026-09-01T00:00:00.000Z", sourceFreshnessKind: "bundled" };
    case "/api/out":
      return { status: "ready", events: [] };
    case "/api/night-areas":
      return { cityId: "london", areas: [] };
    case "/api/pint-drops":
      return { drops: [] };
    case "/api/map-search":
      return { intent: { primary: "venue" }, nationalPubs: [], nationalStatus: "ready" };
    case "/api/founding-members":
      return { members: [], cap: 100 };
    default:
      return {};
  }
}

function writeJson(
  request: IncomingMessage,
  response: ServerResponse,
  status = 200,
  body = validBodyForPath(new URL(request.url ?? "/", "http://localhost").pathname),
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function runProbe(
  baseUrl: string,
  environment: Record<string, string> = {},
  killAfterMs?: number,
  nodeArgs: string[] = [],
): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [...nodeArgs, PROBE, "--base-url", baseUrl],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, ...environment },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    let killer: ReturnType<typeof setTimeout> | undefined;
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    if (killAfterMs !== undefined) killer = setTimeout(() => child.kill("SIGTERM"), killAfterMs);
    child.on("close", (code, signal) => {
      if (killer) clearTimeout(killer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

describe("probe-api-budgets CLI", () => {
  it("runs the documented Node command against a deployed-style target", async () => {
    const calls = new Map<string, number>();
    const { server, baseUrl } = await startServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      calls.set(pathname, (calls.get(pathname) ?? 0) + 1);
      writeJson(request, response);
    });
    try {
      const result = await runProbe(baseUrl);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("[api-budget] every budgeted read inside its ceiling.");
      expect(calls.get("/api/whats-on")).toBe(14);
      expect(calls.get("/api/founding-members")).toBe(7);
    } finally {
      await stopServer(server);
    }
  }, 20_000);

  it("fails when any sample returns an error status", async () => {
    let first = true;
    const { server, baseUrl } = await startServer((request, response) => {
      writeJson(request, response, first ? 500 : 200);
      first = false;
    });
    try {
      const result = await runProbe(baseUrl);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("/api/whats-on: HTTP 500");
    } finally {
      await stopServer(server);
    }
  }, 20_000);

  it("fails a redirect instead of following it", async () => {
    const { server, baseUrl } = await startServer((_request, response) => {
      response.writeHead(302, {
        location: "/login",
        "content-type": "text/html",
      });
      response.end("<html>sign in</html>");
    });
    try {
      const result = await runProbe(baseUrl);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("/api/whats-on: redirect response (302)");
    } finally {
      await stopServer(server);
    }
  }, 20_000);

  it("fails an HTML error page even when its status is successful", async () => {
    const { server, baseUrl } = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<html>service unavailable</html>");
    });
    try {
      const result = await runProbe(baseUrl);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("/api/whats-on: response was not JSON");
    } finally {
      await stopServer(server);
    }
  }, 20_000);

  it("fails malformed JSON instead of treating its first byte as a measurement", async () => {
    const { server, baseUrl } = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("not-json");
    });
    try {
      const result = await runProbe(baseUrl);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("/api/whats-on: response JSON was invalid");
    } finally {
      await stopServer(server);
    }
  }, 20_000);

  it("fails a sample that never sends response headers", async () => {
    let first = true;
    const { server, baseUrl } = await startServer((request, response) => {
      if (first) {
        first = false;
        request.on("aborted", () => response.destroy());
        return;
      }
      writeJson(request, response);
    });
    try {
      const result = await runProbe(
        baseUrl,
        { PUBMAX_API_PROBE_TIMEOUT_MS: "25" },
        1_000,
      );

      expect(result.signal).not.toBe("SIGTERM");
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("/api/whats-on: timed out after 25ms");
    } finally {
      await stopServer(server);
    }
  }, 5_000);

  it("fails a well-formed JSON response with the wrong route shape", async () => {
    const whatsOnBody = validBodyForPath("/api/whats-on");
    const { server, baseUrl } = await startServer((request, response) => {
      writeJson(request, response, 200, whatsOnBody);
    });
    try {
      const result = await runProbe(baseUrl);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain(
        "/api/out: response JSON shape missing required keys: status, events",
      );
    } finally {
      await stopServer(server);
    }
  }, 20_000);

  it("fails a well-formed JSON response whose required values are null", async () => {
    const invalidOutBody = { status: null, events: null };
    const { server, baseUrl } = await startServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      writeJson(
        request,
        response,
        200,
        pathname === "/api/out" ? invalidOutBody : validBodyForPath(pathname),
      );
    });
    try {
      const result = await runProbe(baseUrl);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain(
        "/api/out: response JSON shape invalid for required fields: status (string), events (array)",
      );
    } finally {
      await stopServer(server);
    }
  }, 20_000);

  it("reports time to first byte before slow stream cancellation", async () => {
    const preload = encodeURIComponent(`
      globalThis.fetch = async () => ({
        status: 200,
        headers: { get() { return "application/json"; } },
        body: {
          getReader() {
            return {
              read: async () => ({ done: false, value: new Uint8Array([123]) }),
              cancel() { return new Promise((resolve) => setTimeout(resolve, 40)); },
            };
          },
        },
        clone() {
          return {
            json: async () => ({
              rows: [],
              servedAt: "2026-09-01T00:00:00.000Z",
              sourceFreshnessKind: "bundled",
              status: "ready",
              events: [],
              cityId: "london",
              areas: [],
              drops: [],
              intent: { primary: "venue" },
              nationalPubs: [],
              nationalStatus: "ready",
              members: [],
              cap: 100,
            }),
          };
        },
      });
    `);
    const { server, baseUrl } = await startServer((request, response) => writeJson(request, response));
    try {
      const result = await runProbe(
        baseUrl,
        {},
        8_000,
        ["--import", `data:text/javascript,${preload}`],
      );

      expect(result.code).toBe(0);
      const p50Rows = result.stdout.split("\n").filter((line) => line.includes("p50 (ms)"));
      expect(p50Rows).toHaveLength(6);
      for (const row of p50Rows) {
        const cells = row.trim().split(/\s{2,}/);
        expect(Number(cells[2])).toBeLessThan(25);
      }
    } finally {
      await stopServer(server);
    }
  }, 20_000);
});
