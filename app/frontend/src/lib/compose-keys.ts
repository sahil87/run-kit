import { detectPlatform, formatCombo } from "./keybindings";

/**
 * Shared Enter-key policy for run-kit's compose text inputs — the compose
 * strip's two modes (normal terminal composition and selection broadcast) and
 * the quake terminal's docked compose all route Enter through this ONE
 * classifier, so it stays the single authority for every compose surface's
 * Enter policy. The surfaces DELIBERATELY diverge on plain Enter
 * (260802-lj98, revising 260801-hsxm's shared Enter=newline) — the divergence
 * is declared here, per surface, never forked at a call site:
 *
 *   - `"strip"` — plain Enter = insert-line (transmit `text + "\n"` to the
 *     focused pane and clear the draft). The strip overlays the VISIBLE
 *     terminal: staged text visibly lands in the pane's composer (Claude Code
 *     treats a raw `"\n"` as newline-insert), so consecutive Enters stage
 *     sentence-per-line exactly like typing into the pane itself.
 *   - `"broadcast"` — plain Enter = newline (the textarea default, unchanged
 *     from 260801-hsxm). The selection broadcast addresses a FROZEN, possibly
 *     cross-server recipient set — there is no single visible pane the staged
 *     text could land in, so Enter-as-insert here would make typed text
 *     visibly vanish.
 *   - `"quake"` — the quake terminal's docked compose: plain Enter = submit
 *     (send the operator message — the compose addresses the fixed operator
 *     window, not the visible pane, so there is nothing to stage a line
 *     into), and Shift+Enter = insert-line (the call site inserts a LOCAL
 *     newline — the quake surface borrows the action name for its one
 *     multi-line path). Alt+Enter joins Shift+Enter as insert-line here: the
 *     byte-exact insert needs a visible pane to land in and the docked
 *     compose has none (its only operator path is the submit), so the
 *     classifier declares the local newline rather than promise an insert the
 *     call site cannot perform.
 *
 * Shared across the surfaces: Shift+Enter = local newline (the quake surface
 * classifies it as insert-line and its call site inserts the newline itself);
 * Cmd/Ctrl+Enter (shift-less — the match is exact on Shift) = submit;
 * Shift+Cmd/Ctrl+Enter = default — deliberately left un-consumed so it
 * bubbles to the global zen-toggle chord (keybindings.ts, ⇧⌘⏎/⇧Ctrl+⏎);
 * Alt+Enter = insert-without-submit (byte-exact, no trailing byte) on the
 * strip surfaces, insert-line on the quake surface (the quake bullet above);
 * IME-composing Enter is never intercepted. The submit chord is the ONLY
 * submit on the strip surfaces; on the quake surface plain Enter submits too.
 *
 * The `surface` parameter is REQUIRED (no default) so every call site must
 * declare which policy it gets — a silent default would recreate exactly the
 * drift this shared classifier exists to prevent. The classifier stays pure,
 * component-free, and text-agnostic (empty-text handling lives at the call
 * sites), so the full matrix is unit-testable without a mount (the
 * `palette/move.ts` extraction pattern).
 */

/** What a keydown should do: submit the text, insert it without submitting,
 * transmit it as a line (text + `"\n"`), or leave the textarea's native
 * behavior (newline insertion) untouched. */
export type ComposeEnterAction = "submit" | "insert" | "insert-line" | "default";

/** Which input mode is asking — the strip's normal and broadcast modes
 * deliberately diverge on plain Enter (see the header comment for the
 * rationale). The `"broadcast"` value names the no-visible-pane policy;
 * `"quake"` names the quake terminal's docked compose (Enter submits,
 * Shift+Enter inserts the local newline). */
export type ComposeSurface = "strip" | "broadcast" | "quake";

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
 * wins): non-Enter / IME-composing → default; meta/ctrl WITHOUT shift →
 * submit (the only submit chord — exact on Shift); meta/ctrl WITH shift →
 * default, alt or not (the shift-carrying chord must bubble to the global
 * zen-toggle binding, so it is never consumed here); alt → insert (insert-line
 * on the quake surface — it has no pane for the byte-exact raw insert, so
 * Alt+Enter is its second local-newline chord); shift →
 * default (local newline) — insert-line on the quake surface, whose call site
 * performs that local newline itself; plain Enter → insert-line on the strip,
 * submit on the quake surface, default (newline) in broadcast.
 */
export function classifyComposeEnter(
  key: ComposeKeyInput,
  surface: ComposeSurface,
): ComposeEnterAction {
  if (key.key !== "Enter" || key.isComposing) return "default";
  if (key.metaKey || key.ctrlKey) return key.shiftKey ? "default" : "submit";
  if (key.altKey) return surface === "quake" ? "insert-line" : "insert";
  if (key.shiftKey) return surface === "quake" ? "insert-line" : "default";
  if (surface === "quake") return "submit";
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
