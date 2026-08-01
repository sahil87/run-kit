import { detectPlatform, formatCombo } from "./keybindings";

/**
 * Shared Enter-key policy for run-kit's two text-input surfaces — the docked
 * compose strip and the chat send form. Both keydown handlers route Enter
 * through this ONE classifier so the surfaces cannot diverge (divergence is a
 * defect per the intake's consistency requirement).
 *
 * Policy (260801-hsxm, replacing the pointer-aware policy from 260719-mxvw):
 *   - Enter (no modifier) = newline on ALL pointer types (the textarea
 *     default — Enter accumulates lines locally; a reflexive Enter can no
 *     longer fire a half-written prompt at an agent).
 *   - Shift+Enter = newline (kept for muscle memory; now redundant with plain
 *     Enter).
 *   - Cmd/Ctrl+Enter = submit — the ONLY submit chord, on all devices.
 *   - Alt+Enter = insert-without-submit ALWAYS (deliver the text to the pane's
 *     input box without pressing Enter).
 *
 * The old fine/coarse pointer distinction is gone from Enter classification —
 * it existed solely because touch keyboards could not express the former
 * Enter-submits policy; with Enter=newline everywhere there is nothing left to
 * distinguish.
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
 * Classify an Enter keydown. Precedence (first match wins): non-Enter /
 * IME-composing → default; meta/ctrl → submit (the only submit chord); alt →
 * insert; else → default (newline — plain Enter and Shift+Enter alike, on
 * every pointer type).
 */
export function classifyComposeEnter(key: ComposeKeyInput): ComposeEnterAction {
  if (key.key !== "Enter" || key.isComposing) return "default";
  if (key.metaKey || key.ctrlKey) return "submit";
  if (key.altKey) return "insert";
  return "default";
}

/**
 * Platform-formatted keycap for the submit chord — `⌘Enter` on mac,
 * `Ctrl+Enter` elsewhere. One helper so both surfaces' Send tooltips render
 * the identical chip (reuses the keybinding registry's `formatCombo`
 * conventions rather than duplicating platform logic). The submit chord is a
 * focused-textarea editing chord with no registry binding, so a computed
 * static string is the correct Tip `kbd` form.
 */
export function composeSubmitKeycap(): string {
  return formatCombo({ code: "Enter", tier: "cmd" }, detectPlatform());
}
