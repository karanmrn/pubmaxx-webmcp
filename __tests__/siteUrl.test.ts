import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { siteOrigin } from "@/lib/siteUrl";

const CONFIG_URL = pathToFileURL(
  path.join(process.cwd(), "next.config.mjs"),
).href;

function loadConfig(siteUrl: string | undefined, vercelEnv?: string) {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    DEPLOYMENT_VERSION: "site-url-test",
  };
  if (siteUrl === undefined) delete environment.NEXT_PUBLIC_SITE_URL;
  else environment.NEXT_PUBLIC_SITE_URL = siteUrl;
  if (vercelEnv === undefined) delete environment.VERCEL_ENV;
  else environment.VERCEL_ENV = vercelEnv;

  return spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", `await import(${JSON.stringify(CONFIG_URL)})`],
    { cwd: process.cwd(), env: environment, encoding: "utf8" },
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("deployed site URL configuration", () => {
  it.each([
    { vercelEnv: "production", condition: "missing", siteUrl: undefined },
    { vercelEnv: "production", condition: "malformed", siteUrl: "not a URL" },
    {
      vercelEnv: "production",
      condition: "insecure",
      siteUrl: "http://pubmaxxing.com",
    },
    {
      vercelEnv: "production",
      condition: "noncanonical",
      siteUrl: "https://preview-team.vercel.app",
    },
    { vercelEnv: "preview", condition: "missing", siteUrl: undefined },
    { vercelEnv: "preview", condition: "malformed", siteUrl: "not a URL" },
    {
      vercelEnv: "preview",
      condition: "insecure",
      siteUrl: "http://pubmaxxing.com",
    },
    {
      vercelEnv: "preview",
      condition: "noncanonical",
      siteUrl: "https://preview-team.vercel.app",
    },
  ])(
    "keeps $vercelEnv builds runnable when NEXT_PUBLIC_SITE_URL is $condition",
    ({ vercelEnv, siteUrl }) => {
      const result = loadConfig(siteUrl, vercelEnv);

      expect(result.status).toBe(0);
      expect(result.stderr).not.toContain("FATAL:");
    },
  );

  it("accepts the canonical origin for deployed builds", () => {
    const result = loadConfig("https://pubmaxxing.com", "preview");

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("FATAL:");
  });

  it("does not apply deployed build validation to local builds", () => {
    const result = loadConfig(undefined);

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("NEXT_PUBLIC_SITE_URL");
  });

  it("falls back to the apex with a loud server diagnostic at runtime", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://preview-team.vercel.app");
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(siteOrigin("https://preview-team.vercel.app/api/auth")).toBe(
      "https://pubmaxxing.com",
    );
    expect(diagnostic).toHaveBeenCalledWith(
      expect.stringMatching(
        /^FATAL: NEXT_PUBLIC_SITE_URL must be the canonical https:\/\/pubmaxxing\.com origin\./,
      ),
    );
  });

  it("preserves the current origin locally without production diagnostics", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "not a URL");
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(siteOrigin("http://localhost:3000/map")).toBe(
      "http://localhost:3000",
    );
    expect(diagnostic).not.toHaveBeenCalled();
  });
});
