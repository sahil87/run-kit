// The shared voice controller slot. The HUD mount owns the capture lifecycle
// and registers its imperative seam here; the palette action (and any other
// voice trigger) resolves the controller through this registry instead of
// prop-drilling a handle across the shell. Same module-slot shape as
// lib/compose-strip-events.ts. Null when unregistered — every caller treats
// "no controller" as "voice surfaces stay unmounted/omitted".

import { useSyncExternalStore } from "react";

export interface VoiceController {
  start(): void;
  stop(): void;
  toggle(): void;
  isRecording(): boolean;
}

let controller: VoiceController | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Register the controller. The returned unregister clears the slot ONLY if
 *  it still points at this impl — a stale cleanup never clobbers a newer
 *  mount's registration. */
export function registerVoiceController(impl: VoiceController): () => void {
  controller = impl;
  notify();
  return () => {
    if (controller === impl) {
      controller = null;
      notify();
    }
  };
}

/** The registered controller, or null when no voice surface is mounted. */
export function voiceController(): VoiceController | null {
  return controller;
}

/** Subscribe to registration changes (for `useSyncExternalStore`). */
export function subscribeVoiceController(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reactive controller read — re-renders on register/unregister. */
export function useVoiceController(): VoiceController | null {
  return useSyncExternalStore(subscribeVoiceController, voiceController);
}
