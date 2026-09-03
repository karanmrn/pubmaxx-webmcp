// No-flash theme init. Runs before paint so the page never flashes the wrong
// theme. Served as a static file (covered by CSP `script-src 'self'`) instead of
// an inline <script>, so it needs no per-build hash. Keep in sync with the
// ThemeToggle storage key ("pubmax-theme").
(function () {
  try {
    var t = localStorage.getItem("pubmax-theme");
    if (t !== "light" && t !== "dark") {
      t = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    document.documentElement.dataset.theme = t;
  } catch {}

  // Legacy Mode: larger type / higher contrast / stronger focus rings / forced
  // reduced motion, for older and low-vision users (issue #28). Same no-flash
  // pattern as the theme above — read before paint so there is no flash of
  // small/low-contrast type before this attribute lands. Keep in sync with the
  // LegacyToggle storage key ("pubmax-legacy").
  try {
    var legacy = localStorage.getItem("pubmax-legacy");
    if (legacy === "1") {
      document.documentElement.dataset.legacy = "1";
    }
  } catch {}

  // View Mode (Lock-In / Ledger): a view layer over one data stream. Applied
  // no-flash before paint like the flags above. Ledger IS the heritage view, so
  // it also drives data-legacy (the same key/attribute as Legacy Mode) — never a
  // second accessibility flag. Default is Lock-In. Keep in sync with
  // lib/viewMode.ts (keys "pubmax-mode" / "pubmax-legacy").
  try {
    var mode = localStorage.getItem("pubmax-mode");
    if (mode !== "lock-in" && mode !== "ledger") {
      mode = localStorage.getItem("pubmax-legacy") === "1" ? "ledger" : "lock-in";
    }
    document.documentElement.dataset.mode = mode;
    if (mode === "ledger") {
      document.documentElement.dataset.legacy = "1";
    }
  } catch {}
})();
