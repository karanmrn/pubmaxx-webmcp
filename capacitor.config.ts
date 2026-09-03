// Capacitor iOS wrap (remote-URL mode). The Next.js app is SERVER-RENDERED —
// there is no static export, so the native shell loads the production origin
// directly rather than a bundled webDir. `webDir` must still point at a real
// directory for the CLI's copy step; a two-file stub keeps cap sync from
// baking public/'s ~6 MB of datasets into the binary as dead weight — the
// placeholder index is not served in healthy remote-URL mode, while
// offline.html is served only through server.errorPath after a main-frame
// load failure.
// See docs/CAPACITOR_WRAP.md for the full wrap runbook (signing, APNs, AASA).
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.pubmaxx.app",
  appName: "PUBMAXXING",
  webDir: "native/web-stub",
  server: {
    url: "https://pubmaxxing.com",
    // Remote-URL mode cannot rely on the site's service worker before the
    // first successful load. Capacitor serves this bundled page when the main
    // frame cannot reach production, so an outage is honest and retryable.
    errorPath: "offline.html",
  },
  plugins: {
    // Capacitor 8 bundles SystemBars in core. CSS inset injection covers older
    // Android WebViews; the runtime seam mirrors the site's light/dark choice.
    SystemBars: {
      hidden: false,
      style: "DEFAULT",
      insetsHandling: "css",
    },
  },
};

export default config;
