#!/usr/bin/env node
// Manual / operator Step Out weekly nudge sender. Mirrors sendDailyBrief.mjs:
// loads .env.local, refuses without VAPID + durable store, logs counts only,
// never prints endpoints or subscription keys. Prefer the cron route in
// production; this script is for dry-runs and intentional operator retries.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

import pushProvider from "../../lib/pushProvider.ts";
import stepOutNudgeDispatch from "../../lib/stepOutNudgeDispatch.server.ts";
import supabase from "../../lib/supabase.ts";

const { isVapidConfigured } = pushProvider;
const { dispatchStepOutNudges } = stepOutNudgeDispatch;
const { isSupabaseConfigured } = supabase;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
nextEnv.loadEnvConfig(ROOT);

export async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (!dryRun && !isVapidConfigured()) {
    console.info(
      "[step-out-nudge] not sent: set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (optionally VAPID_SUBJECT) in the operator environment.",
    );
    return;
  }
  if (!dryRun && !isSupabaseConfigured()) {
    console.info(
      "[step-out-nudge] not sent: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY so the process can read opted-in subscriptions.",
    );
    return;
  }

  if (dryRun) {
    console.info(
      "[step-out-nudge] dry run: would walk opted-in subscriptions and send only place-bound owed payloads (Wanted nearby, open Soft Plan, or sourced deal).",
    );
    return;
  }

  const summary = await dispatchStepOutNudges(new Date());
  console.info(
    `[step-out-nudge] considered=${summary.considered} sent=${summary.sent} skippedFrequency=${summary.skippedFrequency} skippedNothingOwed=${summary.skippedNothingOwed} skippedNoAccount=${summary.skippedNoAccount} pruned=${summary.pruned} errors=${summary.errors}`,
  );
  if (summary.errors > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch {
    console.error(
      "[step-out-nudge] failed before delivery. Check the durable store, migration 0094, and provider configuration; no subscription details were logged.",
    );
    process.exitCode = 1;
  }
}
