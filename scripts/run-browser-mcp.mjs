#!/usr/bin/env node
/**
 * Launch the Cursor Browser MCP plugin without relying on ${CURSOR_PLUGIN_ROOT}
 * expansion (broken in some cloud-agent harnesses).
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CACHE = join(
  homedir(),
  ".cursor/plugins/cache/cursor-public/675",
);

function findPluginRoot() {
  if (!existsSync(CACHE)) return null;
  const versions = readdirSync(CACHE)
    .filter((name) => !name.endsWith(".installed"))
    .sort();
  for (let i = versions.length - 1; i >= 0; i -= 1) {
    const root = join(CACHE, versions[i]);
    const entry = join(root, "dist/src/mcp-server.js");
    if (existsSync(entry)) return { root, entry };
  }
  return null;
}

const found = findPluginRoot();
if (!found) {
  console.error(
    "[browser-mcp] Could not find the Browserbase browse plugin under",
    CACHE,
  );
  process.exit(1);
}

const child = spawn(process.execPath, [found.entry], {
  cwd: found.root,
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
