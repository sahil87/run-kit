/**
 * Declarative keyboard-binding registry (260730-g40a).
 *
 * One module owns every app chord as DATA: the run-kit action tier
 * (`Shift+CmdOrCtrl+<key>` on Windows/Linux; on macOS several actions demote
 * to the unshifted ⌘ tier — see `macTier`/`defaultComboFor`, 260730-n789),
 * the migrated legacy chords (⌘K palette, ⌘\ sidebar, ⌘. lens
 * cycle, Ctrl+` chat toggle, board ⌘[/⌘] pane cycle — combos unchanged), the
 * claimed-key map (shell menu accelerators, OS keys, browser-reserved keys —
 * per tier), the per-device override layer
 * (`localStorage["runkit-keybindings"]`, diffs
 * only), conflict detection, chord capture, and per-platform formatting.
 *
 * Everything here is pure and DOM-light (the localStorage read/write are thin
 * try/catch wrappers; `shouldSuppressChord` inspects an event target) — the
 * same pure-helper + colocated-unit-test pattern as `window-view.ts` /
 * `palette-*.ts`. React integration lives in `hooks/use-keybindings.ts`
 * (reactive store) and `hooks/use-keybinding-dispatch.ts` (the one window
 * -level keydown listener per route shell).
 *
 * Matching is on `KeyboardEvent.code` — layout-independent, and it sidesteps
 * the shifted-accelerator character-resolution flakiness the desktop shell
 * docs flag (`app/desktop/src/menu.ts`). Alt chords are never matched: Alt is
 * not part of any tier (macOS uses it for character composition) — which is
 * also why the mac desktop shell parks its Hosts-switcher accelerators on
 * ⌥⌘1–9 (260731-nv5r): territory this registry can never claim.
 */

/**
 * The three chord tiers:
 * - `shifted` — `Shift+CmdOrCtrl` (the run-kit action tier; uniform per intake
 *   decision (B): letter consistency over chord weight).
 * - `cmd` — unshifted `CmdOrCtrl` (legacy punctuation chords: ⌘K ⌘\ ⌘. ⌘[⌘]).
 *   Matches Meta OR Ctrl, preserving each legacy listener's exact predicate.
 * - `ctrl` — plain Ctrl on BOTH platforms (the Ctrl+` chat toggle; Cmd+` is
 *   macOS window cycling and must not be bound).
 */
export type BindingTier = "shifted" | "cmd" | "ctrl";

/** Where a binding applies. Descriptive (overlay badges + conflict scoping);
 *  actual applicability is handler presence at each dispatcher mount. The
 *  `sidebar` value is schema-reserved (no v1 binding uses it). */
export type BindingScope = "global" | "terminal" | "board" | "sidebar";

/** `builtin` = the shipped registry actions; `macro` = user-defined macro
 *  bindings over riff presets / palette actions (260730-hbyh — model in
 *  `lib/macros.ts`, executor in `app.tsx`). */
export type BindingKind = "builtin" | "macro";

/** Keycap rendering platform. `other` = Windows/Linux. */
export type BindingPlatform = "mac" | "other";

/** Host facts the resolver needs: keycap platform + desktop-shell presence. */
export type BindingHost = { platform: BindingPlatform; shell: boolean };

/** A concrete chord: layout-independent key code + modifier tier. */
export type BindingCombo = { code: string; tier: BindingTier };

export type KeyBinding = {
  /** Stable id; doubles as the palette action id where one exists. */
  actionId: string;
  /** `KeyboardEvent.code` — layout-independent ("KeyN", "BracketLeft"). */
  code: string;
  /** Base (Windows/Linux) default tier. */
  tier: BindingTier;
  /** macOS default-tier refinement (260730-n789): the tier this binding's
   *  DEFAULT combo uses on mac hosts (the letter/code stays constant). Absent
   *  = the base tier everywhere. Only the DEFAULT is refined — the stored
   *  override shape `{ code, tier } | null` is untouched (overrides are
   *  per-device, so per-platform is inherent). */
  macTier?: BindingTier;
  /** Restrict `macTier` to desktop-shell hosts (`isShell()`): a mac BROWSER
   *  keeps the base tier (the unshifted ⌘ N/T/W set is browser-reserved and
   *  uninterceptable there). */
  macShellOnly?: boolean;
  scope: BindingScope;
  kind: BindingKind;
  /** Human label for overlay rows + tier-map keycaps. */
  label: string;
  /** Optional overlay row description. */
  description?: string;
  /** Short tier-map keycap annotation (defaults to nothing rendered). */
  mapLabel?: string;
  /** Fire even when a real text input has focus. ⌘K keeps its historical
   *  everywhere-behavior (Constitution V primary discovery); everything else
   *  goes through `shouldSuppressChord`. */
  ignoreInputs?: boolean;
};

/** A resolved binding after the override layer + host reservations applied. */
export type EffectiveBinding = KeyBinding & {
  /** False when user-disabled (override `null`) or browser-reserved. */
  enabled: boolean;
  /** True when the effective combo equals the shipped default. */
  isDefault: boolean;
  disabledReason?: "user" | "reserved";
};

/** Override diff: combo replacement, or `null` = disabled/unbound. */
export type BindingOverride = BindingCombo | null;
/** The persisted shape: diffs only, keyed by actionId. */
export type BindingOverrides = Record<string, BindingOverride>;

export const KEYBINDINGS_STORAGE_KEY = "runkit-keybindings";

/**
 * The default registry. Order is display order within each overlay group.
 *
 * Shifted tier — the nine starter actions (intake §1, canonical letters):
 * N/T/W new-session/new-window/close-window, H/L prev/next window, [/] back/
 * forward, A next-waiting-agent, / the cheatsheet — joined by E compose-strip
 * toggle and O open-last-used (260801-sm6g) and , settings (260801-mqim).
 * Global scope (O is terminal-scoped): dispatch mounts decide per-route
 * applicability by handler presence.
 *
 * macOS demotions (260730-n789 — letters constant, modifier varies): [/]//
 * default to the unshifted ⌘ tier on every mac host (interceptable in
 * browsers, native back/forward convention); N/T/W and , demote only inside
 * the desktop shell (`macShellOnly` — mac browsers reserve N/T/W even
 * shifted, so those stay palette-only there; ⌘, is browser Preferences, so
 * settings keeps the shifted default outside the shell). H/L/A stay
 * shifted everywhere: ⌘H is macOS
 * Hide and ⌘A is select-all/Edit-role — immovable — and demoting L alone
 * would split the H/L pair across tiers. Win/Linux is unchanged (plain Ctrl
 * belongs to the pane).
 *
 * Legacy migrations (combos unchanged — established, browser-safe
 * punctuation): ⌘K palette (ignoreInputs preserves its fire-everywhere
 * behavior), ⌘\ sidebar, ⌘. lens cycle, Ctrl+` chat toggle, board ⌘[/⌘].
 */
export const DEFAULT_BINDINGS: readonly KeyBinding[] = [
  // — run-kit shifted tier (global) —
  { actionId: "create-session", code: "KeyN", tier: "shifted", macTier: "cmd", macShellOnly: true, scope: "global", kind: "builtin", label: "New session", description: "create a tmux session", mapLabel: "new session" },
  { actionId: "create-window", code: "KeyT", tier: "shifted", macTier: "cmd", macShellOnly: true, scope: "global", kind: "builtin", label: "New window", description: "tab-analog in current session", mapLabel: "new window" },
  { actionId: "kill-window", code: "KeyW", tier: "shifted", macTier: "cmd", macShellOnly: true, scope: "global", kind: "builtin", label: "Close window", description: "confirm flow", mapLabel: "close win" },
  // ⇧⌘E compose toggle (260801-sm6g): E is free on both platforms (C is the
  // win/linux terminal-copy claim, T is create-window, I is win/linux
  // devtools). No macTier demotion — ⌘E is browser "use selection for find"
  // territory on mac. ignoreInputs lets the chord CLOSE the strip while its
  // own textarea has focus.
  { actionId: "compose-toggle", code: "KeyE", tier: "shifted", scope: "global", kind: "builtin", label: "Compose text", description: "toggle the compose strip", mapLabel: "compose", ignoreInputs: true },
  // ⇧⌘O open-last-used (260801-sm6g): re-runs the Open split-button's primary
  // (last-used) target. Terminal scope — the Open control is
  // terminal-route-only; the board/server routes mount no handler.
  { actionId: "open-last-used", code: "KeyO", tier: "shifted", scope: "terminal", kind: "builtin", label: "Open in last-used app", description: "re-run the last Open target", mapLabel: "open" },
  { actionId: "window-prev", code: "KeyH", tier: "shifted", scope: "global", kind: "builtin", label: "Previous window", mapLabel: "prev win" },
  { actionId: "window-next", code: "KeyL", tier: "shifted", scope: "global", kind: "builtin", label: "Next window", mapLabel: "next win" },
  { actionId: "go-back", code: "BracketLeft", tier: "shifted", macTier: "cmd", scope: "global", kind: "builtin", label: "Back", description: "history", mapLabel: "back" },
  { actionId: "go-forward", code: "BracketRight", tier: "shifted", macTier: "cmd", scope: "global", kind: "builtin", label: "Forward", description: "history", mapLabel: "fwd" },
  { actionId: "agent-next-waiting", code: "KeyA", tier: "shifted", scope: "global", kind: "builtin", label: "Next waiting agent", description: "jump to an agent blocked on input", mapLabel: "agent" },
  { actionId: "shortcuts-overlay", code: "Slash", tier: "shifted", macTier: "cmd", scope: "global", kind: "builtin", label: "Keyboard shortcuts", description: "toggle this cheatsheet", mapLabel: "cheatsheet", ignoreInputs: true },
  // ⇧⌘,/⇧Ctrl+, settings (260801-mqim): ⌘, unshifted is browser Preferences
  // (claimed data below), so the browser default is the shifted tier; inside
  // the mac desktop shell `macTier` + `macShellOnly` promote it to the
  // OS-conventional ⌘, — the create-session precedent. ignoreInputs mirrors
  // shortcuts-overlay/compose-toggle: a chrome-level opener fires from inputs.
  { actionId: "settings-open", code: "Comma", tier: "shifted", macTier: "cmd", macShellOnly: true, scope: "global", kind: "builtin", label: "Settings", description: "open the settings dialog", mapLabel: "settings", ignoreInputs: true },
  // — legacy chords, migrated with combos unchanged —
  { actionId: "command-palette", code: "KeyK", tier: "cmd", scope: "global", kind: "builtin", label: "Command palette", ignoreInputs: true },
  { actionId: "sidebar-toggle", code: "Backslash", tier: "cmd", scope: "global", kind: "builtin", label: "Toggle sidebar" },
  { actionId: "view-cycle", code: "Period", tier: "cmd", scope: "terminal", kind: "builtin", label: "Cycle view lens", description: "tty → web → chat" },
  { actionId: "chat-toggle", code: "Backquote", tier: "ctrl", scope: "terminal", kind: "builtin", label: "Toggle chat view", description: "tty ↔ chat" },
  { actionId: "board-cycle-next", code: "BracketRight", tier: "cmd", scope: "board", kind: "builtin", label: "Cycle pane focus →" },
  { actionId: "board-cycle-prev", code: "BracketLeft", tier: "cmd", scope: "board", kind: "builtin", label: "Cycle pane focus ←" },
];

// ── claimed keys ────────────────────────────────────────────────────────────

/** A key+tier the registry treats as spoken-for. `owner` drives the overlay
 *  presentation (shell rows render locked; browser/system rows render claimed
 *  on the tier map). Only `browser`-owned claims disable a binding —
 *  shell/system claims are display + capture-warning data (in the shell the
 *  menu accelerator consumes the key before the page sees it anyway). */
export type ClaimedKey = {
  code: string;
  /** The chord tier the claim occupies (260730-n789: the mac ⌘ page tier has
   *  its own claimed set alongside the shifted tier). */
  tier: BindingTier;
  label: string;
  owner: "shell" | "system" | "browser";
  /** Restrict to one keycap platform; absent = both. */
  platform?: BindingPlatform;
};

/** The shell's Hosts-switcher digit claims — WIN/LINUX ONLY (⇧Ctrl+1–9). On
 *  mac the switcher moved to ⌥⌘1–9 (260731-nv5r: ⇧⌘3/4/5 are macOS
 *  system-wide screenshot shortcuts that intercept before menu accelerators),
 *  and Option is deliberately not a tier, so the mac claim is unrepresentable
 *  here — which is the point of the move: ⌥⌘ is territory the page can never
 *  claim or capture. */
const SHELL_SWITCHER_DIGITS: ClaimedKey[] = Array.from({ length: 9 }, (_, i) => ({
  code: `Digit${i + 1}`,
  tier: "shifted" as const,
  label: "server",
  owner: "shell" as const,
  platform: "other" as const,
}));

/** macOS system-wide screenshot shortcuts ⇧⌘3/4/5 — like the ⇧⌘Q logout row,
 *  they apply on both shell and browser hosts (screenshots are system-wide).
 *  The freed mac ⇧⌘1/2/6–9 digits carry NO claims: unclaimed future page real
 *  estate (260731-nv5r). */
const MAC_SCREENSHOT_CLAIMS: ClaimedKey[] = [3, 4, 5].map((n) => ({
  code: `Digit${n}`,
  tier: "shifted" as const,
  label: "screenshot",
  owner: "system" as const,
  platform: "mac" as const,
}));

/** Mac desktop-shell ⌘-tier menu accelerators (`app/desktop/src/menu.ts` —
 *  the exhaustive mac bound set): App ⌘Q/⌘H, Window ⌘M, View ⌘R + zoom
 *  ⌘0/⌘+/⌘−, Edit roles ⌘Z/X/C/V/A. Hand-maintained mirror — update in the
 *  same change as any shell accelerator change (desktop-shell memory rule). */
const MAC_SHELL_CMD_CLAIMS: ClaimedKey[] = [
  { code: "KeyQ", tier: "cmd", label: "quit", owner: "shell", platform: "mac" },
  { code: "KeyH", tier: "cmd", label: "hide", owner: "shell", platform: "mac" },
  { code: "KeyM", tier: "cmd", label: "minimize", owner: "shell", platform: "mac" },
  { code: "KeyR", tier: "cmd", label: "reload", owner: "shell", platform: "mac" },
  { code: "KeyZ", tier: "cmd", label: "undo", owner: "shell", platform: "mac" },
  { code: "KeyX", tier: "cmd", label: "cut", owner: "shell", platform: "mac" },
  { code: "KeyC", tier: "cmd", label: "copy", owner: "shell", platform: "mac" },
  { code: "KeyV", tier: "cmd", label: "paste", owner: "shell", platform: "mac" },
  { code: "KeyA", tier: "cmd", label: "select all", owner: "shell", platform: "mac" },
  { code: "Digit0", tier: "cmd", label: "zoom", owner: "shell", platform: "mac" },
  { code: "Equal", tier: "cmd", label: "zoom", owner: "shell", platform: "mac" },
  { code: "Minus", tier: "cmd", label: "zoom", owner: "shell", platform: "mac" },
];

/** Mac BROWSER ⌘-tier reserved keys: browser-owned N/T/W/L + tab digits are
 *  uninterceptable (they disable resolution, like the shifted browser set);
 *  Q/H/M are OS-level (display-only, owner `system`). */
const MAC_BROWSER_CMD_CLAIMS: ClaimedKey[] = [
  { code: "KeyN", tier: "cmd", label: "new window", owner: "browser", platform: "mac" },
  { code: "KeyT", tier: "cmd", label: "new tab", owner: "browser", platform: "mac" },
  { code: "KeyW", tier: "cmd", label: "close tab", owner: "browser", platform: "mac" },
  { code: "KeyL", tier: "cmd", label: "address bar", owner: "browser", platform: "mac" },
  // ⌘, is the browser's own Preferences accelerator on macOS (the reason
  // `settings-open`'s browser default stays shifted, 260801-mqim) — claimed so
  // an override onto it resolves reserved instead of advertising a dead chord.
  { code: "Comma", tier: "cmd", label: "preferences", owner: "browser", platform: "mac" },
  ...Array.from({ length: 9 }, (_, i) => ({
    code: `Digit${i + 1}`,
    tier: "cmd" as const,
    label: "tab",
    owner: "browser" as const,
    platform: "mac" as const,
  })),
  { code: "KeyQ", tier: "cmd", label: "quit", owner: "system", platform: "mac" },
  { code: "KeyH", tier: "cmd", label: "hide", owner: "system", platform: "mac" },
  { code: "KeyM", tier: "cmd", label: "minimize", owner: "system", platform: "mac" },
];

/**
 * The claimed keys for a host, per tier. Shifted tier: shell claims (menu
 * accelerators: ⇧Ctrl+1–9 switcher + ⇧Ctrl+I devtools on win/linux ONLY —
 * the mac switcher lives on ⌥⌘1–9, outside every tier (260731-nv5r) —
 * ⇧CmdOrCtrl+R force reload everywhere) and system claims (⇧⌘Q macOS
 * logout; ⇧⌘3/4/5 macOS screenshots; ⇧Ctrl+C/V terminal copy/paste
 * convention on win/linux) apply in both hosts; browser claims (N/T/W —
 * incognito / reopen-tab / close-window) apply only outside the desktop
 * shell, where those actions stay palette-reachable. Mac ⌘ (cmd) tier
 * (260730-n789): the shell's menu accelerators inside the shell, the
 * browser-reserved set outside. Win/Linux claim sets are unchanged — the
 * unshifted Ctrl tier belongs to the pane, not to claims data.
 */
export function claimedKeys(platform: BindingPlatform, shell: boolean): ClaimedKey[] {
  const claims: ClaimedKey[] = [
    ...SHELL_SWITCHER_DIGITS,
    ...MAC_SCREENSHOT_CLAIMS,
    { code: "KeyR", tier: "shifted", label: "reload", owner: "shell" },
    { code: "KeyI", tier: "shifted", label: "devtools", owner: "shell", platform: "other" },
    { code: "KeyQ", tier: "shifted", label: "logout", owner: "system", platform: "mac" },
    { code: "KeyC", tier: "shifted", label: "copy", owner: "system", platform: "other" },
    { code: "KeyV", tier: "shifted", label: "paste", owner: "system", platform: "other" },
    ...(shell ? MAC_SHELL_CMD_CLAIMS : MAC_BROWSER_CMD_CLAIMS),
  ];
  if (!shell) {
    claims.push(
      { code: "KeyN", tier: "shifted", label: "incognito", owner: "browser" },
      { code: "KeyT", tier: "shifted", label: "reopen tab", owner: "browser" },
      { code: "KeyW", tier: "shifted", label: "close window", owner: "browser" },
    );
  }
  return claims.filter((c) => !c.platform || c.platform === platform);
}

// ── host detection ──────────────────────────────────────────────────────────

/** Keycap platform from the runtime UA. `other` when undetectable (jsdom). */
export function detectPlatform(): BindingPlatform {
  if (typeof navigator === "undefined") return "other";
  const probe = `${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`;
  return /mac|iphone|ipad|ipod/i.test(probe) ? "mac" : "other";
}

// ── matching ────────────────────────────────────────────────────────────────

/** The minimal event shape the matcher needs (assignable from KeyboardEvent). */
export type ChordEvent = {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

/**
 * Whether a keydown matches a combo. Alt excluded in every tier (not part of
 * any tier; macOS composes characters with it). The `cmd` tier accepts Meta OR
 * Ctrl without Shift — byte-identical to the legacy listeners' predicates.
 */
export function matchesCombo(e: ChordEvent, combo: BindingCombo): boolean {
  if (e.altKey || e.code !== combo.code) return false;
  switch (combo.tier) {
    case "shifted":
      return e.shiftKey && (e.metaKey || e.ctrlKey);
    case "cmd":
      return !e.shiftKey && (e.metaKey || e.ctrlKey);
    case "ctrl":
      return e.ctrlKey && !e.metaKey && !e.shiftKey;
  }
}

/**
 * Every enabled binding matching the event, SCOPED-BEATS-GLOBAL ordered
 * (260730-n789): non-global scopes first, registry order within each class.
 * On macOS the board pane-cycle pair and the global back/forward share the
 * ⌘[/⌘] combos by design — the dispatcher walks this list and fires the
 * first match that has a handler at its mount, so the board route keeps
 * pane-cycle while every other route gets history navigation. A scoped/global
 * shadow is precedence, not a conflict (see `findConflicts`).
 */
export function findMatches(
  e: ChordEvent,
  bindings: readonly EffectiveBinding[],
): EffectiveBinding[] {
  const matches = bindings.filter((b) => b.enabled && matchesCombo(e, b));
  if (matches.length < 2) return matches;
  return [
    ...matches.filter((b) => b.scope !== "global"),
    ...matches.filter((b) => b.scope === "global"),
  ];
}

/**
 * Whether the terminal's custom key handler must REFUSE this keydown so it
 * bubbles to the window dispatcher instead of reaching the pane
 * (`terminal-client.tsx`). Two rules:
 *
 * 1. Any enabled SHIFTED-tier match, on every platform (260730-g40a): legacy
 *    TTY encoding cannot distinguish Ctrl+Shift+letter from Ctrl+letter, so
 *    xterm would emit the Ctrl-char; refusing costs the pane nothing.
 * 2. On macOS ONLY (260730-n789): an enabled CMD-tier match pressed with
 *    METAKEY — ⌘ chords never reach the pane as control bytes, so refusal is
 *    loss-free and lets the demoted ⌘[/⌘]/⌘/ (and shell-host ⌘N/T/W) fire
 *    while the terminal owns focus. The metaKey gate is load-bearing:
 *    `matchesCombo`'s cmd tier also accepts plain Ctrl, and mac Ctrl+[ is ESC
 *    — plain-Ctrl chords must ALWAYS pass through to the pane. On Win/Linux
 *    this rule never applies (cmd-tier combos ARE plain-Ctrl chords there),
 *    keeping the seam byte-identical to the pre-n789 behavior.
 */
export function shouldRefuseTerminalChord(
  e: ChordEvent,
  bindings: readonly EffectiveBinding[],
  platform: BindingPlatform,
): boolean {
  const matches = findMatches(e, bindings);
  if (matches.some((b) => b.tier === "shifted")) return true;
  return platform === "mac" && e.metaKey && matches.some((b) => b.tier === "cmd");
}

// ── override storage ────────────────────────────────────────────────────────

const TIERS: readonly BindingTier[] = ["shifted", "cmd", "ctrl"];

function isCombo(value: unknown): value is BindingCombo {
  if (typeof value !== "object" || value === null) return false;
  if (!("code" in value) || !("tier" in value)) return false;
  return (
    typeof value.code === "string" &&
    value.code.length > 0 &&
    typeof value.tier === "string" &&
    (TIERS as readonly string[]).includes(value.tier)
  );
}

/** Tolerant parse of the stored diff blob: malformed JSON, a non-object root,
 *  or garbage entries all degrade to "no override" rather than throwing. */
export function parseOverrides(raw: string | null): BindingOverrides {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const overrides: BindingOverrides = {};
  for (const [actionId, value] of Object.entries(parsed)) {
    if (value === null) overrides[actionId] = null;
    else if (isCombo(value)) overrides[actionId] = { code: value.code, tier: value.tier };
  }
  return overrides;
}

/** Read the persisted diffs; `{}` when absent or localStorage is unavailable. */
export function readStoredOverrides(): BindingOverrides {
  try {
    return parseOverrides(localStorage.getItem(KEYBINDINGS_STORAGE_KEY));
  } catch {
    return {};
  }
}

/** Persist the diffs (best-effort; an empty diff removes the key). */
export function writeStoredOverrides(overrides: BindingOverrides): void {
  try {
    if (Object.keys(overrides).length === 0) {
      localStorage.removeItem(KEYBINDINGS_STORAGE_KEY);
    } else {
      localStorage.setItem(KEYBINDINGS_STORAGE_KEY, JSON.stringify(overrides));
    }
  } catch {
    /* noop — best-effort persistence */
  }
}

// ── resolution ──────────────────────────────────────────────────────────────

/**
 * The host-effective DEFAULT combo for a binding (260730-n789): on mac hosts
 * a `macTier` refinement replaces the base tier — gated on the desktop shell
 * when `macShellOnly` is set — with the code always constant. This is the
 * single seam where platform + shell are consulted for defaults; both
 * `resolveBindings` (fallback + `isDefault`) and `applyCapture` (own-default
 * detection) read defaults through it.
 */
export function defaultComboFor(def: KeyBinding, host: BindingHost): BindingCombo {
  if (host.platform === "mac" && def.macTier && (!def.macShellOnly || host.shell)) {
    return { code: def.code, tier: def.macTier };
  }
  return { code: def.code, tier: def.tier };
}

/**
 * Merge defaults + overrides into the effective map for a host. Defaults are
 * host-resolved through `defaultComboFor` (mac tier demotions). `null`
 * overrides disable (`reason: "user"` — the steal-with-warning victim state,
 * flagged in the overlay until rebound or reset). A combo that is
 * browser-reserved in this host — tier-aware: shifted N/T/W outside the
 * shell on every platform, plus the mac-browser ⌘ set — resolves disabled
 * (`reason: "reserved"`) — the action stays palette-reachable.
 *
 * KEYLESS defaults (`code: ""` — macro bindings, which ship no default combo;
 * see `lib/macros.ts` `macroToBinding`) resolve UNBOUND unless an override
 * supplies a combo: `enabled: false, disabledReason: "user"` — the same state
 * a steal victim lands in, so the overlay's unbound affordance covers both.
 * Builtins always carry a code and are unaffected.
 */
export function resolveBindings(
  defaults: readonly KeyBinding[],
  overrides: BindingOverrides,
  host: BindingHost,
): EffectiveBinding[] {
  const reserved = new Set(
    claimedKeys(host.platform, host.shell)
      .filter((c) => c.owner === "browser")
      .map((c) => `${c.tier}:${c.code}`),
  );
  return defaults.map((def) => {
    const override = Object.prototype.hasOwnProperty.call(overrides, def.actionId)
      ? overrides[def.actionId]
      : undefined;
    if (override === null) {
      return { ...def, enabled: false, isDefault: false, disabledReason: "user" as const };
    }
    const base = defaultComboFor(def, host);
    const combo: BindingCombo = override ?? base;
    if (combo.code === "") {
      return { ...def, enabled: false, isDefault: false, disabledReason: "user" as const };
    }
    const isDefault = combo.code === base.code && combo.tier === base.tier;
    const isReserved = reserved.has(`${combo.tier}:${combo.code}`);
    return {
      ...def,
      code: combo.code,
      tier: combo.tier,
      enabled: !isReserved,
      isDefault,
      ...(isReserved ? { disabledReason: "reserved" as const } : {}),
    };
  });
}

// ── conflicts ───────────────────────────────────────────────────────────────

/** Whether two binding scopes can be live at the same time. `global` overlaps
 *  everything; equal scopes overlap; `terminal`/`board` routes never co-mount. */
export function scopesOverlap(a: BindingScope, b: BindingScope): boolean {
  return a === b || a === "global" || b === "global";
}

export type BindingConflict = {
  a: string;
  b: string;
  code: string;
  tier: BindingTier;
};

/**
 * Whether two tiers can fire on the same keydown (per `matchesCombo`): `cmd`
 * accepts Meta OR Ctrl without Shift and `ctrl` accepts Ctrl-only without
 * Shift, so a plain Ctrl chord matches BOTH — same-code `cmd`/`ctrl` bindings
 * mask each other on every platform (and on non-mac hosts capture always
 * reads Ctrl chords as `cmd`, so the pair is routine there). `shifted`
 * requires Shift and is disjoint from both.
 */
export function tiersCollide(a: BindingTier, b: BindingTier): boolean {
  return a === b || (a !== "shifted" && b !== "shifted");
}

/**
 * Pure conflict detection over an effective map: two ENABLED bindings conflict
 * when their codes are equal, their tiers collide (equal, or the overlapping
 * `cmd`/`ctrl` pair — see `tiersCollide`), and their scopes are EQUAL. A
 * same-combo global↔scoped pair is a SHADOW, not a conflict (260730-n789):
 * dispatch is scoped-beats-global (`findMatches`), so both stay functional —
 * the scoped one wins on its route, the global one everywhere else (the mac
 * default map ships exactly this shape: board ⌘[/⌘] shadowing back/forward).
 * Consumed by tests asserting the defaults are clean (the capture UI's steal
 * warning does its own single-victim overlap check in `applyCapture`).
 */
export function findConflicts(bindings: readonly EffectiveBinding[]): BindingConflict[] {
  const conflicts: BindingConflict[] = [];
  for (let i = 0; i < bindings.length; i++) {
    const a = bindings[i];
    if (!a.enabled) continue;
    for (let j = i + 1; j < bindings.length; j++) {
      const b = bindings[j];
      if (!b.enabled) continue;
      if (a.code === b.code && tiersCollide(a.tier, b.tier) && a.scope === b.scope) {
        conflicts.push({ a: a.actionId, b: b.actionId, code: a.code, tier: a.tier });
      }
    }
  }
  return conflicts;
}

// ── capture ─────────────────────────────────────────────────────────────────

const MODIFIER_CODES = new Set([
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "MetaLeft",
  "MetaRight",
  "AltLeft",
  "AltRight",
  "CapsLock",
  "Fn",
  "FnLock",
]);

/**
 * Derive a combo from a capture keydown, or `null` while the chord is not yet
 * a valid binding (modifier-only presses keep capturing; Alt chords and bare
 * keys are rejected — no tier models them). Ctrl-without-Meta reads as the
 * `ctrl` tier on macOS (where it is distinct from ⌘) and as the `cmd` tier
 * elsewhere (where Ctrl IS CmdOrCtrl) — overrides are per-device, so the
 * device-local reading is the correct one.
 */
export function captureFromEvent(
  e: ChordEvent,
  platform: BindingPlatform,
): BindingCombo | null {
  if (MODIFIER_CODES.has(e.code)) return null;
  if (e.altKey) return null;
  if (e.shiftKey && (e.metaKey || e.ctrlKey)) return { code: e.code, tier: "shifted" };
  if (e.metaKey) return { code: e.code, tier: "cmd" };
  if (e.ctrlKey && !e.shiftKey) {
    return { code: e.code, tier: platform === "mac" ? "ctrl" : "cmd" };
  }
  return null;
}

/**
 * Apply a captured combo to an action's override diff. Steal-with-warning:
 * when another ENABLED binding with an overlapping scope already owns the
 * combo — same code and a COLLIDING tier (`tiersCollide`: a plain Ctrl chord
 * matches both the `cmd` and `ctrl` tiers, so a cross-tier owner would be
 * silently masked at dispatch) — it becomes unbound (override `null`) and is
 * reported as `stolenFrom` so the overlay can flag it. Re-capturing an
 * action's own HOST default (`defaultComboFor` — e.g. ⌘[ for go-back on a
 * mac) is a NO-OP: it drops the diff entry (the stored blob stays diffs-only)
 * and steals from nobody — the check runs BEFORE the victim search so the mac
 * shadow pairs (global ⌘[/⌘] shared with the board cycle bindings) survive a
 * re-capture of either partner's default. Stealing otherwise
 * deliberately stays `scopesOverlap`-wide even though `findConflicts` treats
 * global↔scoped shadows as precedence: four bindings dispatch through
 * component-local listeners that never see `findMatches` precedence, so a
 * cross-scope capture onto their combos would double-fire if left unstolen.
 */
export function applyCapture(
  bindings: readonly EffectiveBinding[],
  overrides: BindingOverrides,
  actionId: string,
  combo: BindingCombo,
  host: BindingHost,
  defaults: readonly KeyBinding[] = DEFAULT_BINDINGS,
): { overrides: BindingOverrides; stolenFrom: string | null } {
  const next: BindingOverrides = { ...overrides };
  const def = defaults.find((d) => d.actionId === actionId);
  const base = def ? defaultComboFor(def, host) : null;
  if (base && base.code === combo.code && base.tier === combo.tier) {
    // Own host default — a no-op re-capture. Short-circuit BEFORE the victim
    // search: the shipped defaults may share this combo across scopes (the
    // mac ⌘[/⌘] global↔board shadow pairs), and re-affirming a default must
    // never unbind its shadow partner.
    delete next[actionId];
    return { overrides: next, stolenFrom: null };
  }
  const self = bindings.find((b) => b.actionId === actionId);
  const scope = self?.scope ?? "global";
  const victim =
    bindings.find(
      (b) =>
        b.actionId !== actionId &&
        b.enabled &&
        b.code === combo.code &&
        tiersCollide(b.tier, combo.tier) &&
        scopesOverlap(scope, b.scope),
    ) ?? null;
  if (victim) next[victim.actionId] = null;
  next[actionId] = combo;
  return { overrides: next, stolenFrom: victim?.actionId ?? null };
}

// ── formatting ──────────────────────────────────────────────────────────────

const CODE_LABELS: Record<string, string> = {
  BracketLeft: "[",
  BracketRight: "]",
  Slash: "/",
  Backslash: "\\",
  Period: ".",
  Comma: ",",
  Backquote: "`",
  Semicolon: ";",
  Quote: "'",
  Minus: "-",
  Equal: "=",
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
};

/** Human keycap for a `KeyboardEvent.code` ("KeyN" → "N", "Slash" → "/"). */
export function keyLabel(code: string): string {
  if (code.startsWith("Key") && code.length === 4) return code.slice(3);
  if (code.startsWith("Digit") && code.length === 6) return code.slice(5);
  return CODE_LABELS[code] ?? code;
}

/** Keycap parts for rendering (["⇧", "⌘", "N"] / ["Shift", "Ctrl", "N"]). */
export function comboParts(combo: BindingCombo, platform: BindingPlatform): string[] {
  const key = keyLabel(combo.code);
  if (platform === "mac") {
    switch (combo.tier) {
      case "shifted":
        return ["⇧", "⌘", key];
      case "cmd":
        return ["⌘", key];
      case "ctrl":
        return ["Ctrl", key];
    }
  }
  switch (combo.tier) {
    case "shifted":
      return ["Shift", "Ctrl", key];
    default:
      return ["Ctrl", key];
  }
}

/**
 * One-string combo for palette hints ("⇧⌘N" / "Shift+Ctrl+N"). Mac symbol
 * tiers join bare; the `ctrl` tier keeps the historical "Ctrl+`" spelling on
 * both platforms (byte-identical to the pre-registry palette hints).
 */
export function formatCombo(combo: BindingCombo, platform: BindingPlatform): string {
  const parts = comboParts(combo, platform);
  return platform === "mac" && combo.tier !== "ctrl" ? parts.join("") : parts.join("+");
}

// ── suppression ─────────────────────────────────────────────────────────────

/**
 * The single shared input-gating predicate (supersedes window-view.ts's
 * `shouldSuppressViewChord`): suppress a chord only when a "real" text input
 * has focus. Carve-outs preserved from the legacy listeners: xterm's hidden
 * helper textarea is the terminal's NORMAL focus state, and `.rk-chat-input`
 * is the chat lens's analog (the Ctrl+` toggle must escape it) — chords fire
 * in both. Returns `true` when the chord SHOULD be suppressed. Bindings with
 * `ignoreInputs` (⌘K, the overlay toggle) skip this predicate entirely.
 */
export function shouldSuppressChord(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest(".xterm") != null) return false;
  if (target.classList.contains("rk-chat-input")) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  // `isContentEditable` is the browser truth; fall back to the attribute value
  // (`"true"` / `""`) since jsdom does not implement the getter.
  return target.isContentEditable || target.contentEditable === "true";
}

// ── palette hints ───────────────────────────────────────────────────────────

/**
 * Decorate palette actions with effective-combo `shortcut` hints (actionId
 * doubles as the palette id). Disabled bindings (user-disabled or
 * browser-reserved) contribute NO hint — a hint advertising a dead chord
 * would lie; the entry itself stays reachable. Actions without a registered
 * binding pass through untouched (their hand-set hints, if any, survive).
 */
export function withShortcutHints<T extends { id: string; shortcut?: string }>(
  actions: readonly T[],
  byAction: ReadonlyMap<string, EffectiveBinding>,
  platform: BindingPlatform,
): (T & { shortcut?: string })[] {
  return actions.map((action) => {
    const binding = byAction.get(action.id);
    if (!binding || !binding.enabled) return action;
    return {
      ...action,
      shortcut: formatCombo({ code: binding.code, tier: binding.tier }, platform),
    };
  });
}
