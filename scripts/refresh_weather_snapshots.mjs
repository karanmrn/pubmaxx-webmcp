// Scheduled cache refresh. Route requests consume only the checked-in snapshot;
// they never wait on a third-party weather request.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = join(ROOT, "public", "data", "weather", "latest.json");
const AREAS = {
  clapham: [51.462, -0.138], victoria: [51.496, -0.143], "piccadilly-soho": [51.511, -0.134],
  "canary-wharf": [51.505, -0.022], barnes: [51.474, -0.239], chiswick: [51.493, -0.255],
  shoreditch: [51.524, -0.079], camden: [51.539, -0.143], brixton: [51.461, -0.115],
  "bermondsey-london-bridge": [51.504, -0.082], "kings-cross": [51.531, -0.124], islington: [51.534, -0.104],
  dalston: [51.546, -0.075], peckham: [51.473, -0.069], greenwich: [51.482, -0.009],
  hammersmith: [51.492, -0.224], balham: [51.443, -0.152], marylebone: [51.522, -0.163],
  richmond: [51.461, -0.303], putney: [51.461, -0.216],
};

export function conditionForCode(code) {
  if ([0].includes(code)) return "Clear";
  if ([1, 2, 3].includes(code)) return "Cloudy";
  if ([45, 48].includes(code)) return "Fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([95, 96, 99].includes(code)) return "Thunderstorm";
  return `Weather code ${code}`;
}

export function weatherBranchName(now = new Date(), runId = process.env.GITHUB_RUN_ID, attempt = process.env.GITHUB_RUN_ATTEMPT) {
  const stamp = now.toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = runId?.replace(/\D/g, "") ? `${runId.replace(/\D/g, "")}-${attempt?.replace(/\D/g, "") || "1"}` : String(now.getTime());
  return `weather-cache/${stamp}-${suffix}`;
}

async function observation([nightArea, [lat, lng]]) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    current: "apparent_temperature,weather_code,wind_speed_10m",
    hourly: "precipitation_probability",
    forecast_hours: "1",
    timezone: "UTC",
  }).toString();
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "PUBMAXX-weather-cache/1" } });
  if (!response.ok) throw new Error(`${nightArea}: Open-Meteo returned ${response.status}`);
  const body = await response.json();
  const observedAt = typeof body?.current?.time === "string" ? new Date(`${body.current.time}Z`) : new Date(Number.NaN);
  const feelsLikeC = body?.current?.apparent_temperature;
  const weatherCode = body?.current?.weather_code;
  const windKph = body?.current?.wind_speed_10m;
  const precipitationProbabilityPct = body?.hourly?.precipitation_probability?.[0];
  if (![observedAt.getTime(), feelsLikeC, weatherCode, windKph, precipitationProbabilityPct].every(Number.isFinite)) {
    throw new Error(`${nightArea}: Open-Meteo response did not satisfy the cache contract`);
  }
  return {
    nightArea,
    observedAt: observedAt.toISOString(),
    expiresAt: new Date(observedAt.getTime() + 12 * 60 * 60_000).toISOString(),
    condition: conditionForCode(weatherCode),
    feelsLikeC,
    precipitationProbabilityPct,
    windKph,
    source: {
      sourceUrl: url.toString(),
      publisher: "Open-Meteo",
      publishedAt: observedAt.toISOString(),
    },
  };
}

async function main() {
  const observations = await Promise.all(Object.entries(AREAS).map(observation));
  const snapshot = { version: 1, generatedAt: new Date().toISOString(), observations };
  let current = null;
  try { current = JSON.parse(readFileSync(OUTPUT, "utf8")); } catch { /* replace missing or malformed cache */ }
  if (JSON.stringify(current?.observations) === JSON.stringify(observations)) {
    console.log("Weather observations unchanged; snapshot and PR skipped.");
    return;
  }
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Wrote ${observations.length} cached weather observations.`);
  if (!process.argv.includes("--open-pr")) return;
  const branch = weatherBranchName();
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  execFileSync("git", ["checkout", "-b", branch], { cwd: ROOT, stdio: "inherit" });
  execFileSync("git", ["add", OUTPUT], { cwd: ROOT, stdio: "inherit" });
  execFileSync("git", ["commit", "-m", `chore(weather): refresh ${stamp}`], { cwd: ROOT, stdio: "inherit" });
  execFileSync("git", ["push", "-u", "origin", branch], { cwd: ROOT, stdio: "inherit" });
  execFileSync("gh", ["pr", "create", "--title", `Weather cache ${stamp}`, "--body", "Scheduled Open-Meteo cache refresh. Route generation remains third-party-free and consumes this snapshot only after merge."], { cwd: ROOT, stdio: "inherit" });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
