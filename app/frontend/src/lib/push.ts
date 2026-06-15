// Web Push client helpers: service-worker registration and the opt-in
// subscription flow. Every path is fail-silent / throw-free at the call sites
// the app uses — a missing prerequisite (no SW support, insecure context,
// denied permission) results in a no-op, never a thrown error that could break
// app bootstrap or the command palette.

import { getVapidPublicKey, subscribePush } from "@/api/client";

/** Subscription state for the terminal-themed palette indicator. */
export type PushState = "unsupported" | "denied" | "default" | "subscribed";

/** True when the browser supports the APIs Web Push needs in a secure context. */
export function isPushSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    typeof Notification !== "undefined"
  );
}

/**
 * Register the service worker at the origin root. Guarded by feature
 * detection; resolves to the registration or null (never throws). Safe to call
 * unconditionally on app load.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

/**
 * Convert a base64url VAPID key to the byte buffer `applicationServerKey`
 * wants. Backed by an explicit ArrayBuffer (not ArrayBufferLike) so it
 * satisfies the BufferSource type the Push API expects.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Report the current push subscription state without prompting the user. */
export async function getPushState(): Promise<PushState> {
  if (!isPushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "default";
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? "subscribed" : "default";
  } catch {
    return "default";
  }
}

/**
 * Run the opt-in flow: request notification permission, fetch the VAPID public
 * key, subscribe via PushManager, and POST the subscription to the server.
 * Returns the resulting state. Aborts silently (returning a non-"subscribed"
 * state) on denial, an insecure/unsupported context, or any error — it never
 * throws, so a palette handler can call it directly.
 */
export async function enablePushSubscription(): Promise<PushState> {
  if (!isPushSupported()) return "unsupported";

  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    return "default";
  }
  if (permission !== "granted") {
    return permission === "denied" ? "denied" : "default";
  }

  try {
    const reg = (await navigator.serviceWorker.ready) ?? (await registerServiceWorker());
    if (!reg) return "default";

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const key = await getVapidPublicKey();
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    }
    await subscribePush(sub.toJSON());
    return "subscribed";
  } catch {
    // Insecure context, fetch failure, or subscribe rejection — fail silent.
    return "default";
  }
}
