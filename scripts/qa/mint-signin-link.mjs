#!/usr/bin/env node
// Mint a real Supabase magic-sign-in link for QA, with no personal mailbox
// needed.
//
// Why this exists: QA (human or agent) cannot verify a signed-in journey on
// production or preview without receiving a real email. This script uses the
// Supabase ADMIN API (auth.admin.generateLink) to produce the same one-time
// link an email would carry, for a throwaway QA address only. It never adds
// a server route or any new attack surface: it is an operator-side tool that
// needs the service role key, which only an operator already holds.
//
// The minted link, once opened, lands on this app's normal
// /auth/callback route and completes sign-in exactly like a real emailed
// link opened in a fresh browser (the app's cross-browser-link path in
// lib/authRedirect.ts / AuthProvider.tsx — see docs/QA_SIGNED_IN_JOURNEYS.md).
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   SUPABASE_URL=... \
//     node scripts/qa/mint-signin-link.mjs --email qa+journey1@pubmaxxing.com --base-url https://preview.example.com
//
//   node scripts/qa/mint-signin-link.mjs --dry-run --email qa+journey1@pubmaxxing.com --base-url http://localhost:3000
//
// Flags:
//   --email <address>     required. Must match the QA test pattern (see below).
//   --base-url <url>      required. The site origin the link should return to
//                          (production, a preview deployment, or localhost).
//   --type <magiclink|signup>   optional, default "magiclink". Use "signup"
//                          the first time a brand-new QA address signs in;
//                          Supabase's "magiclink" type requires the user to
//                          already exist.
//   --dry-run              validate every gate and print what would be
//                          requested, without calling Supabase or minting a
//                          real link. Never logs a token because none is
//                          requested.
//
// Safety gates (all refuse loudly, never silently downgrade):
//   1. SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
//      must be present, unless --dry-run.
//   2. The email's local part must not match a production handle.
//   3. The email must match the QA test pattern: qa+<anything>@pubmaxxing.com
//      (case-insensitive), or it must equal the QA_TEST_EMAIL env var exactly
//      (an operator-set allowance for one specific non-pattern address).
//   4. The minted link is printed to stdout only. It is never written to a
//      file or log. Treat your terminal scrollback as holding a live
//      credential until the link is used or expires.

import { createRequire } from "node:module";

const PRODUCTION_HANDLES = ["karan", "karanszn", "karanmrn", "karanmanoharan"];
const QA_EMAIL_PATTERN = /^qa\+[^@]+@pubmaxxing\.com$/i;

function parseArgs(argv) {
  const args = { type: "magiclink", dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--email") args.email = argv[++i];
    else if (arg === "--base-url") args.baseUrl = argv[++i];
    else if (arg === "--type") args.type = argv[++i];
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else {
      process.stderr.write(`Unknown argument: ${arg}\n`);
      process.exitCode = 1;
      return null;
    }
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node scripts/qa/mint-signin-link.mjs --email <qa+x@pubmaxxing.com> --base-url <url> [--type magiclink|signup] [--dry-run]",
      "",
      "See the file header for the full safety-gate list and docs/QA_SIGNED_IN_JOURNEYS.md for the end-to-end journey.",
      "",
    ].join("\n"),
  );
}

function localPart(email) {
  const at = email.indexOf("@");
  return at === -1 ? email : email.slice(0, at);
}

function isProductionHandle(email) {
  const local = localPart(email).toLowerCase();
  const beforePlus = local.split("+")[0];
  return PRODUCTION_HANDLES.includes(local) || PRODUCTION_HANDLES.includes(beforePlus);
}

function isAllowedTestEmail(email) {
  if (QA_EMAIL_PATTERN.test(email)) return true;
  const pinned = process.env.QA_TEST_EMAIL;
  return typeof pinned === "string" && pinned.length > 0 && pinned === email;
}

/**
 * A fresh 32-hex-char id in the same shape the app's own client generates
 * (AUTH_ATTEMPT_ID_PATTERN in lib/authRedirect.ts). The app's callback route
 * only checks this shape; it does not require a matching browser-local
 * attempt record, because a magic link opened in a browser that never
 * requested it (a different browser, or here, an admin-minted link) is a
 * supported path — the UI shows a visible "Signed in as …" confirmation
 * instead of silently trusting the landing (see CapturedAuthCallback in
 * lib/authRedirect.ts).
 */
function randomAttemptId() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function buildRedirectTo(baseUrl) {
  const origin = new URL(baseUrl);
  const callback = new URL("/auth/callback", origin);
  callback.searchParams.set("_authAttempt", randomAttemptId());
  return callback.toString();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) return;
  if (args.help) {
    printHelp();
    return;
  }

  if (!args.email) {
    process.stderr.write("Refused: --email is required.\n");
    process.exitCode = 1;
    return;
  }
  if (!args.baseUrl) {
    process.stderr.write("Refused: --base-url is required.\n");
    process.exitCode = 1;
    return;
  }
  if (args.type !== "magiclink" && args.type !== "signup") {
    process.stderr.write('Refused: --type must be "magiclink" or "signup".\n');
    process.exitCode = 1;
    return;
  }

  if (isProductionHandle(args.email)) {
    process.stderr.write(
      `Refused: "${args.email}" looks like a production handle. This tool never mints links for real accounts.\n`,
    );
    process.exitCode = 1;
    return;
  }
  if (!isAllowedTestEmail(args.email)) {
    process.stderr.write(
      `Refused: "${args.email}" does not match the QA test pattern (qa+*@pubmaxxing.com) and does not match QA_TEST_EMAIL.\n`,
    );
    process.exitCode = 1;
    return;
  }

  let redirectTo;
  try {
    redirectTo = buildRedirectTo(args.baseUrl);
  } catch {
    process.stderr.write(`Refused: --base-url "${args.baseUrl}" is not a valid URL.\n`);
    process.exitCode = 1;
    return;
  }

  if (args.dryRun) {
    process.stdout.write(
      [
        "Dry run — no Supabase call made, no link minted.",
        `  email:       ${args.email}`,
        `  type:        ${args.type}`,
        `  redirectTo:  ${redirectTo}`,
        "All gates passed. Re-run without --dry-run (with SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL set) to mint the real link.",
        "",
      ].join("\n"),
    );
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    process.stderr.write(
      "Refused: SUPABASE_SERVICE_ROLE_KEY and SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) must both be set.\n",
    );
    process.exitCode = 1;
    return;
  }

  const require = createRequire(import.meta.url);
  let createClient;
  try {
    ({ createClient } = require("@supabase/supabase-js"));
  } catch {
    process.stderr.write("Refused: @supabase/supabase-js is not installed. Run npm install first.\n");
    process.exitCode = 1;
    return;
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await admin.auth.admin.generateLink({
    type: args.type,
    email: args.email,
    options: { redirectTo },
  });

  if (error) {
    process.stderr.write(`Supabase refused to mint the link: ${error.message}\n`);
    if (args.type === "magiclink") {
      process.stderr.write('If this is a brand-new QA address, retry with --type signup.\n');
    }
    process.exitCode = 1;
    return;
  }

  const link = data?.properties?.action_link;
  if (!link) {
    process.stderr.write("Supabase returned no action_link. Nothing to print.\n");
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    [
      `Minted a ${args.type} link for ${args.email}:`,
      "",
      link,
      "",
      "Open it in a browser now — Supabase magic links expire (default 1 hour) and are one-time use.",
      "This link was printed to stdout only. It was not written to any file or log.",
      "",
    ].join("\n"),
  );
}

main().catch((err) => {
  process.stderr.write(`Unexpected error: ${err?.message ?? err}\n`);
  process.exitCode = 1;
});
