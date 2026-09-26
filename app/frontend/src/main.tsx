import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { registerServiceWorker } from "@/lib/push";
import { migrateLegacyStorageKeys } from "@/lib/legacy-storage-migration";
import "./globals.css";

// Copy `runkit-*`/`runkit:` localStorage keys to their `hexokit` counterparts
// before the tree mounts so first paint and every context read the new keys.
// Marker-guarded one-shot; fail-silent when storage is blocked.
migrateLegacyStorageKeys();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

// Register the Web Push service worker on app load. Guarded + fail-silent: a
// browser without service-worker support (or an insecure context) is a no-op.
void registerServiceWorker();
