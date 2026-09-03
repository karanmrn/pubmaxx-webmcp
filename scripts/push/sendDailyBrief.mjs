#!/usr/bin/env node
// Manual daily brief sender. GitHub scheduled workflows are currently blocked,
// so an operator runs `npm run push:daily` after refreshing weather. The script
// loads the same pure composition modules as /today and sends only to explicit,
// identity-free web subscriptions. It never prints endpoints or subscription
// keys.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

import dailyBriefPush from "../../lib/dailyBriefPush.ts";
import pintDrops from "../../lib/pintDrops.ts";
import pushProvider from "../../lib/pushProvider.ts";
import pushSender from "../../lib/pushSender.ts";
import pushTokenStoreModule from "../../lib/pushTokenStore.ts";
import todayBrief from "../../lib/todayBrief.ts";
import supabase from "../../lib/supabase.ts";
import whatsOnStore from "../../lib/whatsOnStore.ts";

const { composeDailyBriefPush } = dailyBriefPush;
const { isLimited } = pintDrops;
const { isVapidConfigured } = pushProvider;
const { broadcastDailyBrief } = pushSender;
const { pushTokenStore } = pushTokenStoreModule;
const { buildWeatherBrief, rankTonightPicks, toTonightPickDto } = todayBrief;
const { isSupabaseConfigured } = supabase;
const { loadWhatsOn } = whatsOnStore;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
nextEnv.loadEnvConfig(ROOT);

export async function buildCurrentDailyBrief(now = new Date()) {
  const weatherPath = join(ROOT, "public", "data", "weather", "latest.json");
  const weatherSnapshot = JSON.parse(await readFile(weatherPath, "utf8"));
  const weather = buildWeatherBrief(weatherSnapshot, now);
  const whatsOn = await loadWhatsOn(
    { window: "tonight" },
    { now: now.getTime(), fetchLive: async () => [] },
  );
  // A bundled read that could not run has no picks in it. Refuse the brief
  // rather than push a night described from zero rows nobody read.
  if (whatsOn.readStatus === "degraded") {
    throw new Error("whats-on baseline read failed; daily brief not composed");
  }
  const picks = rankTonightPicks(whatsOn.rows, 1).map(toTonightPickDto);
  return composeDailyBriefPush(weather, picks);
}

function londonDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (!dryRun && !isVapidConfigured()) {
    console.info(
      "[daily-brief] not sent: set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (optionally VAPID_SUBJECT) in the operator environment.",
    );
    return;
  }
  if (!dryRun && !isSupabaseConfigured()) {
    console.info(
      "[daily-brief] not sent: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY so the manual process can read durable web subscriptions.",
    );
    return;
  }

  const highlight = await buildCurrentDailyBrief();
  if (!highlight) {
    console.info(
      "[daily-brief] not sent: refresh the weather snapshot and confirm at least one current sourced Tonight pick, then retry.",
    );
    return;
  }

  if (dryRun) {
    console.info(
      `[daily-brief] dry run: ${highlight.weatherLine} Tonight: ${highlight.topPickTitle} at ${highlight.topPickPlace}.`,
    );
    return;
  }

  const webSubscribers = (await pushTokenStore().list())
    .filter((registration) => registration.platform === "web").length;
  if (webSubscribers === 0) {
    console.info("[daily-brief] no explicit web subscriptions are registered; nothing sent.");
    return;
  }
  if (!process.argv.includes("--force")) {
    const day = londonDay();
    const key = `daily-brief:${day}`;
    const alreadyClaimed = await isLimited(key, key, 1, 36 * 60 * 60 * 1000, { failClosed: true });
    if (alreadyClaimed) {
      console.info(
        `[daily-brief] ${day} was already claimed, or the durable duplicate guard is unavailable. Nothing sent; use --force only for an intentional operator retry.`,
      );
      return;
    }
  }

  const result = await broadcastDailyBrief(highlight);
  if (result.targeted === 0) {
    console.info("[daily-brief] no explicit web subscriptions are registered; nothing sent.");
    return;
  }
  console.info(
    `[daily-brief] targeted=${result.targeted} sent=${result.sent} skipped=${result.skipped} pruned=${result.pruned} errors=${result.errors}`,
  );
  if (result.errors > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch {
    console.error(
      "[daily-brief] failed before delivery. Check the durable store, migration 0046, and provider configuration; no subscription details were logged.",
    );
    process.exitCode = 1;
  }
}
