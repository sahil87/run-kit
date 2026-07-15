/**
 * Pure builder for the command-palette navigation actions (260714-uco1):
 * browser-history `Go: Back` / `Go: Forward` and the current route's
 * ANCESTOR-navigation entries (`Go: Server Cabin` / `Go: Cockpit`). Extracted
 * from app.tsx so the route-gating and label composition are unit-testable
 * without mounting the whole shell — mirroring lib/palette-view.ts /
 * lib/palette-move.ts. The action bodies are thin wrappers passed in by the
 * caller (they call `router.history.back()/.forward()` and `navigate(...)`).
 *
 * Constitution V palette parity for the top-bar history arrows + hierarchy
 * dropdown. History actions are ALWAYS offered (history is global; forward is a
 * harmless no-op with no forward entry, matching the always-active arrow). The
 * ancestor entries mirror the hierarchy dropdown's contents for the current
 * route — ancestors only, nearest-first — so a solo Cockpit route (no
 * ancestors) yields only the two history actions.
 */

export type NavPaletteAction = {
  id: string;
  label: string;
  onSelect: () => void;
};

/**
 * The route's page mode, matching `TopBarMode`. Drives which ancestor entries
 * are offered:
 *   - `terminal`: `Go: Server Cabin` + `Go: Cockpit`
 *   - `board` / `root`: `Go: Cockpit`
 *   - `cockpit`: none (the root has no ancestors)
 */
export type NavMode = "terminal" | "board" | "root" | "cockpit";

/**
 * Build the navigation palette actions. Returns the two history actions
 * (always) followed by the route-appropriate ancestor actions.
 *
 * `server` is required for the `terminal`-mode `Go: Server Cabin` target; when
 * empty (e.g. before the route resolves), the Server Cabin entry is omitted so
 * the action never navigates to `/` (a blank server).
 */
export function buildNavActions(
  mode: NavMode,
  server: string,
  handlers: {
    onBack: () => void;
    onForward: () => void;
    onServerCabin: () => void;
    onCockpit: () => void;
  },
): NavPaletteAction[] {
  const actions: NavPaletteAction[] = [
    { id: "go-back", label: "Go: Back", onSelect: handlers.onBack },
    { id: "go-forward", label: "Go: Forward", onSelect: handlers.onForward },
  ];

  // Ancestor entries — nearest-first, mirroring the hierarchy dropdown.
  if (mode === "terminal" && server) {
    actions.push({
      id: "go-server-cabin",
      label: "Go: Server Cabin",
      onSelect: handlers.onServerCabin,
    });
  }
  if (mode === "terminal" || mode === "board" || mode === "root") {
    actions.push({
      id: "go-cockpit",
      label: "Go: Cockpit",
      onSelect: handlers.onCockpit,
    });
  }

  return actions;
}
