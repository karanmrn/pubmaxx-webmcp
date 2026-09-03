#!/usr/bin/env node
/*
 * probe-api-budgets.mjs — the CI probe behind perf/api-budgets.json.
 *
 * Hits each budgeted read against a deployed target, times to the first byte
 * of the body, and fails when a percentile is past its ceiling. Heavy
 * verification runs on remote CI rather than a local full build, so this takes
 * a base URL and nothing else.
 *
 *   node scripts/probe-api-budgets.mjs --base-url https://<deployment>.vercel.app
 *
 * The rules (percentile, breach, tables) live in lib/apiBudgets.mjs so they are
 * unit-tested without a network. This file only measures.
 */

import process from "node:process";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

const baseUrl = arg("--base-url") ?? process.env.PUBMAX_PROBE_BASE_URL;
if (!baseUrl) {
  console.error("probe-api-budgets: --base-url (or PUBMAX_PROBE_BASE_URL) is required.");
  process.exit(2);
}

const {
  API_BUDGETS: budgets,
  findApiBudgetBreaches,
  formatApiBreachTable,
  formatApiMeasurementTable,
  percentile,
} = await import("../lib/apiBudgets.mjs");

const configuredTimeoutMs = Number(process.env.PUBMAX_API_PROBE_TIMEOUT_MS);
const probeTimeoutMs = Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
  ? configuredTimeoutMs
  : 10_000;
const requestHeaders = { accept: "application/json" };

function mediaType(response) {
  return (response.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

function assertJsonContentType(response) {
  const type = mediaType(response);
  if (type !== "application/json" && !type.endsWith("+json")) {
    throw new Error("response was not JSON");
  }
}

async function validateJsonBody(response, route) {
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("response JSON was invalid");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("response JSON shape was invalid");
  }
  const missingFields = Object.keys(route.requiredJsonFields).filter(
    (key) => !Object.prototype.hasOwnProperty.call(body, key),
  );
  if (missingFields.length > 0) {
    throw new Error(
      `response JSON shape missing required keys: ${missingFields.join(", ")}`,
    );
  }
  const invalidFields = Object.entries(route.requiredJsonFields).filter(([key, type]) => {
    const value = body[key];
    if (value === null) return true;
    if (type === "array") return !Array.isArray(value);
    if (type === "object") return typeof value !== "object" || Array.isArray(value);
    return typeof value !== type;
  });
  if (invalidFields.length > 0) {
    throw new Error(
      `response JSON shape invalid for required fields: ${invalidFields
        .map(([key, type]) => `${key} (${type})`)
        .join(", ")}`,
    );
  }
}

/**
 * Time to the first byte of the body. The response is drained afterwards:
 * a body nobody reads is a request that never finishes (lib/responseBody.ts).
 */
async function sample(url, route) {
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), probeTimeoutMs);
  try {
    const response = await fetch(url, {
      headers: requestHeaders,
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      throw new Error(`redirect response (${response.status})`);
    }
    assertJsonContentType(response);
    const validationResponse = response.clone();
    const reader = response.body?.getReader();
    if (!reader) throw new Error("response body unavailable");
    try {
      const firstRead = await reader.read();
      if (firstRead.done) throw new Error("response body was empty");
      const measuredAt = performance.now();
      await validateJsonBody(validationResponse, route);
      return { ms: measuredAt - started, status: response.status };
    } finally {
      await reader.cancel().catch(() => {});
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`timed out after ${probeTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const { samples, warmupSamples } = budgets.method;
  const measured = new Map();
  const unreachable = [];

  for (const route of budgets.routes) {
    const url = new URL(route.path, baseUrl).toString();
    const times = [];
    const sampleCount = route.sampleCount ?? samples;
    let firstNonSuccessStatus = null;
    let failure = null;
    if (!Number.isInteger(sampleCount) || sampleCount < 1) {
      unreachable.push(`${route.path}: invalid sample count`);
      continue;
    }
    for (let run = 0; run < warmupSamples + sampleCount; run += 1) {
      try {
        const result = await sample(url, route);
        if (result.status < 200 || result.status >= 300) {
          firstNonSuccessStatus ??= result.status;
        }
        if (run >= warmupSamples) times.push(result.ms);
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        break;
      }
    }
    const reasons = [];
    if (firstNonSuccessStatus !== null) reasons.push(`HTTP ${firstNonSuccessStatus}`);
    if (failure) reasons.push(failure);
    if (times.length === 0 || reasons.length > 0) {
      unreachable.push(`${route.path}: ${reasons.join("; ") || "no response"}`);
      continue;
    }
    measured.set(route.path, {
      p50Ms: Math.round(percentile(times, 0.5)),
      p95Ms: Math.round(percentile(times, 0.95)),
    });
  }

  console.log(`[api-budget] ${baseUrl}`);
  console.log(formatApiMeasurementTable(budgets.routes, measured));

  if (unreachable.length > 0) {
    console.error(`\n[api-budget] routes the probe could not measure:\n  ${unreachable.join("\n  ")}`);
    process.exit(1);
  }

  const breaches = findApiBudgetBreaches(budgets.routes, measured);
  if (breaches.length > 0) {
    console.error(
      `\nOver the API latency budget. Fix the read or take the ceiling up deliberately ` +
        `(docs/PERFORMANCE_BUDGETS.md).\n\n${formatApiBreachTable(breaches)}\n`,
    );
    process.exit(1);
  }
  console.log("\n[api-budget] every budgeted read inside its ceiling.");
}

await main();
