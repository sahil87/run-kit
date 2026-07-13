/**
 * Pure builder for the command-palette update actions (`run-kit: Update to
 * v{latest}` + `run-kit: Dismiss Update Notice`). Extracted from app.tsx so the
 * qualification gating and label composition are unit-testable without mounting
 * the whole shell — mirroring lib/palette-move.ts. The action bodies are thin
 * wrappers passed in by the caller (they invoke updateNow / dismissUpdate).
 *
 * Note: the palette deliberately IGNORES chip dismissal (dismissal silences only
 * the ambient chip; the palette is deliberate discovery), so the gate here is
 * `qualifies` alone — NOT the chip's `showChip`.
 */

export type UpdatePaletteAction = {
  id: string;
  label: string;
  onSelect: () => void;
};

/**
 * Build the update palette actions. Returns an empty array when no qualifying
 * update is pending (`qualifies` false, or `latest` null — e.g. the `dev`
 * version or no update-available event yet).
 */
export function buildUpdateActions(
  qualifies: boolean,
  latest: string | null,
  onUpdate: () => void,
  onDismiss: () => void,
): UpdatePaletteAction[] {
  if (!qualifies || !latest) return [];
  return [
    {
      id: "run-kit-update",
      label: `run-kit: Update to v${latest}`,
      onSelect: onUpdate,
    },
    {
      id: "run-kit-dismiss-update",
      label: "run-kit: Dismiss Update Notice",
      onSelect: onDismiss,
    },
  ];
}
