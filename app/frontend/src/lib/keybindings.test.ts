import { describe, it, expect, afterEach } from "vitest";
import {
  DEFAULT_BINDINGS,
  KEYBINDINGS_STORAGE_KEY,
  applyCapture,
  captureFromEvent,
  claimedKeys,
  comboParts,
  findConflicts,
  findMatch,
  tiersCollide,
  formatCombo,
  keyLabel,
  matchesCombo,
  parseOverrides,
  readStoredOverrides,
  resolveBindings,
  scopesOverlap,
  shouldSuppressChord,
  withShortcutHints,
  writeStoredOverrides,
  type BindingHost,
  type ChordEvent,
  type EffectiveBinding,
  type KeyBinding,
} from "./keybindings";

const SHELL_MAC: BindingHost = { platform: "mac", shell: true };
const SHELL_OTHER: BindingHost = { platform: "other", shell: true };
const BROWSER_OTHER: BindingHost = { platform: "other", shell: false };

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

  it("carries the nine shifted-tier starter actions on their canonical keys", () => {
    const shifted = Object.fromEntries(
      DEFAULT_BINDINGS.filter((b) => b.tier === "shifted").map((b) => [b.actionId, b.code]),
    );
    expect(shifted).toEqual({
      "create-session": "KeyN",
      "create-window": "KeyT",
      "kill-window": "KeyW",
      "window-prev": "KeyH",
      "window-next": "KeyL",
      "go-back": "BracketLeft",
      "go-forward": "BracketRight",
      "agent-next-waiting": "KeyA",
      "shortcuts-overlay": "Slash",
    });
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
    for (const host of [SHELL_MAC, SHELL_OTHER, BROWSER_OTHER]) {
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

describe("findMatch", () => {
  it("returns the enabled binding for a matching chord", () => {
    const match = findMatch(chord({ code: "KeyL", shiftKey: true, ctrlKey: true }), resolved());
    expect(match?.actionId).toBe("window-next");
  });

  it("skips disabled bindings", () => {
    const bindings = resolved(SHELL_OTHER, { "window-next": null });
    expect(findMatch(chord({ code: "KeyL", shiftKey: true, ctrlKey: true }), bindings)).toBeNull();
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
    expect(findMatch(chord({ code: "KeyL", shiftKey: true, ctrlKey: true }), bindings)).toBeNull();
    // The override combo matches the action.
    expect(findMatch(chord({ code: "KeyU", shiftKey: true, ctrlKey: true }), bindings)?.actionId).toBe("window-next");
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
  it("claims the shell digits + R everywhere, I/C/V on win-linux, Q on mac", () => {
    const mac = claimedKeys("mac", true).map((c) => c.code);
    expect(mac).toContain("Digit1");
    expect(mac).toContain("Digit9");
    expect(mac).toContain("KeyR");
    expect(mac).toContain("KeyQ");
    expect(mac).not.toContain("KeyI");
    expect(mac).not.toContain("KeyC");
    const other = claimedKeys("other", true).map((c) => c.code);
    expect(other).toEqual(expect.arrayContaining(["KeyR", "KeyI", "KeyC", "KeyV"]));
    expect(other).not.toContain("KeyQ");
  });

  it("adds browser-owned N/T/W only outside the shell", () => {
    const inShell = claimedKeys("other", true);
    expect(inShell.some((c) => c.owner === "browser")).toBe(false);
    const inBrowser = claimedKeys("other", false);
    expect(inBrowser.filter((c) => c.owner === "browser").map((c) => c.code).sort()).toEqual([
      "KeyN",
      "KeyT",
      "KeyW",
    ]);
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

  it("flags a cmd-tier binding masking a ctrl-tier one on the same code", () => {
    // A Ctrl chord captured on non-mac reads as `cmd`; on the same code it
    // matches the same keydown as the `ctrl`-tier chat-toggle default.
    const bindings = resolveBindings(
      DEFAULT_BINDINGS,
      { "sidebar-toggle": { code: "Backquote", tier: "cmd" } },
      SHELL_OTHER,
    );
    const conflicts = findConflicts(bindings);
    expect(conflicts).toHaveLength(1);
    expect([conflicts[0].a, conflicts[0].b].sort()).toEqual(["chat-toggle", "sidebar-toggle"]);
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
    const { overrides, stolenFrom } = applyCapture(resolved(), {}, "window-next", {
      code: "KeyU",
      tier: "shifted",
    });
    expect(overrides).toEqual({ "window-next": { code: "KeyU", tier: "shifted" } });
    expect(stolenFrom).toBeNull();
  });

  it("steals from the enabled owner and unbinds it (null override)", () => {
    const { overrides, stolenFrom } = applyCapture(resolved(), {}, "window-next", {
      code: "KeyA",
      tier: "shifted",
    });
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
    // of silently masked at dispatch.
    const { overrides, stolenFrom } = applyCapture(resolved(), {}, "sidebar-toggle", {
      code: "Backquote",
      tier: "cmd",
    });
    expect(stolenFrom).toBe("chat-toggle");
    expect(overrides).toEqual({
      "sidebar-toggle": { code: "Backquote", tier: "cmd" },
      "chat-toggle": null,
    });
  });

  it("does not steal across disjoint scopes", () => {
    // view-cycle is terminal-scope; board-cycle-next owns cmd+BracketRight in
    // board scope — capturing it for view-cycle must not unbind the board pair.
    const { stolenFrom } = applyCapture(resolved(), {}, "view-cycle", {
      code: "BracketRight",
      tier: "cmd",
    });
    expect(stolenFrom).toBeNull();
  });

  it("re-capturing the action's own default drops its diff entry", () => {
    const prior = { "window-next": { code: "KeyU", tier: "shifted" as const } };
    const { overrides } = applyCapture(
      resolveBindings(DEFAULT_BINDINGS, prior, SHELL_OTHER),
      prior,
      "window-next",
      { code: "KeyL", tier: "shifted" },
    );
    expect(overrides).toEqual({});
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
    expect(findMatch(chord({ code: "KeyD", shiftKey: true, ctrlKey: true }), bindings)).toBeNull();
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
      findMatch(chord({ code: "KeyD", shiftKey: true, ctrlKey: true }), bindings)?.actionId,
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
      withMacro,
    );
    expect(stealByMacro.stolenFrom).toBe("window-next");
    expect(stealByMacro.overrides).toEqual({
      "window-next": null,
      "macro:discuss": { code: "KeyL", tier: "shifted" },
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
