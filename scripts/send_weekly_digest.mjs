// Weekly digest send — trigger seam (Cycle 8 PRD item 2 + item 4).
//
// This is the impure batch edge for the "your London week in pints" digest. The
// COMPOSE + RENDER logic is the pure, unit-tested lib (lib/weeklyDigest.ts); the
// DELIVERY is the provider seam (lib/emailProvider.ts, noop until keys). This
// script only orchestrates and, crucially, GATES: it will not send a single
// email until BOTH an email provider AND explicit opt-in exist.
//
// SAFE NO-OP by design (mirrors scripts/refresh_whats_on.mjs and the
// noopEmailProvider): with no email-provider keys — the state today — it logs
// what it would do and exits 0 without sending. Nothing destructive, no route,
// no mutation.
//
// Run:  node scripts/send_weekly_digest.mjs [--dry-run]
//   --dry-run : force the report-only path even once keys land (never sends).
//
// ── Why this stops short of sending (honest, like resendEmailProvider) ────────
// The generator/renderer/provider live in TypeScript behind the "@/..." path
// alias, which a plain .mjs cannot import. Rather than fork that tested logic
// into drift-prone JS here, this script owns exactly the two runtime decisions
// that DON'T belong in a pure lib — "is a provider configured?" and "who has
// opted in?" — and documents the wiring the production drop-in performs. When
// the owner wires delivery, the real send path becomes a tiny server entry
// (e.g. a Next.js route handler or a `tsx`-run module) that does:
//
//   1. const provider = selectEmailProvider();                 // lib/emailProvider
//   2. const members  = await listOptInAudience();             // Supabase admin, below
//   3. const users    = resolveDigestRecipients(members);      // lib/weeklyDigest
//   4. const messages = users.map((u) => toEmailMessage(
//        generateWeeklyDigest({ user: u, now: new Date(), ...datasets }),
//        { unsubscribeUrl: unsubscribeUrlFor(u) }));            // REQUIRED per-recipient
//        // toEmailMessage substitutes {{unsubscribe_url}} and throws if any
//        // {{…}} placeholder survives — a message can never ship half-templated.
//   5. const results  = await provider.send(messages);         // noop → all "skipped"
//   6. summarise(results);                                      // sent/skipped/invalid/error
//
// The datasets (§ loadDatasets) come from the same public JSON the app ships:
//   - prices:   public/data/pint_index_snapshot.json → observations (PENCE →
//               GBP) + public venue baseline (lib/venuesSlim SLIM_VENUES_PATH);
//   - drops:    lib/pintDrops.listAllVisiblePintDrops("london") (server-only);
//   - whats-on: public/data/whats_on/latest.json (loadWhatsOn baseline).
// Each row's venueId resolves to a borough via venues_slim.json so drops /
// what's-on (which carry no borough) can be scoped to a user's area.

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");

function log(msg) {
  console.info(`[send_weekly_digest] ${msg}`);
}

// Provider gate — mirrors lib/emailProvider.isResendConfigured. Kept in lockstep
// by a test note; the pure lib is the authority the real send path imports.
function isEmailProviderConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

// Recipient source gate — emails live only in Supabase Auth (profiles has no
// email column). No admin client ⇒ no recipients can be resolved.
function isRecipientSourceConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Opt-in audience (documented shape for the drop-in). PRIVACY-FIRST: a user is
 * a recipient ONLY with explicit opt-in and no opt-out. With no user-prefs table
 * today, the flags live on the Supabase Auth user's metadata:
 *   user_metadata.digest_opt_in === true   → opted in
 *   user_metadata.digest_opt_out === true  → opted out (always wins)
 * The production entry pages `admin.auth.admin.listUsers()` and maps each user
 * to { id, email, optIn, optOut, borough, area }, then hands the list to
 * resolveDigestRecipients(). See docs/EMAIL_DIGEST.md for the durable-table plan.
 */
async function listOptInAudience() {
  // Intentionally not implemented in this .mjs seam — see header. The real path
  // runs in a TS server context that can import the tested lib.
  return [];
}

async function main() {
  log(DRY_RUN ? "starting (dry-run: will never send)." : "starting.");

  if (!isEmailProviderConfigured()) {
    log(
      "email provider not configured (RESEND_API_KEY + EMAIL_FROM absent) — noop. "
        + "Nothing sent. Set the keys to activate delivery; see docs/EMAIL_DIGEST.md.",
    );
    return; // exit 0 — the current, expected state.
  }

  if (!isRecipientSourceConfigured()) {
    log(
      "email provider is configured but the recipient source (Supabase admin) is not — "
        + "cannot resolve who opted in. Nothing sent.",
    );
    return;
  }

  const audience = await listOptInAudience();
  if (audience.length === 0) {
    log(
      "no opted-in recipients resolved. Either nobody has opted in yet, or the "
        + "send path is not wired in this seam (see header). Nothing sent.",
    );
    return;
  }

  // If execution ever reaches here with a wired send path, DRY_RUN must still
  // guard against delivery.
  log(
    `${audience.length} candidate recipient(s) resolved. Delivery from this .mjs `
      + "seam is intentionally a pending drop-in (see header) — no email sent.",
  );
}

main().catch((err) => {
  console.error(`[send_weekly_digest] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
