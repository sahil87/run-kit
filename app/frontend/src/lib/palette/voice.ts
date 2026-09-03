import type { PaletteAction } from "@/components/command-palette";
import type { VoiceController } from "@/lib/voice-controller";

export const VOICE_HOLD_TO_TALK_ID = "voice-hold-to-talk";

/**
 * The `Voice: hold to talk` palette entry. Palette actions are fire-on-select
 * (hold semantics have no representation in the palette contract), so select
 * TOGGLES capture — starts when idle, stops when recording. Omit-not-disable:
 * the caller spreads this only when voice is enabled and the mic is
 * supported; a null controller (no voice surface mounted) yields no entry.
 */
export function buildVoiceActions(controller: VoiceController | null): PaletteAction[] {
  if (!controller) return [];
  return [
    {
      id: VOICE_HOLD_TO_TALK_ID,
      label: "Voice: hold to talk",
      onSelect: () => controller.toggle(),
    },
  ];
}
