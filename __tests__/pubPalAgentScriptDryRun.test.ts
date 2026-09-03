import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts", "pubpal", "create-elevenlabs-agent.mjs");
const SECRET = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";

const directories: string[] = [];

function emptyCwd() {
  const directory = mkdtempSync(path.join(tmpdir(), "pubmax-pubpal-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop() as string, { recursive: true, force: true });
  }
});

function dryRun() {
  return spawnSync(
    process.execPath,
    [SCRIPT, "--dry-run", "--base-url", "https://pubmaxxing.com"],
    {
      // An empty cwd so the script's own .env.local read cannot supply values.
      cwd: emptyCwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        ELEVENLABS_LLM_SHARED_SECRET: SECRET,
        ELEVENLABS_API_KEY: "",
        ELEVENLABS_PUB_PAL_AGENT_ID: "",
      },
    },
  );
}

describe("pubpal:agent dry run", () => {
  it("prints the agent it would write without printing the shared secret", () => {
    const result = dryRun();
    expect(result.status).toBe(0);
    const output = `${result.stdout}${result.stderr}`;
    expect(output).not.toContain(SECRET);
    expect(output).toContain(`[redacted, ${SECRET.length} characters]`);
    expect(output).toContain("https://pubmaxxing.com/api/pub-pal/llm");
  });

  it("still describes the agent it would write", () => {
    const printed = dryRun().stdout.split("\nVoices resolved:")[0] ?? "";
    const start = printed.indexOf("{");
    const end = printed.lastIndexOf("}");
    const body = JSON.parse(printed.slice(start, end + 1)) as {
      conversation_config: {
        agent: { prompt: { llm: string; custom_llm: { url: string } } };
      };
      platform_settings: { privacy: { retention_days: number } };
    };
    expect(body.conversation_config.agent.prompt.llm).toBe("custom-llm");
    expect(body.conversation_config.agent.prompt.custom_llm.url).toBe(
      "https://pubmaxxing.com/api/pub-pal/llm",
    );
    expect(body.platform_settings.privacy.retention_days).toBe(0);
  });

  it("writes the product voice cap, not a longer provider window", async () => {
    const printed = dryRun().stdout.split("\nVoices resolved:")[0] ?? "";
    const start = printed.indexOf("{");
    const end = printed.lastIndexOf("}");
    const body = JSON.parse(printed.slice(start, end + 1)) as {
      conversation_config: { conversation: { max_duration_seconds: number } };
    };
    const { PAL_VOICE_MAX_SESSION_SECONDS } = await import("@/lib/palVoiceMetering");
    expect(PAL_VOICE_MAX_SESSION_SECONDS).toBe(180);
    expect(body.conversation_config.conversation.max_duration_seconds).toBe(
      PAL_VOICE_MAX_SESSION_SECONDS,
    );
  });
});
