// RunKit service worker — Web Push delivery.
//
// Served at the origin root (/sw.js) so its scope covers the whole app. It is
// registered on app load (see src/lib/push.ts). Web Push requires a secure
// context (HTTPS or localhost); registration is skipped silently otherwise.

const DEFAULT_ICON = "/generated-icons/icon-192.png";
const DEFAULT_TITLE = "RunKit";

// `push`: the browser's push service wakes the SW even when the PWA tab is
// closed, delivering the payload POSTed via `rk notify` → /api/notify.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    if (event.data) data = event.data.json();
  } catch (_e) {
    // Non-JSON or empty payload — fall back to a plain-text body if present.
    try {
      data = { body: event.data ? event.data.text() : "" };
    } catch (_e2) {
      data = {};
    }
  }

  const title = (data && data.title) || DEFAULT_TITLE;
  const body = (data && data.body) || "";
  const icon = (data && data.icon) || DEFAULT_ICON;

  event.waitUntil(
    self.registration.showNotification(title, { body, icon }),
  );
});

// `notificationclick`: focus an already-open RunKit tab if one exists,
// otherwise open a new window at the app root.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) return client.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow("/");
        return undefined;
      }),
  );
});
