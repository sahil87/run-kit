import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { registerServiceWorker } from "@/lib/push";
import { migrateLegacyStorageKeys } from "@/lib/legacy-storage-migration";
import "./globals.css";

// Copy `runkit-*`/`runkit:` localStorage keys to their `hexokit` counterparts
// before ANY app module evaluates: ESM runs all static imports before this
// module's body, and the router chain (app.tsx → quake-terminal →
// compose-draft-store) hydrates from localStorage at module scope, so a
// static `./router` import would read the new keys before the copy and lose
// first-boot legacy drafts/history. Marker-guarded one-shot; fail-silent when
// storage is blocked.
migrateLegacyStorageKeys();

async function bootstrap() {
  const { router } = await import("./router");
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}
void bootstrap();

// Register the Web Push service worker on app load. Guarded + fail-silent: a
// browser without service-worker support (or an insecure context) is a no-op.
void registerServiceWorker();
