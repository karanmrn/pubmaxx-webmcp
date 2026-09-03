import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function importSupabase(reactServer: boolean) {
  const args = [
    ...(reactServer ? ["--conditions=react-server"] : []),
    "--import",
    "tsx",
    "--input-type=module",
    "--eval",
    'await import("./lib/supabase.ts")',
  ];
  return spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
  });
}

function runPushDryRun(script: "push:daily" | "push:step-out") {
  return spawnSync("npm", ["run", script, "--", "--dry-run"], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      APNS_KEY_ID: "",
      APNS_PRIVATE_KEY: "",
      APNS_TEAM_ID: "",
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      SUPABASE_URL: "",
      VAPID_PRIVATE_KEY: "",
      VAPID_SUBJECT: "",
    },
  });
}

describe("server-only operator scripts (#1099)", () => {
  it("rejects a plain Node import of Supabase admin code", () => {
    const result = importSupabase(false);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "This module cannot be imported from a Client Component module",
    );
  });

  it("permits Supabase admin code under the React server condition", () => {
    const result = importSupabase(true);
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  });

  it.each(["push:daily", "push:step-out"] as const)(
    "%s keeps its non-delivery dry run runnable",
    (script) => {
      const result = runPushDryRun(script);
      const output = `${result.stdout}${result.stderr}`;
      expect(result.status, output).toBe(0);
      expect(output).not.toContain(
        "This module cannot be imported from a Client Component module",
      );
      expect(output).toMatch(
        script === "push:daily"
          ? /\[daily-brief\] (?:dry run|not sent):/
          : /\[step-out-nudge\] dry run:/,
      );
    },
    30_000,
  );
});
