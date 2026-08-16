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
  hasReclaimableMatch,
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
      "split-horizontal": "Backslash",
      "split-vertical": "Minus",
      "window-prev": "KeyH",
      "window-next": "KeyL",
      "go-back": "BracketLeft",
      "go-forward": "BracketRight",
      "agent-next-waiting": "KeyA",
      "shortcuts-overlay": "Slash",
      "settings-open": "Comma",
      "sidebar-toggle": "KeyB",
      "code-toggle": "KeyJ",
      "focus-hop": "Backquote",
    });
  });

  it("compose-toggle: ⇧⌘E, global, ignoreInputs, no mac demotion (260801-sm6g)", () => {
    const def = DEFAULT_BINDINGS.find((b) => b.actionId === "compose-toggle");
    // Full-row equality: the ⇧⌘E row is a do-not-move constraint.
    expect(def).toEqual({
      actionId: "compose-toggle",
      code: "KeyE",
      tier: "shifted",
      scope: "global",
      kind: "builtin",
      label: "Compose text",
      description: "toggle the compose strip",
      mapLabel: "compose",
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

  it("settings-open: Comma, global, ignoreInputs, shell-only mac ⌘, demotion (260801-mqim)", () => {
    const def = DEFAULT_BINDINGS.find((b) => b.actionId === "settings-open");
    expect(def).toMatchObject({
      code: "Comma",
      tier: "shifted",
      macTier: "cmd",
      macShellOnly: true,
      scope: "global",
      kind: "builtin",
      ignoreInputs: true,
    });
    // ⇧Ctrl+, on win/linux and ⇧⌘, in a mac BROWSER (⌘, is browser
    // Preferences there); the mac SHELL promotes to the OS-conventional ⌘,
    // (the create-session macShellOnly precedent).
    for (const host of [SHELL_OTHER, BROWSER_OTHER, BROWSER_MAC]) {
      expect(byId(resolved(host), "settings-open")).toMatchObject({
        code: "Comma",
        tier: "shifted",
        enabled: true,
      });
    }
    expect(byId(resolved(SHELL_MAC), "settings-open")).toMatchObject({
      code: "Comma",
      tier: "cmd",
      enabled: true,
    });
  });

  it("a mac-browser override onto ⌘, resolves reserved; the mac-shell default stays enabled (260801-mqim)", () => {
    const override = { "settings-open": { code: "Comma", tier: "cmd" as const } };
    // Browser host: ⌘, is the browser's Preferences accelerator — claimed
    // data disables the override rather than advertising a dead chord.
    expect(byId(resolved(BROWSER_MAC, override), "settings-open")).toMatchObject({
      enabled: false,
      disabledReason: "reserved",
    });
    // Shell host: the same combo IS the shipped default — enabled and default.
    expect(byId(resolved(SHELL_MAC), "settings-open")).toMatchObject({
      enabled: true,
      isDefault: true,
    });
  });

  it("migrates the surviving legacy chords with combos unchanged", () => {
    expect(byId(resolved(), "command-palette")).toMatchObject({ code: "KeyK", tier: "cmd" });
    expect(byId(resolved(), "view-cycle")).toMatchObject({ code: "Period", tier: "cmd", scope: "terminal" });
    // 260813-j3jb: the Ctrl+` `layout-zoom` row is removed (it collided with
    // code-server's own Ctrl+`); the zoom ACTION survives via palette + ⛶ verb.
    expect(resolved().find((b) => b.actionId === "layout-zoom")).toBeUndefined();
    expect(resolved().find((b) => b.actionId === "chat-toggle")).toBeUndefined();
    expect(byId(resolved(), "board-cycle-next")).toMatchObject({ code: "BracketRight", tier: "cmd", scope: "board" });
    expect(byId(resolved(), "board-cycle-prev")).toMatchObject({ code: "BracketLeft", tier: "cmd", scope: "board" });
  });

  it("sidebar-toggle: the B keycap — ⌘B on mac in BOTH hosts, ⇧Ctrl+B on Win/Linux", () => {
    const def = DEFAULT_BINDINGS.find((b) => b.actionId === "sidebar-toggle");
    expect(def).toEqual({
      actionId: "sidebar-toggle",
      code: "KeyB",
      tier: "shifted",
      macTier: "cmd",
      scope: "global",
      kind: "builtin",
      label: "Toggle sidebar",
      mapLabel: "sidebar",
    });
    // No macShellOnly: ⌘B is preventDefault-interceptable in a mac browser.
    for (const host of [SHELL_MAC, BROWSER_MAC]) {
      expect(byId(resolved(host), "sidebar-toggle")).toMatchObject({
        code: "KeyB",
        tier: "cmd",
        enabled: true,
        isDefault: true,
      });
      expect(
        findMatches(chord({ code: "KeyB", metaKey: true }), resolved(host)).map((b) => b.actionId),
      ).toEqual(["sidebar-toggle"]);
    }
    for (const host of [SHELL_OTHER, BROWSER_OTHER]) {
      const bindings = resolved(host);
      expect(byId(bindings, "sidebar-toggle")).toMatchObject({
        code: "KeyB",
        tier: "shifted",
        enabled: true,
        isDefault: true,
      });
      expect(
        findMatches(chord({ code: "KeyB", shiftKey: true, ctrlKey: true }), bindings).map(
          (b) => b.actionId,
        ),
      ).toEqual(["sidebar-toggle"]);
      // Plain Ctrl+B matches nothing — readline back-char / nested-tmux
      // prefix stays with the pane.
      expect(findMatches(chord({ code: "KeyB", ctrlKey: true }), bindings)).toEqual([]);
    }
  });

  it("Backslash/cmd is no longer a shipped default in any host (a user override may still bind it)", () => {
    for (const host of ALL_HOSTS) {
      expect(resolved(host).some((b) => b.code === "Backslash" && b.tier === "cmd")).toBe(false);
    }
    const rebound = resolveBindings(
      DEFAULT_BINDINGS,
      { "sidebar-toggle": { code: "Backslash", tier: "cmd" } },
      SHELL_OTHER,
    );
    expect(byId(rebound, "sidebar-toggle")).toMatchObject({
      code: "Backslash",
      tier: "cmd",
      enabled: true,
      isDefault: false,
    });
  });

  it("code-toggle: the J keycap — ⌘J on mac in BOTH hosts, ⇧Ctrl+J on Win/Linux", () => {
    const def = DEFAULT_BINDINGS.find((b) => b.actionId === "code-toggle");
    expect(def).toEqual({
      actionId: "code-toggle",
      code: "KeyJ",
      tier: "shifted",
      macTier: "cmd",
      scope: "terminal",
      kind: "builtin",
      label: "Toggle code editor",
      description: "open/close the code tile",
      mapLabel: "code",
    });
    for (const host of [SHELL_MAC, BROWSER_MAC]) {
      expect(byId(resolved(host), "code-toggle")).toMatchObject({
        code: "KeyJ",
        tier: "cmd",
        enabled: true,
        isDefault: true,
      });
    }
    for (const host of [SHELL_OTHER, BROWSER_OTHER]) {
      expect(byId(resolved(host), "code-toggle")).toMatchObject({
        code: "KeyJ",
        tier: "shifted",
        enabled: true,
        isDefault: true,
      });
      // ⇧Ctrl+J matches ONLY code-toggle (⌘. stayed with view-cycle).
      expect(
        findMatches(chord({ code: "KeyJ", shiftKey: true, ctrlKey: true }), resolved(host)).map(
          (b) => b.actionId,
        ),
      ).toEqual(["code-toggle"]);
    }
  });

  it("focus-hop: Backquote — the first shipped ctrl-tier default (mac ⌃`), ⇧Ctrl+` on Win/Linux", () => {
    const def = DEFAULT_BINDINGS.find((b) => b.actionId === "focus-hop");
    expect(def).toEqual({
      actionId: "focus-hop",
      code: "Backquote",
      tier: "shifted",
      macTier: "ctrl",
      scope: "terminal",
      kind: "builtin",
      label: "Focus terminal ↔ code",
      description: "hop focus between the tty and code tiles",
    });
    // No mapLabel: Backquote has no keycap cell in the overlay grids.
    for (const host of [SHELL_MAC, BROWSER_MAC]) {
      const bindings = resolved(host);
      expect(byId(bindings, "focus-hop")).toMatchObject({
        code: "Backquote",
        tier: "ctrl",
        enabled: true,
        isDefault: true,
      });
      expect(
        findMatches(chord({ code: "Backquote", ctrlKey: true }), bindings).map((b) => b.actionId),
      ).toEqual(["focus-hop"]);
    }
    for (const host of [SHELL_OTHER, BROWSER_OTHER]) {
      const bindings = resolved(host);
      expect(byId(bindings, "focus-hop")).toMatchObject({
        code: "Backquote",
        tier: "shifted",
        enabled: true,
        isDefault: true,
      });
      // Plain Ctrl+` matches NOTHING off mac — the pane owns plain Ctrl there.
      expect(findMatches(chord({ code: "Backquote", ctrlKey: true }), bindings)).toEqual([]);
      expect(
        findMatches(chord({ code: "Backquote", shiftKey: true, ctrlKey: true }), bindings).map(
          (b) => b.actionId,
        ),
      ).toEqual(["focus-hop"]);
    }
  });

  it("reserves KeyP unbound on every tier and host (a future PR action's keycap)", () => {
    expect(DEFAULT_BINDINGS.some((b) => b.code === "KeyP" || b.macCode === "KeyP")).toBe(false);
    for (const host of ALL_HOSTS) {
      expect(resolved(host).some((b) => b.code === "KeyP")).toBe(false);
    }
  });

  it("ships layout-cycle on ⌘; (260812-ab5v R9/R11) — the ▦ chip's same-arity shape cycle", () => {
    expect(byId(resolved(), "layout-cycle")).toMatchObject({
      code: "Semicolon",
      tier: "cmd",
      scope: "terminal",
      enabled: true,
    });
    // A ⌘; keydown matches ONLY layout-cycle (Semicolon is free in every
    // claimed set; the ⌘<punctuation> siblings live on other codes).
    const cmdSemicolon = chord({ code: "Semicolon", metaKey: true });
    expect(findMatches(cmdSemicolon, resolved()).map((b) => b.actionId)).toEqual(["layout-cycle"]);
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

  it("claims nothing on KeyB / KeyJ / Backquote in any tier or host (the VS Code-aligned keycaps stay free)", () => {
    for (const platform of ["mac", "other"] as const) {
      for (const shell of [true, false]) {
        const claimed = claimedKeys(platform, shell).map((c) => c.code);
        for (const code of ["KeyB", "KeyJ", "Backquote"]) {
          expect(claimed).not.toContain(code);
        }
      }
    }
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
    // focus-hop ships the registry's one ctrl-tier default (mac ⌃`): a
    // view-cycle override onto ⌘` collides with it — a plain Ctrl chord
    // matches both tiers, and both are terminal-scoped: a real conflict, not
    // a shadow.
    const bindings = resolveBindings(
      DEFAULT_BINDINGS,
      { "view-cycle": { code: "Backquote", tier: "cmd" } },
      SHELL_MAC,
    );
    const conflicts = findConflicts(bindings);
    expect(conflicts).toHaveLength(1);
    expect([conflicts[0].a, conflicts[0].b].sort()).toEqual(["focus-hop", "view-cycle"]);
  });

  it("treats a same-combo global↔scoped pair as a shadow, not a conflict (260730-n789)", () => {
    // sidebar-toggle (global) overridden onto the colliding ⌘` combo against
    // focus-hop's mac ⌃` (terminal): scopes differ with one global → dispatch
    // precedence resolves it, no conflict.
    const bindings = resolveBindings(
      DEFAULT_BINDINGS,
      { "sidebar-toggle": { code: "Backquote", tier: "cmd" } },
      SHELL_MAC,
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
    // sidebar-toggle (global) captures ⌘` on a mac host — the chord matches
    // the same keydown as focus-hop's shipped ctrl-tier ⌃` (terminal scope),
    // so that row must be flagged and unbound instead of silently masked at
    // dispatch.
    const { overrides, stolenFrom } = applyCapture(
      resolved(SHELL_MAC),
      {},
      "sidebar-toggle",
      { code: "Backquote", tier: "cmd" },
      SHELL_MAC,
    );
    expect(stolenFrom).toBe("focus-hop");
    expect(overrides).toEqual({
      "sidebar-toggle": { code: "Backquote", tier: "cmd" },
      "focus-hop": null,
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

  it("mac: plain-Ctrl chords matching no ctrl-tier binding pass through (Ctrl+[ is ESC)", () => {
    const bindings = resolved(SHELL_MAC);
    expect(
      shouldRefuseTerminalChord(chord({ code: "BracketLeft", ctrlKey: true }), bindings, "mac"),
    ).toBe(false);
    // Unbound ⌘ keys pass through too (no enabled match).
    expect(
      shouldRefuseTerminalChord(chord({ code: "KeyF", metaKey: true }), bindings, "mac"),
    ).toBe(false);
  });

  it("mac rule 3: an enabled ctrl-tier match pressed with ctrlKey is refused (⌃` focus hop)", () => {
    const bindings = resolved(SHELL_MAC);
    expect(
      shouldRefuseTerminalChord(chord({ code: "Backquote", ctrlKey: true }), bindings, "mac"),
    ).toBe(true);
    // The metaKey exclusion: a ⌘+Ctrl combined press must not double-match
    // (it matches no ctrl-tier combo anyway — matchesCombo requires !metaKey).
    expect(
      shouldRefuseTerminalChord(
        chord({ code: "Backquote", ctrlKey: true, metaKey: true }),
        bindings,
        "mac",
      ),
    ).toBe(false);
    // A user-disabled ctrl-tier binding restores passthrough (⌃` → NUL
    // reaches the pane again).
    const disabled = resolved(SHELL_MAC, { "focus-hop": null });
    expect(
      shouldRefuseTerminalChord(chord({ code: "Backquote", ctrlKey: true }), disabled, "mac"),
    ).toBe(false);
  });

  it("win/linux: no ctrl-tier default resolves there — plain Ctrl+` stays the pane's (byte-identical seam)", () => {
    const bindings = resolved(SHELL_OTHER);
    // ⇧Ctrl+` IS refused (rule 1 — focus-hop's base tier is shifted); plain
    // Ctrl+` matches nothing and reaches the pane unchanged.
    expect(
      shouldRefuseTerminalChord(
        chord({ code: "Backquote", shiftKey: true, ctrlKey: true }),
        bindings,
        "other",
      ),
    ).toBe(true);
    expect(
      shouldRefuseTerminalChord(chord({ code: "Backquote", ctrlKey: true }), bindings, "other"),
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

  it("split chords: ⇧Ctrl+\\/⇧Ctrl+- and mac ⌘D/⇧⌘D refuse; plain Ctrl+D stays the pane's EOF (260807-rbx5)", () => {
    const other = resolved(SHELL_OTHER);
    expect(
      shouldRefuseTerminalChord(chord({ code: "Backslash", shiftKey: true, ctrlKey: true }), other, "other"),
    ).toBe(true);
    expect(
      shouldRefuseTerminalChord(chord({ code: "Minus", shiftKey: true, ctrlKey: true }), other, "other"),
    ).toBe(true);
    // Win/Linux Ctrl+D — plain or shifted — matches nothing: the D codes live
    // only behind the mac `macCode` refinement, and EOF belongs to the pane.
    expect(shouldRefuseTerminalChord(chord({ code: "KeyD", ctrlKey: true }), other, "other")).toBe(false);
    expect(
      shouldRefuseTerminalChord(chord({ code: "KeyD", shiftKey: true, ctrlKey: true }), other, "other"),
    ).toBe(false);

    const mac = resolved(SHELL_MAC);
    expect(shouldRefuseTerminalChord(chord({ code: "KeyD", metaKey: true }), mac, "mac")).toBe(true);
    expect(
      shouldRefuseTerminalChord(chord({ code: "KeyD", metaKey: true, shiftKey: true }), mac, "mac"),
    ).toBe(true);
    // Mac Ctrl+D matches the cmd tier but carries no metaKey → the pane keeps it.
    expect(shouldRefuseTerminalChord(chord({ code: "KeyD", ctrlKey: true }), mac, "mac")).toBe(false);
  });
});

describe("split chords + the macCode refinement — 260807-rbx5", () => {
  const splitH = DEFAULT_BINDINGS.find((b) => b.actionId === "split-horizontal");
  const splitV = DEFAULT_BINDINGS.find((b) => b.actionId === "split-vertical");

  it("ships divider-mnemonic base codes with a KeyD mac refinement, terminal scope", () => {
    expect(splitH).toMatchObject({
      code: "Backslash",
      tier: "shifted",
      macCode: "KeyD",
      macTier: "cmd",
      scope: "terminal",
      kind: "builtin",
      label: "Split horizontal",
      mapLabel: "split h",
    });
    // Refines in BOTH mac hosts (⌘D is page-interceptable) — no shell gate.
    expect(splitH?.macShellOnly).toBeUndefined();

    expect(splitV).toMatchObject({
      code: "Minus",
      tier: "shifted",
      macCode: "KeyD",
      scope: "terminal",
      kind: "builtin",
      label: "Split vertical",
      mapLabel: "split v",
    });
    // Vertical keeps the shifted tier on mac (⇧⌘D) — code refines, tier stays.
    expect(splitV?.macTier).toBeUndefined();
    expect(splitV?.macShellOnly).toBeUndefined();
  });

  it("mac hosts resolve ⌘D horizontal and ⇧⌘D vertical (shell and browser alike)", () => {
    for (const host of [SHELL_MAC, BROWSER_MAC]) {
      expect(byId(resolved(host), "split-horizontal")).toMatchObject({
        code: "KeyD",
        tier: "cmd",
        enabled: true,
        isDefault: true,
      });
      expect(byId(resolved(host), "split-vertical")).toMatchObject({
        code: "KeyD",
        tier: "shifted",
        enabled: true,
        isDefault: true,
      });
    }
  });

  it("win/linux hosts resolve ⇧Ctrl+\\ horizontal and ⇧Ctrl+- vertical — both bound", () => {
    for (const host of [SHELL_OTHER, BROWSER_OTHER]) {
      expect(byId(resolved(host), "split-horizontal")).toMatchObject({
        code: "Backslash",
        tier: "shifted",
        enabled: true,
        isDefault: true,
      });
      expect(byId(resolved(host), "split-vertical")).toMatchObject({
        code: "Minus",
        tier: "shifted",
        enabled: true,
        isDefault: true,
      });
    }
  });

  it("dispatch: mac ⌘D/⇧⌘D resolve the pair; win/linux dispatches on the divider codes", () => {
    const mac = resolved(SHELL_MAC);
    expect(findMatches(chord({ code: "KeyD", metaKey: true }), mac).map((b) => b.actionId)).toEqual([
      "split-horizontal",
    ]);
    expect(
      findMatches(chord({ code: "KeyD", metaKey: true, shiftKey: true }), mac).map((b) => b.actionId),
    ).toEqual(["split-vertical"]);

    const other = resolved(SHELL_OTHER);
    expect(
      findMatches(chord({ code: "Backslash", shiftKey: true, ctrlKey: true }), other).map((b) => b.actionId),
    ).toEqual(["split-horizontal"]);
    expect(
      findMatches(chord({ code: "Minus", shiftKey: true, ctrlKey: true }), other).map((b) => b.actionId),
    ).toEqual(["split-vertical"]);
    // No D chord matches anything on win/linux — EOF belongs to the pane.
    expect(findMatches(chord({ code: "KeyD", ctrlKey: true }), other)).toEqual([]);
    expect(findMatches(chord({ code: "KeyD", shiftKey: true, ctrlKey: true }), other)).toEqual([]);
  });

  it("defaultComboFor swaps the code (and tier where set) on mac only", () => {
    if (!splitH || !splitV) throw new Error("missing split defaults");
    expect(defaultComboFor(splitH, SHELL_MAC)).toEqual({ code: "KeyD", tier: "cmd" });
    expect(defaultComboFor(splitH, BROWSER_MAC)).toEqual({ code: "KeyD", tier: "cmd" });
    expect(defaultComboFor(splitH, SHELL_OTHER)).toEqual({ code: "Backslash", tier: "shifted" });
    expect(defaultComboFor(splitV, SHELL_MAC)).toEqual({ code: "KeyD", tier: "shifted" });
    expect(defaultComboFor(splitV, BROWSER_MAC)).toEqual({ code: "KeyD", tier: "shifted" });
    expect(defaultComboFor(splitV, BROWSER_OTHER)).toEqual({ code: "Minus", tier: "shifted" });
  });

  it("the refinement is inert for every binding that sets no macCode", () => {
    for (const host of ALL_HOSTS) {
      for (const def of DEFAULT_BINDINGS.filter((d) => d.macCode == null)) {
        expect(defaultComboFor(def, host).code).toBe(def.code);
      }
    }
  });

  it("re-capturing a macCode binding's own mac default is a no-op that steals from nobody", () => {
    // ⇧⌘D on a mac host IS split-vertical's host default — applyCapture must
    // drop the diff entry (diffs-only store) and leave the ⌘D partner alone.
    const { overrides, stolenFrom } = applyCapture(
      resolved(SHELL_MAC),
      { "split-vertical": { code: "KeyY", tier: "shifted" } },
      "split-vertical",
      { code: "KeyD", tier: "shifted" },
      SHELL_MAC,
    );
    expect(stolenFrom).toBeNull();
    expect(overrides).toEqual({});
  });

  it("an override rebinds either split verbatim on any host", () => {
    const bindings = resolveBindings(
      DEFAULT_BINDINGS,
      { "split-vertical": { code: "KeyY", tier: "shifted" } },
      SHELL_OTHER,
    );
    expect(byId(bindings, "split-vertical")).toMatchObject({
      code: "KeyY",
      tier: "shifted",
      enabled: true,
      isDefault: false,
    });
    expect(
      findMatches(chord({ code: "KeyY", shiftKey: true, ctrlKey: true }), bindings)[0]?.actionId,
    ).toBe("split-vertical");
  });

  it("keeps the shipped defaults conflict-free in every host (the mac D pair is tier-disjoint)", () => {
    for (const host of ALL_HOSTS) {
      expect(findConflicts(resolved(host))).toEqual([]);
    }
    // Why the mac pair is legal on one code in one scope: the tiers are disjoint.
    expect(tiersCollide("cmd", "shifted")).toBe(false);
  });

  it("palette hints render the host pair: ⌘D/⇧⌘D on mac, Shift+Ctrl+\\ and Shift+Ctrl+- elsewhere", () => {
    const actions = [
      { id: "split-horizontal", label: "Window: Split Horizontal" },
      { id: "split-vertical", label: "Window: Split Vertical" },
    ];
    const other = withShortcutHints(
      actions,
      new Map(resolved(BROWSER_OTHER).map((b) => [b.actionId, b])),
      "other",
    );
    expect(other[0].shortcut).toBe("Shift+Ctrl+\\");
    expect(other[1].shortcut).toBe("Shift+Ctrl+-");

    const mac = withShortcutHints(
      actions,
      new Map(resolved(BROWSER_MAC).map((b) => [b.actionId, b])),
      "mac",
    );
    expect(mac[0].shortcut).toBe("⌘D");
    expect(mac[1].shortcut).toBe("⇧⌘D");
  });
});

describe("ttyOnly registry flag — 260812-wfic (R7)", () => {
  it("exactly the split pair carries ttyOnly; no other row does", () => {
    const flagged = DEFAULT_BINDINGS.filter((b) => b.ttyOnly).map((b) => b.actionId);
    expect(flagged).toEqual(["split-horizontal", "split-vertical"]);
  });

  it("survives resolution onto the effective map in every host", () => {
    for (const host of ALL_HOSTS) {
      const bindings = resolved(host);
      expect(byId(bindings, "split-horizontal").ttyOnly).toBe(true);
      expect(byId(bindings, "split-vertical").ttyOnly).toBe(true);
      expect(byId(bindings, "command-palette").ttyOnly).toBeUndefined();
    }
  });
});

describe("hasReclaimableMatch — the code-iframe reclaim carve-out (260812-wfic R9)", () => {
  it("a chord whose only matches are ttyOnly is NOT reclaimed (⌘D / ⇧Ctrl+\\)", () => {
    // mac ⌘D (split-horizontal's mac refinement) and the win/linux divider
    // chord both match ONLY ttyOnly bindings — code-server keeps them.
    expect(hasReclaimableMatch(chord({ code: "KeyD", metaKey: true }), resolved(SHELL_MAC))).toBe(false);
    expect(
      hasReclaimableMatch(chord({ code: "Backslash", shiftKey: true, ctrlKey: true }), resolved(SHELL_OTHER)),
    ).toBe(false);
  });

  it("non-ttyOnly registry chords are still reclaimed (⌘K, ⌘.)", () => {
    const bindings = resolved(SHELL_MAC);
    expect(hasReclaimableMatch(chord({ code: "KeyK", metaKey: true }), bindings)).toBe(true);
    expect(hasReclaimableMatch(chord({ code: "Period", metaKey: true }), bindings)).toBe(true);
  });

  it("the code toggle and focus hop reclaim from inside the code iframe (toggle symmetry / ⌃` preemption)", () => {
    // ⌘J (code-toggle's mac default) and ⌃` (focus-hop's ctrl tier) match
    // non-ttyOnly bindings, so a keydown inside the code-server iframe
    // re-dispatches to the parent — preempting code-server's own ⌃`
    // integrated-terminal toggle. ⇧Ctrl+J reclaims off mac the same way.
    const mac = resolved(SHELL_MAC);
    expect(hasReclaimableMatch(chord({ code: "KeyJ", metaKey: true }), mac)).toBe(true);
    expect(hasReclaimableMatch(chord({ code: "Backquote", ctrlKey: true }), mac)).toBe(true);
    expect(
      hasReclaimableMatch(
        chord({ code: "KeyJ", shiftKey: true, ctrlKey: true }),
        resolved(SHELL_OTHER),
      ),
    ).toBe(true);
  });

  it("no match at all → false (the embedded app's own chords pass through)", () => {
    expect(hasReclaimableMatch(chord({ code: "KeyQ" }), resolved(SHELL_OTHER))).toBe(false);
  });

  it("a chord matching BOTH a ttyOnly and a non-ttyOnly binding IS reclaimed (.some semantics, A-016)", () => {
    // No such default pair ships today; construct it to pin the semantics: a
    // shared chord keeps its global meaning, so the reclaim must fire.
    const shared: KeyBinding = {
      actionId: "test-global",
      code: "Backslash",
      tier: "shifted",
      scope: "global",
      kind: "builtin",
      label: "test",
    };
    const bindings = resolveBindings([...DEFAULT_BINDINGS, shared], {}, SHELL_OTHER);
    expect(
      hasReclaimableMatch(chord({ code: "Backslash", shiftKey: true, ctrlKey: true }), bindings),
    ).toBe(true);
  });
});
