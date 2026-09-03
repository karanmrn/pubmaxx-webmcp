"use client";

import { useEffect } from "react";

// Registers the offline service worker (public/sw.js — issue #32, PRD § The
// Spill). Renders nothing and nags about nothing: registration is silent,
// updates install in the background.
//
// The ?v= query carries the per-deploy build id (inlined from next.config.mjs
// as NEXT_PUBLIC_SW_VERSION). A new deploy changes the registration URL, the
// browser treats it as a new worker, and its `activate` step preserves usable
// offline entries while retiring superseded cache versions only when safe.
export default function OfflineReady() {
  useEffect(() => {
    // Dev builds churn assets constantly; a SW there only causes confusion.
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    let registered = false;
    let pageLoaded = document.readyState === "complete";
    let firstPinsReady = Boolean(window.__pubmaxFirstPinsReady);
    try {
      firstPinsReady =
        firstPinsReady ||
        window.localStorage.getItem("pubmax:first-pins-seen:v1") === "1";
    } catch {
      // A blocked storage area leaves the in-memory signal as the fallback.
    }

    const register = () => {
      if (registered) return;
      registered = true;
      const version = process.env.NEXT_PUBLIC_SW_VERSION?.trim();
      if (!version) return;
      navigator.serviceWorker
        .register(
          `/sw.js?v=${encodeURIComponent(version)}&cache-policy=write-safe-v1`,
        )
        .then((registration) => {
          registration.addEventListener("updatefound", () => {
            console.info(
              "PUBMAXXING: a new offline version is installing.",
            );
          });
        })
        .catch(() => {
          // Offline support is progressive enhancement — never surface a
          // registration failure to the user.
        });
    };

    const scheduleRegister = () => {
      if (!pageLoaded || !firstPinsReady || registered) return;
      const run = () => register();
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(run, { timeout: 2_000 });
      } else {
        window.setTimeout(run, 0);
      }
    };
    const onLoad = () => {
      pageLoaded = true;
      scheduleRegister();
    };
    const onFirstPins = () => {
      firstPinsReady = true;
      scheduleRegister();
    };

    // A loaded document is not enough: registration must wait until the map
    // has shown its first pins, so install work cannot tax the cold path.
    window.addEventListener("pubmax:first-pins", onFirstPins, { once: true });
    if (pageLoaded) scheduleRegister();
    else window.addEventListener("load", onLoad, { once: true });
    return () => {
      window.removeEventListener("pubmax:first-pins", onFirstPins);
      window.removeEventListener("load", onLoad);
    };
  }, []);

  return null;
}
