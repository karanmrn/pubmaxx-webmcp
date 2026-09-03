// Installed-web-app push registration seam. This module NEVER runs on boot and
// never asks permission by itself: a UI may call registerWebPush() only after a
// real user action, preserving the shared prompt budget and consent boundary.

import { encodeWebPushSubscription } from "@/lib/webPushSubscription";

function applicationServerKey(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return bytes.buffer instanceof ArrayBuffer ? new Uint8Array(bytes.buffer) : null;
  } catch {
    return null;
  }
}

async function currentWebSubscriptionToken(): Promise<string | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  if (!("PushManager" in window)) return null;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return null;
    return encodeWebPushSubscription(subscription.toJSON());
  } catch {
    return null;
  }
}

/** Request permission, create/reuse a browser subscription and register it on
 * the identity-free push-token route. Returns the encoded token on success, or
 * null on any unsupported, denied, unconfigured or network-failed path. */
export async function registerWebPush(): Promise<string | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  if (!("PushManager" in window) || !("Notification" in window)) return null;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const key = publicKey ? applicationServerKey(publicKey) : null;
  if (!key) {
    console.info(
      "[webPush] registration skipped: NEXT_PUBLIC_VAPID_PUBLIC_KEY is missing or invalid.",
    );
    return null;
  }

  try {
    const permission = Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;
    if (permission !== "granted") return null;

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription()
      ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
    const token = encodeWebPushSubscription(subscription.toJSON());
    if (!token) return null;

    const response = await fetch("/api/push-tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, platform: "web" }),
    });
    return response.ok ? token : null;
  } catch {
    return null;
  }
}

/** Unsubscribe the browser PushSubscription and ask the server to drop the
 * identity-free token row. Best-effort; never throws. */
export async function unregisterWebPush(): Promise<boolean> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return false;
  try {
    const token = await currentWebSubscriptionToken();
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) await subscription.unsubscribe();
    if (token) {
      await fetch("/api/push-tokens", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      }).catch(() => null);
    }
    return true;
  } catch {
    return false;
  }
}
