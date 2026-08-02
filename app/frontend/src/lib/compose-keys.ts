import { detectPlatform, formatCombo } from "./keybindings";

/**
 * Shared Enter-key policy for run-kit's two text-input surfaces — the docked
 * compose strip and the chat send form. Both keydown handlers route Enter
 * through this ONE classifier, so it stays the single authority for both
 * surfaces' Enter policy. The surfaces DELIBERATELY diverge on plain Enter
 * (260802-lj98, revising 260801-hsxm's shared Enter=newline) — the divergence
 * is declared here, per surface, never forked at a call site:
 *
 *   - `"strip"` — plain Enter = insert-line (transmit `text + "\n"` to the
 *     focused pane and clear the draft). The strip overlays the VISIBLE
 *     terminal: staged text visibly lands in the pane's composer (Claude Code
 *     treats a raw `"\n"` as newline-insert), so consecutive Enters stage
 *     sentence-per-line exactly like typing into the pane itself.
 *   - `"chat"` — plain Enter = newline (the textarea default, unchanged from
 *     260801-hsxm). The chat lens cannot show the pane's input box, so
 *     Enter-as-insert there would make typed text visibly vanish.
 *
 * Shared on both surfaces: Shift+Enter = local newline; Cmd/Ctrl+Enter =
 * submit — the ONLY submit chord; Alt+Enter = insert-without-submit
 * (byte-exact, no trailing byte); IME-composing Enter is never intercepted.
 *
 * The `surface` parameter is REQUIRED (no default) so both call sites must
 * declare which policy they get — a silent default would recreate exactly the
 * drift this shared classifier exists to prevent. The classifier stays pure,
 * component-free, and text-agnostic (empty-text handling lives at the call
 * sites), so the full matrix is unit-testable without a mount (the
 * `palette-move.ts` extraction pattern).
 */

/** What a keydown should do: submit the text, insert it without submitting,
 * transmit it as a line (text + `"\n"`), or leave the textarea's native
 * behavior (newline insertion) untouched. */
export type ComposeEnterAction = "submit" | "insert" | "insert-line" | "default";

/** Which input surface is asking — the strip and the chat lens deliberately
 * diverge on plain Enter (see the header comment for the rationale). */
export type ComposeSurface = "strip" | "chat";

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
 * Classify an Enter keydown for a given surface. Precedence (first match
 * wins): non-Enter / IME-composing → default; meta/ctrl → submit (the only
 * submit chord); alt → insert; shift → default (local newline); plain Enter →
 * insert-line on the strip, default (newline) in chat.
 */
export function classifyComposeEnter(
  key: ComposeKeyInput,
  surface: ComposeSurface,
): ComposeEnterAction {
  if (key.key !== "Enter" || key.isComposing) return "default";
  if (key.metaKey || key.ctrlKey) return "submit";
  if (key.altKey) return "insert";
  if (key.shiftKey) return "default";
  return surface === "strip" ? "insert-line" : "default";
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
