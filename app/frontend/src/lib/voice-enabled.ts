// Caller-side voice gate: one cached read of the settings registry decides
// whether ANY voice surface mounts (mic chip, HUD, hold chord, palette
// entry). Fail-closed in both directions — the value is false until the
// registry load settles, and a failed load stays false. Read once per app
// lifetime: no live settings feed exists, so a flag flip applies on reload.
// Same module-store idiom as lib/compose-strip-events.ts.

import { useSyncExternalStore } from "react";
import { getSettingsEntries } from "@/api/client";

export const VOICE_ENABLED_KEY = "voice_enabled";

let voiceEnabled = false;
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** The module-level promise dedup: the first subscriber triggers the single
 *  fetch; later subscribers share it, and a settled result never refetches. */
function ensureLoaded(): void {
  if (loadPromise) return;
  loadPromise = getSettingsEntries()
    .then((entries) => {
      voiceEnabled = entries.some(
        (entry) => entry.key === VOICE_ENABLED_KEY && entry.value === true,
      );
    })
    .catch(() => {
      voiceEnabled = false;
    });
  void loadPromise.then(() => {
    for (const listener of listeners) listener();
  });
}

/** Snapshot for `useSyncExternalStore`: false until the registry read settles
 *  with `voice_enabled: true`. */
export function isVoiceEnabled(): boolean {
  return voiceEnabled;
}

/** Subscribe to the gate value; subscribing kicks off the one-shot registry
 *  read. Returns the unsubscribe function. */
export function subscribeVoiceEnabled(listener: () => void): () => void {
  ensureLoaded();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether the settings registry carries `voice_enabled: true`. Callers gate
 *  MOUNTS on this (never render-then-null inside a voice component). */
export function useVoiceEnabled(): boolean {
  return useSyncExternalStore(subscribeVoiceEnabled, isVoiceEnabled);
}
