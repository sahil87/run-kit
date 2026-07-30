/**
 * Declarative keyboard-binding registry (260730-g40a).
 *
 * One module owns every app chord as DATA: the uniform run-kit action tier
 * (`Shift+CmdOrCtrl+<key>` — ⇧⌘ on macOS, ⇧Ctrl elsewhere, one tier on every
 * platform), the migrated legacy chords (⌘K palette, ⌘\ sidebar, ⌘. lens
 * cycle, Ctrl+` chat toggle, board ⌘[/⌘] pane cycle — combos unchanged), the
 * claimed-key map (shell menu accelerators, OS keys, browser-reserved keys),
 * the per-device override layer (`localStorage["runkit-keybindings"]`, diffs
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
 * not part of any tier (macOS uses it for character composition).
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

/** `builtin` only in this change; `"macro"` is the reserved schema slot for
 *  change 260730-hbyh (macro riff bindings) — no executor lands here. */
export type BindingKind = "builtin";

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
  tier: BindingTier;
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
 * forward, A next-waiting-agent, / the cheatsheet. Global scope: dispatch
 * mounts decide per-route applicability by handler presence.
 *
 * Legacy migrations (combos unchanged — established, browser-safe
 * punctuation): ⌘K palette (ignoreInputs preserves its fire-everywhere
 * behavior), ⌘\ sidebar, ⌘. lens cycle, Ctrl+` chat toggle, board ⌘[/⌘].
 */
export const DEFAULT_BINDINGS: readonly KeyBinding[] = [
  // — run-kit shifted tier (global) —
  { actionId: "create-session", code: "KeyN", tier: "shifted", scope: "global", kind: "builtin", label: "New session", description: "create a tmux session", mapLabel: "new session" },
  { actionId: "create-window", code: "KeyT", tier: "shifted", scope: "global", kind: "builtin", label: "New window", description: "tab-analog in current session", mapLabel: "new window" },
  { actionId: "kill-window", code: "KeyW", tier: "shifted", scope: "global", kind: "builtin", label: "Close window", description: "confirm flow", mapLabel: "close win" },
  { actionId: "window-prev", code: "KeyH", tier: "shifted", scope: "global", kind: "builtin", label: "Previous window", mapLabel: "prev win" },
  { actionId: "window-next", code: "KeyL", tier: "shifted", scope: "global", kind: "builtin", label: "Next window", mapLabel: "next win" },
  { actionId: "go-back", code: "BracketLeft", tier: "shifted", scope: "global", kind: "builtin", label: "Back", description: "history", mapLabel: "back" },
  { actionId: "go-forward", code: "BracketRight", tier: "shifted", scope: "global", kind: "builtin", label: "Forward", description: "history", mapLabel: "fwd" },
  { actionId: "agent-next-waiting", code: "KeyA", tier: "shifted", scope: "global", kind: "builtin", label: "Next waiting agent", description: "jump to an agent blocked on input", mapLabel: "agent" },
  { actionId: "shortcuts-overlay", code: "Slash", tier: "shifted", scope: "global", kind: "builtin", label: "Keyboard shortcuts", description: "toggle this cheatsheet", mapLabel: "cheatsheet", ignoreInputs: true },
  // — legacy chords, migrated with combos unchanged —
  { actionId: "command-palette", code: "KeyK", tier: "cmd", scope: "global", kind: "builtin", label: "Command palette", ignoreInputs: true },
  { actionId: "sidebar-toggle", code: "Backslash", tier: "cmd", scope: "global", kind: "builtin", label: "Toggle sidebar" },
  { actionId: "view-cycle", code: "Period", tier: "cmd", scope: "terminal", kind: "builtin", label: "Cycle view lens", description: "tty → web → chat" },
  { actionId: "chat-toggle", code: "Backquote", tier: "ctrl", scope: "terminal", kind: "builtin", label: "Toggle chat view", description: "tty ↔ chat" },
  { actionId: "board-cycle-next", code: "BracketRight", tier: "cmd", scope: "board", kind: "builtin", label: "Cycle pane focus →" },
  { actionId: "board-cycle-prev", code: "BracketLeft", tier: "cmd", scope: "board", kind: "builtin", label: "Cycle pane focus ←" },
];

// ── claimed keys ────────────────────────────────────────────────────────────

/** A shifted-tier key the registry treats as spoken-for. `owner` drives the
 *  overlay presentation (shell rows render locked; browser/system rows render
 *  claimed on the tier map). Only `browser`-owned claims disable a binding —
 *  shell/system claims are display + capture-warning data (in the shell the
 *  menu accelerator consumes the key before the page sees it anyway). */
export type ClaimedKey = {
  code: string;
  label: string;
  owner: "shell" | "system" | "browser";
  /** Restrict to one keycap platform; absent = both. */
  platform?: BindingPlatform;
};

const SHELL_SWITCHER_DIGITS: ClaimedKey[] = Array.from({ length: 9 }, (_, i) => ({
  code: `Digit${i + 1}`,
  label: "server",
  owner: "shell" as const,
}));

/**
 * The claimed shifted-tier keys for a host. Shell claims (menu accelerators:
 * ⇧CmdOrCtrl+1–9 switcher, ⇧CmdOrCtrl+R force reload, ⇧Ctrl+I devtools on
 * win/linux) and system claims (⇧⌘Q macOS logout; ⇧Ctrl+C/V terminal
 * copy/paste convention on win/linux) apply everywhere; browser claims (N/T/W
 * — incognito / reopen-tab / close-window) apply only outside the desktop
 * shell, where those actions stay palette-reachable.
 */
export function claimedKeys(platform: BindingPlatform, shell: boolean): ClaimedKey[] {
  const claims: ClaimedKey[] = [
    ...SHELL_SWITCHER_DIGITS,
    { code: "KeyR", label: "reload", owner: "shell" },
    { code: "KeyI", label: "devtools", owner: "shell", platform: "other" },
    { code: "KeyQ", label: "logout", owner: "system", platform: "mac" },
    { code: "KeyC", label: "copy", owner: "system", platform: "other" },
    { code: "KeyV", label: "paste", owner: "system", platform: "other" },
  ];
  if (!shell) {
    claims.push(
      { code: "KeyN", label: "incognito", owner: "browser" },
      { code: "KeyT", label: "reopen tab", owner: "browser" },
      { code: "KeyW", label: "close window", owner: "browser" },
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

/** First enabled binding matching the event, or null. */
export function findMatch(
  e: ChordEvent,
  bindings: readonly EffectiveBinding[],
): EffectiveBinding | null {
  for (const b of bindings) {
    if (b.enabled && matchesCombo(e, b)) return b;
  }
  return null;
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
 * Merge defaults + overrides into the effective map for a host. `null`
 * overrides disable (`reason: "user"` — the steal-with-warning victim state,
 * flagged in the overlay until rebound or reset). A shifted combo that is
 * browser-reserved in this host (N/T/W outside the shell) resolves disabled
 * (`reason: "reserved"`) — the action stays palette-reachable.
 */
export function resolveBindings(
  defaults: readonly KeyBinding[],
  overrides: BindingOverrides,
  host: BindingHost,
): EffectiveBinding[] {
  const reserved = new Set(
    claimedKeys(host.platform, host.shell)
      .filter((c) => c.owner === "browser")
      .map((c) => c.code),
  );
  return defaults.map((def) => {
    const override = Object.prototype.hasOwnProperty.call(overrides, def.actionId)
      ? overrides[def.actionId]
      : undefined;
    if (override === null) {
      return { ...def, enabled: false, isDefault: false, disabledReason: "user" as const };
    }
    const combo: BindingCombo = override ?? { code: def.code, tier: def.tier };
    const isDefault = combo.code === def.code && combo.tier === def.tier;
    const isReserved = combo.tier === "shifted" && reserved.has(combo.code);
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
 * Pure conflict detection over an effective map: two ENABLED bindings conflict
 * when their tier+code are equal and their scopes overlap. Consumed by tests
 * asserting the defaults are clean (the capture UI's steal warning does its
 * own single-victim overlap check in `applyCapture`).
 */
export function findConflicts(bindings: readonly EffectiveBinding[]): BindingConflict[] {
  const conflicts: BindingConflict[] = [];
  for (let i = 0; i < bindings.length; i++) {
    const a = bindings[i];
    if (!a.enabled) continue;
    for (let j = i + 1; j < bindings.length; j++) {
      const b = bindings[j];
      if (!b.enabled) continue;
      if (a.code === b.code && a.tier === b.tier && scopesOverlap(a.scope, b.scope)) {
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
 * combo, it becomes unbound (override `null`) and is reported as `stolenFrom`
 * so the overlay can flag it. Re-capturing an action's own default drops its
 * diff entry (the stored blob stays diffs-only).
 */
export function applyCapture(
  bindings: readonly EffectiveBinding[],
  overrides: BindingOverrides,
  actionId: string,
  combo: BindingCombo,
  defaults: readonly KeyBinding[] = DEFAULT_BINDINGS,
): { overrides: BindingOverrides; stolenFrom: string | null } {
  const self = bindings.find((b) => b.actionId === actionId);
  const scope = self?.scope ?? "global";
  const victim =
    bindings.find(
      (b) =>
        b.actionId !== actionId &&
        b.enabled &&
        b.code === combo.code &&
        b.tier === combo.tier &&
        scopesOverlap(scope, b.scope),
    ) ?? null;
  const next: BindingOverrides = { ...overrides };
  if (victim) next[victim.actionId] = null;
  const def = defaults.find((d) => d.actionId === actionId);
  if (def && def.code === combo.code && def.tier === combo.tier) {
    delete next[actionId];
  } else {
    next[actionId] = combo;
  }
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
