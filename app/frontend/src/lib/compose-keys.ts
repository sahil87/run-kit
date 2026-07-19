/**
 * Shared Enter-key policy for run-kit's two text-input surfaces — the docked
 * compose strip and the chat send form (260719-mxvw). Both keydown handlers
 * route Enter through this ONE classifier so the surfaces cannot diverge
 * (divergence is a defect per the intake's consistency requirement).
 *
 * Policy:
 *   - Fine pointer:  Enter = submit, Shift+Enter = newline (unchanged).
 *   - Coarse pointer: Enter = newline (not intercepted — the textarea default);
 *     submit via the Send button.
 *   - Cmd/Ctrl+Enter = submit ALWAYS, on all devices (the escape hatch for a
 *     hardware keyboard on a touch device).
 *   - Alt+Enter = insert-without-submit ALWAYS (deliver the text to the pane's
 *     input box without pressing Enter).
 *
 * Pure and component-free so the full matrix is unit-testable without a mount
 * (the `palette-move.ts` extraction pattern).
 */

/** What a keydown should do: submit the text, insert it without submitting, or
 * leave the textarea's native behavior (newline insertion) untouched. */
export type ComposeEnterAction = "submit" | "insert" | "default";

/** The subset of a keyboard event the classifier reads — structural so both
 * React synthetic events and plain objects (tests) satisfy it. */
export interface ComposeKeyInput {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  /** From `e.nativeEvent.isComposing` — an IME-composing Enter is never
   * intercepted. */
  isComposing: boolean;
}

/**
 * Classify an Enter keydown against the pointer type. Precedence (first match
 * wins): non-Enter / IME-composing → default; meta/ctrl → submit (universal);
 * alt → insert; shift → default (newline, always); coarse pointer → default
 * (newline; the Send button submits); else → submit (fine-pointer Enter).
 */
export function classifyComposeEnter(
  key: ComposeKeyInput,
  coarse: boolean,
): ComposeEnterAction {
  if (key.key !== "Enter" || key.isComposing) return "default";
  if (key.metaKey || key.ctrlKey) return "submit";
  if (key.altKey) return "insert";
  if (key.shiftKey) return "default";
  if (coarse) return "default";
  return "submit";
}
