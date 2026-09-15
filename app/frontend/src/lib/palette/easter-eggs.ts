/**
 * Pure builder for the two screen-break Easter-egg palette entries (the
 * lib/palette/version.ts pattern: pure, dependency-free, unit-testable). The
 * palette is the chord — no keybinding is registered. Palette fires are
 * `force` (never rate limited, never written to storage); the only silent
 * no-ops are the store's environmental gates (reduced motion, viewport
 * < 640 px, a flight already in progress).
 */

import type { PaletteAction } from "@/components/command-palette";
import type { ScreenBreakEgg } from "@/lib/screen-break-store";

export function buildEasterEggActions(
  fire: (egg: ScreenBreakEgg, opts?: { force?: boolean }) => boolean,
): PaletteAction[] {
  return [
    {
      id: "easter-egg-smash",
      label: "Easter egg: Smash",
      description: "the screen cracks open",
      onSelect: () => {
        fire("smash", { force: true });
      },
    },
    {
      id: "easter-egg-peek",
      label: "Easter egg: Peek",
      description: "something in there is watching",
      onSelect: () => {
        fire("peek", { force: true });
      },
    },
  ];
}
