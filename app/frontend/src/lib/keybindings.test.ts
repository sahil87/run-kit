import { describe, it, expect, afterEach } from "vitest";
import {
  DEFAULT_BINDINGS,
  KEYBINDINGS_STORAGE_KEY,
  applyCapture,
  captureFromEvent,
  claimedKeys,
  comboParts,
  defaultComboFor,
  findConflicts,
  findMatches,
  tiersCollide,
  formatCombo,
  keyLabel,
  matchesCombo,
  parseOverrides,
  readStoredOverrides,
  resolveBindings,
  scopesOverlap,
  shouldRefuseTerminalChord,
  shouldSuppressChord,
  withShortcutHints,
  writeStoredOverrides,
  type BindingHost,
  type ChordEvent,
  type EffectiveBinding,
  type KeyBinding,
} from "./keybindings";

const SHELL_MAC: BindingHost = { platform: "mac", shell: true };
const BROWSER_MAC: BindingHost = { platform: "mac", shell: false };
const SHELL_OTHER: BindingHost = { platform: "other", shell: true };
const BROWSER_OTHER: BindingHost = { platform: "other", shell: false };
const ALL_HOSTS = [SHELL_MAC, BROWSER_MAC, SHELL_OTHER, BROWSER_OTHER];

function chord(partial: Partial<ChordEvent> & { code: string }): ChordEvent {
  return { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...partial };
}

function resolved(host: BindingHost = SHELL_OTHER, overrides = {}): EffectiveBinding[] {
  return resolveBindings(DEFAULT_BINDINGS, overrides, host);
}

function byId(bindings: EffectiveBinding[], actionId: string): EffectiveBinding {
  const found = bindings.find((b) => b.actionId === actionId);
  if (!found) throw new Error(`missing binding ${actionId}`);
  return found;
}

describe("DEFAULT_BINDINGS integrity", () => {
  it("has unique actionIds", () => {
    const ids = DEFAULT_BINDINGS.map((b) => b.actionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("carries the shifted-tier actions on their canonical keys", () => {
    const shifted = Object.fromEntries(
      DEFAULT_BINDINGS.filter((b) => b.tier === "shifted").map((b) => [b.actionId, b.code]),
    );
    expect(shifted).toEqual({
      "create-session": "KeyN",
      "create-window": "KeyT",
      "kill-window": "KeyW",
      "compose-toggle": "KeyE",
      "open-last-used": "KeyO",
      "window-prev": "KeyH",
      "window-next": "KeyL",
      "go-back": "BracketLeft",
      "go-forward": "BracketRight",
      "agent-next-waiting": "KeyA",
      "shortcuts-overlay": "Slash",
    });
  });

  it("compose-toggle: ⇧⌘E, global, ignoreInputs, no mac demotion (260801-sm6g)", () => {
    const def = DEFAULT_BINDINGS.find((b) => b.actionId === "compose-toggle");
    expect(def).toMatchObject({
      code: "KeyE",
      tier: "shifted",
      scope: "global",
      kind: "builtin",
      ignoreInputs: true,
    });
    expect(def?.macTier).toBeUndefined();
    // Shifted everywhere — mac hosts included (no demotion; ⌘E is browser
    // find-selection territory).
    for (const host of ALL_HOSTS) {
      expect(byId(resolved(host), "compose-toggle")).toMatchObject({
        code: "KeyE",
        tier: "shifted",
        enabled: true,
      });
    }
  });

  it("open-last-used: ⇧⌘O, terminal scope, no mac demotion (260801-sm6g)", () => {
    const def = DEFAULT_BINDINGS.find((b) => b.actionId === "open-last-used");
    expect(def).toMatchObject({
      code: "KeyO",
      tier: "shifted",
      scope: "terminal",
      kind: "builtin",
    });
    expect(def?.macTier).toBeUndefined();
    for (const host of ALL_HOSTS) {
      expect(byId(resolved(host), "open-last-used")).toMatchObject({
        code: "KeyO",
        tier: "shifted",
        enabled: true,
      });
    }
  });

  it("migrates the five legacy chords with combos unchanged", () => {
    expect(byId(resolved(), "command-palette")).toMatchObject({ code: "KeyK", tier: "cmd" });
    expect(byId(resolved(), "sidebar-toggle")).toMatchObject({ code: "Backslash", tier: "cmd" });
    expect(byId(resolved(), "view-cycle")).toMatchObject({ code: "Period", tier: "cmd", scope: "terminal" });
    expect(byId(resolved(), "chat-toggle")).toMatchObject({ code: "Backquote", tier: "ctrl", scope: "terminal" });
    expect(byId(resolved(), "board-cycle-next")).toMatchObject({ code: "BracketRight", tier: "cmd", scope: "board" });
    expect(byId(resolved(), "board-cycle-prev")).toMatchObject({ code: "BracketLeft", tier: "cmd", scope: "board" });
  });

  it("ships conflict-free defaults in every host", () => {
    for (const host of ALL_HOSTS) {
      expect(findConflicts(resolved(host))).toEqual([]);
    }
  });

  it("keeps ⌘K firing in inputs (ignoreInputs) — byte-identical migration", () => {
    expect(byId(resolved(), "command-palette").ignoreInputs).toBe(true);
  });
});

describe("matchesCombo (tier modifier rules)", () => {
  const shifted = { code: "KeyL", tier: "shifted" as const };
  const cmd = { code: "KeyK", tier: "cmd" as const };
  const ctrl = { code: "Backquote", tier: "ctrl" as const };

  it("shifted requires Shift plus Meta OR Ctrl", () => {
    expect(matchesCombo(chord({ code: "KeyL", shiftKey: true, ctrlKey: true }), shifted)).toBe(true);
    expect(matchesCombo(chord({ code: "KeyL", shiftKey: true, metaKey: true }), shifted)).toBe(true);
    expect(matchesCombo(chord({ code: "KeyL", shiftKey: true }), shifted)).toBe(false);
    expect(matchesCombo(chord({ code: "KeyL", ctrlKey: true }), shifted)).toBe(false);
  });

  it("cmd requires Meta OR Ctrl WITHOUT Shift", () => {
    expect(matchesCombo(chord({ code: "KeyK", metaKey: true }), cmd)).toBe(true);
    expect(matchesCombo(chord({ code: "KeyK", ctrlKey: true }), cmd)).toBe(true);
    expect(matchesCombo(chord({ code: "KeyK", metaKey: true, shiftKey: true }), cmd)).toBe(false);
    expect(matchesCombo(chord({ code: "KeyK" }), cmd)).toBe(false);
  });

  it("ctrl requires plain Ctrl (no Meta, no Shift)", () => {
    expect(matchesCombo(chord({ code: "Backquote", ctrlKey: true }), ctrl)).toBe(true);
    expect(matchesCombo(chord({ code: "Backquote", metaKey: true }), ctrl)).toBe(false);
    expect(matchesCombo(chord({ code: "Backquote", ctrlKey: true, shiftKey: true }), ctrl)).toBe(false);
  });

  it("Alt excludes every tier", () => {
    expect(matchesCombo(chord({ code: "KeyL", shiftKey: true, ctrlKey: true, altKey: true }), shifted)).toBe(false);
    expect(matchesCombo(chord({ code: "KeyK", metaKey: true, altKey: true }), cmd)).toBe(false);
    expect(matchesCombo(chord({ code: "Backquote", ctrlKey: true, altKey: true }), ctrl)).toBe(false);
  });

  it("code mismatch never matches", () => {
    expect(matchesCombo(chord({ code: "KeyH", shiftKey: true, ctrlKey: true }), shifted)).toBe(false);
  });
});

describe("findMatches (single-chord resolution)", () => {
  it("returns the enabled binding for a matching chord", () => {
    const matches = findMatches(chord({ code: "KeyL", shiftKey: true, ctrlKey: true }), resolved());
    expect(matches.map((b) => b.actionId)).toEqual(["window-next"]);
  });

  it("skips disabled bindings", () => {
    const bindings = resolved(SHELL_OTHER, { "window-next": null });
    expect(findMatches(chord({ code: "KeyL", shiftKey: true, ctrlKey: true }), bindings)).toEqual([]);
  });
});

describe("resolveBindings", () => {
  it("applies a combo override and flags it non-default", () => {
    const bindings = resolved(SHELL_OTHER, {
      "window-next": { code: "KeyU", tier: "shifted" as const },
    });
    const next = byId(bindings, "window-next");
    expect(next).toMatchObject({ code: "KeyU", tier: "shifted", enabled: true, isDefault: false });
    // The default combo no longer matches anything.
    expect(findMatches(chord({ code: "KeyL", shiftKey: true, ctrlKey: true }), bindings)).toEqual([]);
    // The override combo matches the action.
    expect(findMatches(chord({ code: "KeyU", shiftKey: true, ctrlKey: true }), bindings)[0]?.actionId).toBe("window-next");
  });

  it("null override disables with reason 'user'", () => {
    const bindings = resolved(SHELL_OTHER, { "create-session": null });
    expect(byId(bindings, "create-session")).toMatchObject({
      enabled: false,
      disabledReason: "user",
      isDefault: false,
    });
  });

  it("browser hosts disable the reserved shifted N/T/W defaults, shell hosts do not", () => {
    const browser = resolved(BROWSER_OTHER);
    for (const id of ["create-session", "create-window", "kill-window"]) {
      expect(byId(browser, id)).toMatchObject({ enabled: false, disabledReason: "reserved" });
    }
    for (const id of ["window-prev", "window-next", "go-back", "go-forward", "agent-next-waiting", "shortcuts-overlay"]) {
      expect(byId(browser, id).enabled).toBe(true);
    }
    const shell = resolved(SHELL_OTHER);
    for (const id of ["create-session", "create-window", "kill-window"]) {
      expect(byId(shell, id).enabled).toBe(true);
    }
  });

  it("an override onto a browser-reserved key resolves disabled in a browser host", () => {
    const bindings = resolveBindings(
      DEFAULT_BINDINGS,
      { "window-next": { code: "KeyN", tier: "shifted" } },
      BROWSER_OTHER,
    );
    expect(byId(bindings, "window-next")).toMatchObject({ enabled: false, disabledReason: "reserved" });
  });

  it("an override off a reserved key re-enables the action in a browser host", () => {
    const bindings = resolveBindings(
      DEFAULT_BINDINGS,
      { "create-session": { code: "KeyG", tier: "shifted" } },
      BROWSER_OTHER,
    );
    expect(byId(bindings, "create-session")).toMatchObject({ code: "KeyG", enabled: true });
  });
});

describe("claimedKeys", () => {
  const codes = (platform: "mac" | "other", shell: boolean, tier: "shifted" | "cmd" | "ctrl") =>
    claimedKeys(platform, shell)
      .filter((c) => c.tier === tier)
      .map((c) => c.code);

  it("claims the shifted switcher digits on win/linux only + R everywhere, I/C/V on win-linux, Q on mac (260731-nv5r)", () => {
    // Mac: the switcher moved to ⌥⌘1–9 (outside every tier), so the shifted
    // tier carries NO shell digit claims — only the 3/4/5 screenshot system
    // claims below. Freed ⇧⌘1/2/6–9 are unclaimed future page real estate.
    const mac = codes("mac", true, "shifted");
    for (const n of [1, 2, 6, 7, 8, 9]) {
      expect(mac).not.toContain(`Digit${n}`);
    }
    expect(mac).toEqual(expect.arrayContaining(["Digit3", "Digit4", "Digit5"]));
    expect(mac).toContain("KeyR");
    expect(mac).toContain("KeyQ");
    expect(mac).not.toContain("KeyI");
    expect(mac).not.toContain("KeyC");
    // Win/linux: the nine shell-owned switcher digits stay, unchanged.
    const other = codes("other", true, "shifted");
    expect(other).toEqual(
      expect.arrayContaining(["Digit1", "Digit9", "KeyR", "KeyI", "KeyC", "KeyV"]),
    );
    expect(other).not.toContain("KeyQ");
  });

  it("mac ⇧⌘3/4/5 screenshot claims are system-owned and apply in both hosts; win/linux digits stay shell-owned (260731-nv5r)", () => {
    for (const shell of [true, false]) {
      const screenshots = claimedKeys("mac", shell).filter(
        (c) => c.tier === "shifted" && c.label === "screenshot",
      );
      expect(screenshots.map((c) => c.code).sort()).toEqual(["Digit3", "Digit4", "Digit5"]);
      expect(screenshots.every((c) => c.owner === "system")).toBe(true);
      const otherDigits = claimedKeys("other", shell).filter(
        (c) => c.tier === "shifted" && c.code.startsWith("Digit"),
      );
      expect(otherDigits).toHaveLength(9);
      expect(otherDigits.every((c) => c.owner === "shell" && c.label === "server")).toBe(true);
    }
  });

  it("adds browser-owned shifted N/T/W only outside the shell", () => {
    const inShell = claimedKeys("other", true);
    expect(inShell.some((c) => c.owner === "browser")).toBe(false);
    const inBrowser = claimedKeys("other", false).filter(
      (c) => c.owner === "browser" && c.tier === "shifted",
    );
    expect(inBrowser.map((c) => c.code).sort()).toEqual(["KeyN", "KeyT", "KeyW"]);
  });

  it("mac shell claims the ⌘ menu-accelerator set on the cmd tier (260730-n789)", () => {
    const macShellCmd = claimedKeys("mac", true).filter((c) => c.tier === "cmd");
    expect(macShellCmd.every((c) => c.owner === "shell")).toBe(true);
    expect(macShellCmd.map((c) => c.code).sort()).toEqual(
      ["Digit0", "Equal", "KeyA", "KeyC", "KeyH", "KeyM", "KeyQ", "KeyR", "KeyV", "KeyX", "KeyZ", "Minus"],
    );
    // The demoted defaults' keys are NOT shell-claimed: guaranteed fall-through.
    for (const code of ["KeyN", "KeyT", "KeyW", "BracketLeft", "BracketRight", "Slash"]) {
      expect(macShellCmd.map((c) => c.code)).not.toContain(code);
    }
  });

  it("mac browser claims ⌘ N/T/W/L + tab digits as browser-owned, Q/H/M as system", () => {
    const macBrowserCmd = claimedKeys("mac", false).filter((c) => c.tier === "cmd");
    const browserOwned = macBrowserCmd.filter((c) => c.owner === "browser").map((c) => c.code);
    expect(browserOwned).toEqual(
      expect.arrayContaining(["KeyN", "KeyT", "KeyW", "KeyL", "Digit1", "Digit9"]),
    );
    const systemOwned = macBrowserCmd.filter((c) => c.owner === "system").map((c) => c.code).sort();
    expect(systemOwned).toEqual(["KeyH", "KeyM", "KeyQ"]);
    // ⌘[/⌘]/⌘/ stay free — that is the whole demotion premise.
    for (const code of ["BracketLeft", "BracketRight", "Slash"]) {
      expect(macBrowserCmd.map((c) => c.code)).not.toContain(code);
    }
  });

  it("win/linux hosts carry NO cmd-tier claims (plain Ctrl is the pane's)", () => {
    expect(codes("other", true, "cmd")).toEqual([]);
    expect(codes("other", false, "cmd")).toEqual([]);
  });

  it("every pre-n789 claim carries tier 'shifted'", () => {
    for (const host of [true, false]) {
      for (const c of claimedKeys("other", host)) {
        expect(c.tier).toBe("shifted");
      }
    }
  });
});

describe("override storage", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("parseOverrides tolerates malformed JSON, non-object roots, and garbage entries", () => {
    expect(parseOverrides(null)).toEqual({});
    expect(parseOverrides("not json {")).toEqual({});
    expect(parseOverrides('"a string"')).toEqual({});
    expect(parseOverrides("[1,2]")).toEqual({});
    expect(
      parseOverrides(
        JSON.stringify({
          good: { code: "KeyU", tier: "shifted" },
          disabled: null,
          badTier: { code: "KeyU", tier: "hyper" },
          badShape: 42,
          emptyCode: { code: "", tier: "cmd" },
        }),
      ),
    ).toEqual({ good: { code: "KeyU", tier: "shifted" }, disabled: null });
  });

  it("round-trips diffs and removes the key when the diff empties", () => {
    writeStoredOverrides({ "window-next": { code: "KeyU", tier: "shifted" } });
    expect(readStoredOverrides()).toEqual({ "window-next": { code: "KeyU", tier: "shifted" } });
    writeStoredOverrides({});
    expect(localStorage.getItem(KEYBINDINGS_STORAGE_KEY)).toBeNull();
    expect(readStoredOverrides()).toEqual({});
  });
});

describe("scopesOverlap / findConflicts", () => {
  it("global overlaps everything; terminal and board are disjoint", () => {
    expect(scopesOverlap("global", "board")).toBe(true);
    expect(scopesOverlap("terminal", "global")).toBe(true);
    expect(scopesOverlap("terminal", "terminal")).toBe(true);
    expect(scopesOverlap("terminal", "board")).toBe(false);
  });

  it("flags two enabled bindings on the same tier+code with overlapping scopes", () => {
    const bindings = resolveBindings(
      DEFAULT_BINDINGS,
      { "window-next": { code: "KeyA", tier: "shifted" } },
      SHELL_OTHER,
    );
    const conflicts = findConflicts(bindings);
    expect(conflicts).toHaveLength(1);
    expect([conflicts[0].a, conflicts[0].b].sort()).toEqual(["agent-next-waiting", "window-next"]);
  });

  it("does not flag the board ⌘[/⌘] pair against the global shifted [/] pair", () => {
    expect(findConflicts(resolved())).toEqual([]);
  });

  it("tiersCollide: cmd and ctrl collide (a plain Ctrl chord matches both); shifted is disjoint", () => {
    expect(tiersCollide("cmd", "ctrl")).toBe(true);
    expect(tiersCollide("ctrl", "cmd")).toBe(true);
    expect(tiersCollide("cmd", "cmd")).toBe(true);
    expect(tiersCollide("shifted", "cmd")).toBe(false);
    expect(tiersCollide("shifted", "ctrl")).toBe(false);
  });

  it("flags a cmd-tier binding masking a ctrl-tier one on the same code and scope", () => {
    // A Ctrl chord captured on non-mac reads as `cmd`; on the same code it
    // matches the same keydown as the `ctrl`-tier chat-toggle default. Both
    // are terminal-scoped, so this is a real conflict, not a shadow.
    const bindings = resolveBindings(
      DEFAULT_BINDINGS,
      { "view-cycle": { code: "Backquote", tier: "cmd" } },
      SHELL_OTHER,
    );
    const conflicts = findConflicts(bindings);
    expect(conflicts).toHaveLength(1);
    expect([conflicts[0].a, conflicts[0].b].sort()).toEqual(["chat-toggle", "view-cycle"]);
  });

  it("treats a same-combo global↔scoped pair as a shadow, not a conflict (260730-n789)", () => {
    // sidebar-toggle (global) onto chat-toggle's colliding combo: scopes
    // differ with one global → dispatch precedence resolves it, no conflict.
    const bindings = resolveBindings(
      DEFAULT_BINDINGS,
      { "sidebar-toggle": { code: "Backquote", tier: "cmd" } },
      SHELL_OTHER,
    );
    expect(findConflicts(bindings)).toEqual([]);
    // The shipped mac default map carries exactly this shape: board ⌘[/⌘]
    // (board scope) shadowing the demoted global back/forward.
    expect(findConflicts(resolved(SHELL_MAC))).toEqual([]);
  });
});

describe("captureFromEvent", () => {
  it("keeps capturing on modifier-only presses", () => {
    expect(captureFromEvent(chord({ code: "ShiftLeft", shiftKey: true }), "other")).toBeNull();
    expect(captureFromEvent(chord({ code: "ControlLeft", ctrlKey: true }), "other")).toBeNull();
    expect(captureFromEvent(chord({ code: "MetaRight", metaKey: true }), "mac")).toBeNull();
  });

  it("rejects Alt chords and bare keys (no tier models them)", () => {
    expect(captureFromEvent(chord({ code: "KeyU", altKey: true, ctrlKey: true, shiftKey: true }), "other")).toBeNull();
    expect(captureFromEvent(chord({ code: "KeyU" }), "other")).toBeNull();
    expect(captureFromEvent(chord({ code: "KeyU", shiftKey: true }), "other")).toBeNull();
  });

  it("derives the shifted tier from Shift+CmdOrCtrl", () => {
    expect(captureFromEvent(chord({ code: "KeyU", shiftKey: true, ctrlKey: true }), "other")).toEqual({
      code: "KeyU",
      tier: "shifted",
    });
    expect(captureFromEvent(chord({ code: "KeyU", shiftKey: true, metaKey: true }), "mac")).toEqual({
      code: "KeyU",
      tier: "shifted",
    });
  });

  it("reads Ctrl-without-Meta as ctrl on mac, cmd elsewhere (device-local)", () => {
    expect(captureFromEvent(chord({ code: "KeyB", ctrlKey: true }), "mac")).toEqual({
      code: "KeyB",
      tier: "ctrl",
    });
    expect(captureFromEvent(chord({ code: "KeyB", ctrlKey: true }), "other")).toEqual({
      code: "KeyB",
      tier: "cmd",
    });
    expect(captureFromEvent(chord({ code: "KeyB", metaKey: true }), "mac")).toEqual({
      code: "KeyB",
      tier: "cmd",
    });
  });
});

describe("applyCapture (steal-with-warning)", () => {
  it("assigns a free combo without a victim", () => {
    const { overrides, stolenFrom } = applyCapture(
      resolved(),
      {},
      "window-next",
      { code: "KeyU", tier: "shifted" },
      SHELL_OTHER,
    );
    expect(overrides).toEqual({ "window-next": { code: "KeyU", tier: "shifted" } });
    expect(stolenFrom).toBeNull();
  });

  it("steals from the enabled owner and unbinds it (null override)", () => {
    const { overrides, stolenFrom } = applyCapture(
      resolved(),
      {},
      "window-next",
      { code: "KeyA", tier: "shifted" },
      SHELL_OTHER,
    );
    expect(stolenFrom).toBe("agent-next-waiting");
    expect(overrides).toEqual({
      "window-next": { code: "KeyA", tier: "shifted" },
      "agent-next-waiting": null,
    });
  });

  it("steals across the colliding cmd/ctrl tiers on the same code", () => {
    // sidebar-toggle (global) captures cmd+Backquote — the chord a non-mac
    // Ctrl+` capture produces. It matches the same keydown as chat-toggle's
    // ctrl-tier default, so chat-toggle must be flagged and unbound instead
    // of silently masked at dispatch (chat-toggle listens component-locally
    // and never sees `findMatches` precedence).
    const { overrides, stolenFrom } = applyCapture(
      resolved(),
      {},
      "sidebar-toggle",
      { code: "Backquote", tier: "cmd" },
      SHELL_OTHER,
    );
    expect(stolenFrom).toBe("chat-toggle");
    expect(overrides).toEqual({
      "sidebar-toggle": { code: "Backquote", tier: "cmd" },
      "chat-toggle": null,
    });
  });

  it("does not steal across disjoint scopes", () => {
    // view-cycle is terminal-scope; board-cycle-next owns cmd+BracketRight in
    // board scope — capturing it for view-cycle must not unbind the board pair.
    const { stolenFrom } = applyCapture(
      resolved(),
      {},
      "view-cycle",
      { code: "BracketRight", tier: "cmd" },
      SHELL_OTHER,
    );
    expect(stolenFrom).toBeNull();
  });

  it("re-capturing the action's own default drops its diff entry", () => {
    const prior = { "window-next": { code: "KeyU", tier: "shifted" as const } };
    const { overrides } = applyCapture(
      resolveBindings(DEFAULT_BINDINGS, prior, SHELL_OTHER),
      prior,
      "window-next",
      { code: "KeyL", tier: "shifted" },
      SHELL_OTHER,
    );
    expect(overrides).toEqual({});
  });

  it("own-default detection is host-aware: ⌘/ is shortcuts-overlay's mac default (260730-n789)", () => {
    // On a mac host the demoted default is {Slash, cmd}; re-capturing it must
    // drop the diff, not store a "modified" entry.
    const prior = { "shortcuts-overlay": { code: "KeyO", tier: "shifted" as const } };
    const { overrides, stolenFrom } = applyCapture(
      resolveBindings(DEFAULT_BINDINGS, prior, SHELL_MAC),
      prior,
      "shortcuts-overlay",
      { code: "Slash", tier: "cmd" },
      SHELL_MAC,
    );
    expect(overrides).toEqual({});
    expect(stolenFrom).toBeNull();
    // On a win/linux host the same combo is NOT the default → stored as a diff.
    const other = applyCapture(
      resolveBindings(DEFAULT_BINDINGS, {}, SHELL_OTHER),
      {},
      "shortcuts-overlay",
      { code: "Slash", tier: "cmd" },
      SHELL_OTHER,
    );
    expect(other.overrides).toEqual({ "shortcuts-overlay": { code: "Slash", tier: "cmd" } });
  });

  it("re-capturing a shadowed mac default steals nothing from its shadow partner (260730-n789)", () => {
    // On mac hosts go-back/board-cycle-prev share ⌘[ and go-forward/
    // board-cycle-next share ⌘] (global↔board shadow, resolved by dispatch
    // precedence). A no-op re-capture of either partner's own default must
    // not unbind the other — all four directions.
    const pairs = [
      { actionId: "go-back", partner: "board-cycle-prev", code: "BracketLeft" },
      { actionId: "board-cycle-prev", partner: "go-back", code: "BracketLeft" },
      { actionId: "go-forward", partner: "board-cycle-next", code: "BracketRight" },
      { actionId: "board-cycle-next", partner: "go-forward", code: "BracketRight" },
    ] as const;
    for (const { actionId, partner, code } of pairs) {
      const { overrides, stolenFrom } = applyCapture(
        resolved(SHELL_MAC),
        {},
        actionId,
        { code, tier: "cmd" },
        SHELL_MAC,
      );
      expect(overrides, `${actionId} re-capture must write no diff`).toEqual({});
      expect(stolenFrom, `${actionId} re-capture must steal nothing`).toBeNull();
      const after = byId(resolveBindings(DEFAULT_BINDINGS, overrides, SHELL_MAC), partner);
      expect(after.enabled, `${partner} must stay bound`).toBe(true);
      expect({ code: after.code, tier: after.tier }).toEqual({ code, tier: "cmd" });
    }
  });

  it("a genuine capture onto a shadow partner's combo still steals (260730-n789)", () => {
    // ⌘[ is NOT go-forward's own default (⌘] is), so capturing it for
    // go-forward is a real rebind — the enabled owner is stolen from as usual
    // (go-back first in registry order; scopesOverlap global↔board keeps the
    // board partner a steal target too, per the Design Decision).
    const { overrides, stolenFrom } = applyCapture(
      resolved(SHELL_MAC),
      {},
      "go-forward",
      { code: "BracketLeft", tier: "cmd" },
      SHELL_MAC,
    );
    expect(stolenFrom).toBe("go-back");
    expect(overrides).toEqual({
      "go-forward": { code: "BracketLeft", tier: "cmd" },
      "go-back": null,
    });
  });
});

describe("formatting", () => {
  it("keyLabel maps codes to keycaps", () => {
    expect(keyLabel("KeyN")).toBe("N");
    expect(keyLabel("Digit3")).toBe("3");
    expect(keyLabel("BracketLeft")).toBe("[");
    expect(keyLabel("Slash")).toBe("/");
    expect(keyLabel("Backquote")).toBe("`");
    expect(keyLabel("F5")).toBe("F5");
  });

  it("formats per platform, keeping the historical hint spellings", () => {
    expect(formatCombo({ code: "KeyN", tier: "shifted" }, "mac")).toBe("⇧⌘N");
    expect(formatCombo({ code: "KeyN", tier: "shifted" }, "other")).toBe("Shift+Ctrl+N");
    expect(formatCombo({ code: "Period", tier: "cmd" }, "mac")).toBe("⌘.");
    expect(formatCombo({ code: "Period", tier: "cmd" }, "other")).toBe("Ctrl+.");
    expect(formatCombo({ code: "Backquote", tier: "ctrl" }, "mac")).toBe("Ctrl+`");
    expect(formatCombo({ code: "Backquote", tier: "ctrl" }, "other")).toBe("Ctrl+`");
  });

  it("comboParts renders keycap sequences", () => {
    expect(comboParts({ code: "KeyH", tier: "shifted" }, "mac")).toEqual(["⇧", "⌘", "H"]);
    expect(comboParts({ code: "KeyH", tier: "shifted" }, "other")).toEqual(["Shift", "Ctrl", "H"]);
    expect(comboParts({ code: "KeyK", tier: "cmd" }, "other")).toEqual(["Ctrl", "K"]);
  });
});

describe("shouldSuppressChord (shared input gating)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("does NOT suppress on a null / non-element target", () => {
    expect(shouldSuppressChord(null)).toBe(false);
    expect(shouldSuppressChord(new EventTarget())).toBe(false);
  });

  it("suppresses on a real (non-xterm) INPUT / TEXTAREA / contenteditable", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    document.body.append(input, textarea, editable);
    expect(shouldSuppressChord(input)).toBe(true);
    expect(shouldSuppressChord(textarea)).toBe(true);
    expect(shouldSuppressChord(editable)).toBe(true);
  });

  it("does NOT suppress inside xterm's helper textarea (the terminal's normal focus)", () => {
    const xterm = document.createElement("div");
    xterm.className = "xterm";
    const helper = document.createElement("textarea");
    xterm.appendChild(helper);
    document.body.appendChild(xterm);
    expect(shouldSuppressChord(helper)).toBe(false);
  });

  it("does NOT suppress in the chat-send input (.rk-chat-input carve-out)", () => {
    const chatInput = document.createElement("textarea");
    chatInput.className = "rk-chat-input";
    document.body.appendChild(chatInput);
    expect(shouldSuppressChord(chatInput)).toBe(false);
  });

  it("does NOT suppress on a plain non-input element", () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    expect(shouldSuppressChord(div)).toBe(false);
  });
});

describe("withShortcutHints", () => {
  const platform = "other" as const;

  it("decorates palette actions whose id has an enabled binding", () => {
    const byAction = new Map(resolved().map((b) => [b.actionId, b]));
    const actions = [
      { id: "create-window", label: "Window: Create" },
      { id: "unrelated", label: "Something", shortcut: "F5" },
    ];
    const hinted = withShortcutHints(actions, byAction, platform);
    expect(hinted[0].shortcut).toBe("Shift+Ctrl+T");
    expect(hinted[1].shortcut).toBe("F5"); // untouched pass-through
  });

  it("renders no hint for disabled bindings (reserved or user-disabled)", () => {
    const byAction = new Map(resolved(BROWSER_OTHER).map((b) => [b.actionId, b]));
    const [entry] = withShortcutHints([{ id: "create-window", label: "Window: Create" }], byAction, platform);
    expect(entry.shortcut).toBeUndefined();
  });

  it("reflects overrides", () => {
    const bindings = resolveBindings(
      DEFAULT_BINDINGS,
      { "window-next": { code: "KeyU", tier: "shifted" } },
      SHELL_OTHER,
    );
    const byAction = new Map(bindings.map((b) => [b.actionId, b]));
    const [entry] = withShortcutHints([{ id: "window-next", label: "x" }], byAction, platform);
    expect(entry.shortcut).toBe("Shift+Ctrl+U");
  });
});

describe("keyless (macro) defaults — 260730-hbyh", () => {
  // Macros enter resolution as ordinary defaults with `code: ""` (no shipped
  // combo — see lib/macros.ts `macroToBinding`); their combo lives solely in
  // the override diff map.
  const MACRO: KeyBinding = {
    actionId: "macro:discuss",
    code: "",
    tier: "shifted",
    scope: "global",
    kind: "macro",
    label: "riff: discuss",
  };
  const withMacro = [...DEFAULT_BINDINGS, MACRO];

  it("resolves unbound (disabled, reason 'user') without an override", () => {
    const bindings = resolveBindings(withMacro, {}, SHELL_OTHER);
    expect(byId(bindings, "macro:discuss")).toMatchObject({
      enabled: false,
      isDefault: false,
      disabledReason: "user",
    });
    expect(findMatches(chord({ code: "KeyD", shiftKey: true, ctrlKey: true }), bindings)).toEqual([]);
  });

  it("an override combo makes the macro live and matchable", () => {
    const bindings = resolveBindings(
      withMacro,
      { "macro:discuss": { code: "KeyD", tier: "shifted" } },
      SHELL_OTHER,
    );
    expect(byId(bindings, "macro:discuss")).toMatchObject({
      code: "KeyD",
      enabled: true,
      isDefault: false,
      kind: "macro",
    });
    expect(
      findMatches(chord({ code: "KeyD", shiftKey: true, ctrlKey: true }), bindings)[0]?.actionId,
    ).toBe("macro:discuss");
  });

  it("a macro combo on a browser-reserved key resolves disabled", () => {
    const bindings = resolveBindings(
      withMacro,
      { "macro:discuss": { code: "KeyN", tier: "shifted" } },
      BROWSER_OTHER,
    );
    expect(byId(bindings, "macro:discuss")).toMatchObject({
      enabled: false,
      disabledReason: "reserved",
    });
  });

  it("steals work in both directions between macros and builtins", () => {
    // Builtin captures the macro's combo → macro unbound.
    const macroOwns = { "macro:discuss": { code: "KeyD", tier: "shifted" as const } };
    const stealByBuiltin = applyCapture(
      resolveBindings(withMacro, macroOwns, SHELL_OTHER),
      macroOwns,
      "window-next",
      { code: "KeyD", tier: "shifted" },
      SHELL_OTHER,
      withMacro,
    );
    expect(stealByBuiltin.stolenFrom).toBe("macro:discuss");
    expect(stealByBuiltin.overrides).toEqual({
      "macro:discuss": null,
      "window-next": { code: "KeyD", tier: "shifted" },
    });

    // Macro captures a builtin's default combo → builtin unbound.
    const stealByMacro = applyCapture(
      resolveBindings(withMacro, {}, SHELL_OTHER),
      {},
      "macro:discuss",
      { code: "KeyL", tier: "shifted" },
      SHELL_OTHER,
      withMacro,
    );
    expect(stealByMacro.stolenFrom).toBe("window-next");
    expect(stealByMacro.overrides).toEqual({
      "window-next": null,
      "macro:discuss": { code: "KeyL", tier: "shifted" },
    });
  });

  it("keyless macro defaults are unaffected by mac hosts (defaultComboFor passthrough)", () => {
    const bindings = resolveBindings(withMacro, {}, SHELL_MAC);
    expect(byId(bindings, "macro:discuss")).toMatchObject({
      enabled: false,
      isDefault: false,
      disabledReason: "user",
    });
  });

  it("withShortcutHints decorates a bound macro and skips an unbound one", () => {
    const bound = resolveBindings(
      withMacro,
      { "macro:discuss": { code: "KeyD", tier: "shifted" } },
      SHELL_OTHER,
    );
    const byActionBound = new Map(bound.map((b) => [b.actionId, b]));
    const [hinted] = withShortcutHints(
      [{ id: "macro:discuss", label: "Macro: riff: discuss" }],
      byActionBound,
      "other",
    );
    expect(hinted.shortcut).toBe("Shift+Ctrl+D");

    const unbound = resolveBindings(withMacro, {}, SHELL_OTHER);
    const byActionUnbound = new Map(unbound.map((b) => [b.actionId, b]));
    const [unhinted] = withShortcutHints(
      [{ id: "macro:discuss", label: "Macro: riff: discuss" }],
      byActionUnbound,
      "other",
    );
    expect(unhinted.shortcut).toBeUndefined();
  });
});

describe("per-platform default tiers — 260730-n789", () => {
  it("mac shell: N/T/W and [/]// demote to the ⌘ tier; H/L/A stay shifted", () => {
    const bindings = resolved(SHELL_MAC);
    for (const id of ["create-session", "create-window", "kill-window", "go-back", "go-forward", "shortcuts-overlay"]) {
      expect(byId(bindings, id)).toMatchObject({ tier: "cmd", enabled: true, isDefault: true });
    }
    for (const id of ["window-prev", "window-next", "agent-next-waiting"]) {
      expect(byId(bindings, id)).toMatchObject({ tier: "shifted", enabled: true, isDefault: true });
    }
    // Letters constant — only the modifier tier varies.
    expect(byId(bindings, "create-session").code).toBe("KeyN");
    expect(byId(bindings, "go-back").code).toBe("BracketLeft");
  });

  it("mac browser: [/]// demote; N/T/W keep the shifted default and stay browser-reserved", () => {
    const bindings = resolved(BROWSER_MAC);
    for (const id of ["go-back", "go-forward", "shortcuts-overlay"]) {
      expect(byId(bindings, id)).toMatchObject({ tier: "cmd", enabled: true, isDefault: true });
    }
    for (const id of ["create-session", "create-window", "kill-window"]) {
      expect(byId(bindings, id)).toMatchObject({
        tier: "shifted",
        enabled: false,
        disabledReason: "reserved",
      });
    }
    for (const id of ["window-prev", "window-next", "agent-next-waiting"]) {
      expect(byId(bindings, id)).toMatchObject({ tier: "shifted", enabled: true });
    }
  });

  it("win/linux resolution is byte-identical to the uniform shifted tier (both hosts)", () => {
    for (const host of [SHELL_OTHER, BROWSER_OTHER]) {
      const bindings = resolved(host);
      for (const id of [
        "create-session", "create-window", "kill-window", "window-prev", "window-next",
        "go-back", "go-forward", "agent-next-waiting", "shortcuts-overlay",
      ]) {
        expect(byId(bindings, id).tier).toBe("shifted");
      }
    }
    // Browser-host N/T/W reservation unchanged.
    expect(byId(resolved(BROWSER_OTHER), "create-session").enabled).toBe(false);
    expect(byId(resolved(SHELL_OTHER), "create-session").enabled).toBe(true);
  });

  it("defaultComboFor: macTier applies on mac (shell-gated by macShellOnly), base tier elsewhere", () => {
    const goBack = DEFAULT_BINDINGS.find((b) => b.actionId === "go-back")!;
    const createSession = DEFAULT_BINDINGS.find((b) => b.actionId === "create-session")!;
    expect(defaultComboFor(goBack, SHELL_MAC)).toEqual({ code: "BracketLeft", tier: "cmd" });
    expect(defaultComboFor(goBack, BROWSER_MAC)).toEqual({ code: "BracketLeft", tier: "cmd" });
    expect(defaultComboFor(goBack, SHELL_OTHER)).toEqual({ code: "BracketLeft", tier: "shifted" });
    expect(defaultComboFor(createSession, SHELL_MAC)).toEqual({ code: "KeyN", tier: "cmd" });
    expect(defaultComboFor(createSession, BROWSER_MAC)).toEqual({ code: "KeyN", tier: "shifted" });
    expect(defaultComboFor(createSession, BROWSER_OTHER)).toEqual({ code: "KeyN", tier: "shifted" });
  });

  it("stored-override shape is unchanged: a {code,tier} diff applies as-is on mac hosts", () => {
    // A mac user pinning go-back BACK to the shifted tier: plain diff entry.
    const bindings = resolveBindings(
      DEFAULT_BINDINGS,
      { "go-back": { code: "BracketLeft", tier: "shifted" } },
      SHELL_MAC,
    );
    expect(byId(bindings, "go-back")).toMatchObject({
      tier: "shifted",
      enabled: true,
      isDefault: false, // the mac default is the cmd tier
    });
  });

  it("mac-browser ⌘ browser claims disable overrides tier-aware; the mac shell frees them", () => {
    const overrides = { "window-next": { code: "KeyL", tier: "cmd" as const } };
    expect(byId(resolveBindings(DEFAULT_BINDINGS, overrides, BROWSER_MAC), "window-next")).toMatchObject({
      enabled: false,
      disabledReason: "reserved",
    });
    expect(byId(resolveBindings(DEFAULT_BINDINGS, overrides, SHELL_MAC), "window-next")).toMatchObject({
      enabled: true,
    });
    // Win/linux cmd-tier overrides are untouched by the mac claim set.
    expect(byId(resolveBindings(DEFAULT_BINDINGS, overrides, BROWSER_OTHER), "window-next")).toMatchObject({
      enabled: true,
    });
  });

  it("mac defaults dispatch: ⌘[ matches (board shadow first), ⇧⌘[ matches nothing", () => {
    const bindings = resolved(SHELL_MAC);
    // ⌘[ matches BOTH go-back and the board pane-cycle — scoped-first order
    // (the dispatcher then picks the first with a handler at its mount).
    expect(
      findMatches(chord({ code: "BracketLeft", metaKey: true }), bindings).map((b) => b.actionId),
    ).toEqual(["board-cycle-prev", "go-back"]);
    // ⌘/ is unshared: findMatches resolves the demoted overlay toggle alone.
    expect(
      findMatches(chord({ code: "Slash", metaKey: true }), bindings).map((b) => b.actionId),
    ).toEqual(["shortcuts-overlay"]);
    // The old shifted default no longer matches on mac (go-back moved tiers;
    // board-cycle-prev is cmd-tier and shifted-disjoint).
    expect(
      findMatches(chord({ code: "BracketLeft", metaKey: true, shiftKey: true }), bindings),
    ).toEqual([]);
    // Shell-only demotions: ⌘N matches create-session inside the shell only.
    expect(
      findMatches(chord({ code: "KeyN", metaKey: true }), bindings)[0]?.actionId,
    ).toBe("create-session");
    expect(findMatches(chord({ code: "KeyN", metaKey: true }), resolved(BROWSER_MAC))).toEqual([]);
  });
});

describe("findMatches — scoped-beats-global precedence (260730-n789)", () => {
  it("orders a scoped match before the global one sharing the combo (mac ⌘[)", () => {
    const matches = findMatches(chord({ code: "BracketLeft", metaKey: true }), resolved(SHELL_MAC));
    expect(matches.map((b) => b.actionId)).toEqual(["board-cycle-prev", "go-back"]);
  });

  it("returns single matches untouched and [] for no match", () => {
    expect(
      findMatches(chord({ code: "KeyL", shiftKey: true, ctrlKey: true }), resolved()).map(
        (b) => b.actionId,
      ),
    ).toEqual(["window-next"]);
    expect(findMatches(chord({ code: "KeyL" }), resolved())).toEqual([]);
  });
});

describe("shouldRefuseTerminalChord (260730-n789)", () => {
  it("refuses enabled shifted-tier matches on every platform (the g40a rule)", () => {
    const e = chord({ code: "KeyL", shiftKey: true, ctrlKey: true });
    expect(shouldRefuseTerminalChord(e, resolved(SHELL_OTHER), "other")).toBe(true);
    expect(shouldRefuseTerminalChord(e, resolved(SHELL_MAC), "mac")).toBe(true);
  });

  it("mac only: refuses a ⌘ (metaKey) cmd-tier match so demoted chords fire from the pane", () => {
    const bindings = resolved(SHELL_MAC);
    expect(
      shouldRefuseTerminalChord(chord({ code: "BracketLeft", metaKey: true }), bindings, "mac"),
    ).toBe(true);
    expect(
      shouldRefuseTerminalChord(chord({ code: "KeyN", metaKey: true }), bindings, "mac"),
    ).toBe(true);
  });

  it("mac: NEVER refuses plain-Ctrl chords (Ctrl+[ is ESC and belongs to the pane)", () => {
    const bindings = resolved(SHELL_MAC);
    expect(
      shouldRefuseTerminalChord(chord({ code: "BracketLeft", ctrlKey: true }), bindings, "mac"),
    ).toBe(false);
    // Unbound ⌘ keys pass through too (no enabled match).
    expect(
      shouldRefuseTerminalChord(chord({ code: "KeyF", metaKey: true }), bindings, "mac"),
    ).toBe(false);
  });

  it("win/linux: cmd-tier matches are never refused (byte-identical seam)", () => {
    const bindings = resolved(SHELL_OTHER);
    // Ctrl+K matches the cmd-tier palette binding but must reach xterm's
    // normal path exactly as before n789.
    expect(
      shouldRefuseTerminalChord(chord({ code: "KeyK", ctrlKey: true }), bindings, "other"),
    ).toBe(false);
    expect(
      shouldRefuseTerminalChord(chord({ code: "BracketLeft", ctrlKey: true }), bindings, "other"),
    ).toBe(false);
  });

  it("disabled bindings never trigger refusal (mac-browser ⌘N passes through)", () => {
    const bindings = resolved(BROWSER_MAC);
    expect(
      shouldRefuseTerminalChord(chord({ code: "KeyN", metaKey: true }), bindings, "mac"),
    ).toBe(false);
  });
});
