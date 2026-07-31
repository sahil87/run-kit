import { useEffect, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useKeybindings } from "@/hooks/use-keybindings";
import { useMacros } from "@/hooks/use-macros";
import {
  captureFromEvent,
  claimedKeys,
  comboParts,
  formatCombo,
  keyLabel,
  type BindingPlatform,
  type BindingScope,
  type BindingTier,
  type EffectiveBinding,
} from "@/lib/keybindings";
import {
  isMacroActionId,
  macroCommandPreview,
  type MacroAction,
  type MacroTarget,
} from "@/lib/macros";

/**
 * The keyboard-shortcuts cheatsheet overlay (260730-g40a) — a focus-trapped
 * dialog (Constitution IV: NOT a route; the route set is fixed), opened by
 * the per-platform shortcuts chord (⌘/ on macOS, ⇧Ctrl+/ on Win/Linux —
 * 260730-n789) and the `Help: Keyboard Shortcuts` palette action, mounted on
 * both AppShell and BoardPage.
 *
 * Per the reviewed design mock (`design-mock.html` in the change folder):
 * two tier-map keyboard visualizations (the shifted run-kit tier everywhere,
 * plus the mac ⌘ page tier on the macOS display; bound / custom / claimed /
 * free per key), a platform display toggle (macOS ↔ Win·Linux keycap rendering,
 * initialized from the detected platform), a filter input, grouped rows with
 * scope badges, click-to-rebind capture (Esc cancels) with steal warning,
 * modified-dot + per-row reset + unbound flag, shell-owned rows shown locked
 * (the shell menu owns their accelerators), and a footer with the storage
 * note + reset-all. Export/import is deferred.
 *
 * CUSTOM section (260730-hbyh): editable macro rows — label, resolved-command
 * preview chip, the same click-to-rebind capture as builtins (macros ride the
 * shared effective map), a delete affordance, and a `missing preset` error
 * badge when a riff macro's preset is absent from the fetched preset list.
 * The `+ bind a key…` add flow offers riff presets + the mount's palette
 * actions as targets (via the `paletteTargets`/`riffPresetNames` props —
 * mounts that pass none render the rows without the add flow).
 */

const KEY_ROWS: string[][] = [
  ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO", "KeyP", "BracketLeft", "BracketRight"],
  ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL", "Semicolon", "Slash"],
  ["KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM", "Digit1", "Digit2", "…", "Digit9", "Digit0"],
];

const GROUPS: { name: string; scope: BindingScope }[] = [
  { name: "GLOBAL", scope: "global" },
  { name: "TERMINAL", scope: "terminal" },
  { name: "BOARD", scope: "board" },
];

/** A keycap sequence (`<kbd>` run) — the combo rendering unit. */
function Keycaps({ parts }: { parts: string[] }) {
  return (
    <>
      {parts.map((part, i) => (
        <kbd
          key={i}
          className="inline-block min-w-[24px] px-1.5 py-0.5 text-center text-[11px] bg-bg-inset border border-border border-b-2 rounded text-text-primary"
        >
          {part}
        </kbd>
      ))}
    </>
  );
}

/** Scope badge for non-global rows (mock: pill with per-scope color). */
function ScopeBadge({ scope }: { scope: BindingScope }) {
  if (scope === "global" || scope === "sidebar") return null;
  const cls =
    scope === "terminal"
      ? "border-accent-green/50 text-accent-green"
      : "border-accent/60 text-accent-bright";
  return (
    <span className={`flex-none text-[9.5px] tracking-wider uppercase px-2 py-px rounded-full border ${cls}`}>
      {scope}
    </span>
  );
}

/** A palette action offered as a macro target in the add flow. */
export type MacroPaletteTarget = { id: string; label: string };

export function ShortcutsOverlay({
  open,
  onClose,
  paletteTargets,
  riffPresetNames,
}: {
  open: boolean;
  onClose: () => void;
  /** Palette actions offered as macro targets. Absent = no add flow here. */
  paletteTargets?: readonly MacroPaletteTarget[];
  /** Known riff preset names (best-effort fetch while open); null/undefined =
   *  unknown (no missing-preset badges, no riff targets in the add flow). */
  riffPresetNames?: readonly string[] | null;
}) {
  const { bindings, byAction, overrides, host, setBinding, resetBinding, resetAll } =
    useKeybindings();
  const { macros, addMacro, removeMacro } = useMacros();
  const sheetRef = useRef<HTMLDivElement>(null);
  useFocusTrap(sheetRef, open, onClose);

  // Display platform for keycap rendering — a VIEW toggle only (capture always
  // reads the physical host platform). Initialized from the detected host.
  const [displayPlatform, setDisplayPlatform] = useState<BindingPlatform>(host.platform);
  const [query, setQuery] = useState("");
  const [capturingId, setCapturingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ actionId: string; text: string } | null>(null);
  // Add-macro flow state (260730-hbyh).
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [addTarget, setAddTarget] = useState<{ label: string; target: MacroTarget } | null>(null);
  const [addName, setAddName] = useState("");

  // Reset transient state whenever the overlay closes.
  useEffect(() => {
    if (open) return;
    setQuery("");
    setCapturingId(null);
    setNotice(null);
    setAddOpen(false);
    setAddQuery("");
    setAddTarget(null);
    setAddName("");
  }, [open]);

  // Rebind capture: a capture-phase window listener while a combo is armed.
  // stopPropagation keeps the chord away from the focus trap, the global
  // dispatcher, and the legacy listeners; Esc cancels the capture only.
  useEffect(() => {
    if (!capturingId) return;
    const actionId = capturingId;
    function onCaptureKey(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setCapturingId(null);
        return;
      }
      const combo = captureFromEvent(e, host.platform);
      if (!combo) return; // modifier-only / tier-less press — keep capturing
      const self = byAction.get(actionId);
      const stolenFrom = setBinding(actionId, combo);
      // Tier-aware claim match (260730-n789): the mac ⌘ tier carries its own
      // claimed set (shell menu accelerators / browser-reserved keys).
      const claimed = claimedKeys(host.platform, host.shell).find(
        (c) => c.tier === combo.tier && c.code === combo.code,
      );
      if (stolenFrom) {
        const victim = byAction.get(stolenFrom);
        setNotice({
          actionId,
          text: `⚠ took ${formatCombo(combo, host.platform)} from “${victim?.label ?? stolenFrom}” — it is now unbound (rebind or reset it)`,
        });
      } else if (claimed) {
        setNotice({
          actionId,
          text: `⚠ ${formatCombo(combo, host.platform)} is claimed by ${claimed.owner} (${claimed.label}) — it may never reach ${self?.label ?? "this action"}`,
        });
      } else {
        setNotice(null);
      }
      setCapturingId(null);
    }
    window.addEventListener("keydown", onCaptureKey, { capture: true });
    return () => window.removeEventListener("keydown", onCaptureKey, { capture: true });
  }, [capturingId, host, byAction, setBinding]);

  // Per-tier map key states: keycaps/claims follow the DISPLAY platform, the
  // bound/custom states come from the HOST-effective map (the toggle is a
  // rendering toggle — effective bindings are always the current host's).
  // Claimed wins over bound/custom (a browser-reserved N shows claimed, not
  // bound).
  const tierKeyStates = (tier: BindingTier) => {
    const states = new Map<string, { cls: "bound" | "custom" | "claimed"; label: string }>();
    for (const b of bindings) {
      if (b.tier !== tier || !b.enabled) continue;
      states.set(b.code, { cls: b.isDefault ? "bound" : "custom", label: b.mapLabel ?? b.label });
    }
    for (const claim of claimedKeys(displayPlatform, host.shell)) {
      if (claim.tier !== tier) continue;
      states.set(claim.code, { cls: "claimed", label: claim.label });
    }
    return states;
  };
  const keyStates = useMemo(
    () => tierKeyStates("shifted"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bindings, displayPlatform, host.shell],
  );
  // The mac ⌘ page tier (260730-n789) — rendered only on the macOS display
  // (the win/linux "cmd" tier is plain Ctrl, which belongs to the pane).
  const cmdKeyStates = useMemo(
    () => (displayPlatform === "mac" ? tierKeyStates("cmd") : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bindings, displayPlatform, host.shell],
  );

  const hasOverride = (actionId: string) =>
    Object.prototype.hasOwnProperty.call(overrides, actionId);

  const matchesQuery = (b: EffectiveBinding) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      b.label.toLowerCase().includes(q) || (b.description ?? "").toLowerCase().includes(q)
    );
  };

  // Shell-owned locked rows (accelerators live in the desktop shell's menu —
  // the registry only documents them). DevTools is a win/linux accelerator.
  // The switcher diverges from the shared shifted-tier caps on the mac
  // display (260731-nv5r): the mac shell tier is ⌥⌘ (⇧⌘3/4/5 are macOS
  // screenshot shortcuts), while win/linux keeps ⇧Ctrl+1–9. Locked rows are
  // free-form caps arrays, so no tier machinery is involved.
  const shellRows = useMemo(() => {
    const tierCaps = (key: string) =>
      displayPlatform === "mac" ? ["⇧", "⌘", key] : ["Shift", "Ctrl", key];
    const switcherCaps =
      displayPlatform === "mac" ? ["⌥", "⌘", "1…9"] : ["Shift", "Ctrl", "1…9"];
    const rows = [
      { label: "Switch to server 1–9", description: "owned by the shell menu", parts: switcherCaps },
      { label: "Force reload", description: undefined, parts: tierCaps("R") },
    ];
    if (displayPlatform !== "mac") {
      rows.push({ label: "DevTools", description: undefined, parts: tierCaps("I") });
    }
    return rows.filter((r) => {
      const q = query.trim().toLowerCase();
      return !q || r.label.toLowerCase().includes(q);
    });
  }, [displayPlatform, query]);

  // Add-flow target candidates: riff presets (when known) + the mount's
  // palette actions, macros excluded (no macro→macro chains).
  const macroTargetOptions = useMemo(() => {
    const options: { key: string; label: string; target: MacroTarget }[] = [];
    for (const preset of riffPresetNames ?? []) {
      options.push({
        key: `riff:${preset}`,
        label: `riff: ${preset}`,
        target: { type: "riff", preset },
      });
    }
    for (const action of paletteTargets ?? []) {
      if (isMacroActionId(action.id)) continue;
      options.push({
        key: `palette:${action.id}`,
        label: `palette: ${action.label}`,
        target: { type: "palette", paletteActionId: action.id },
      });
    }
    return options;
  }, [riffPresetNames, paletteTargets]);

  const canAddMacro = paletteTargets != null;

  const visibleMacros = macros.filter((m) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      m.label.toLowerCase().includes(q) ||
      macroCommandPreview(m.target).toLowerCase().includes(q)
    );
  });

  const handleAddMacro = () => {
    if (!addTarget || !addName.trim()) return;
    const actionId = addMacro(addName.trim(), addTarget.target);
    setAddOpen(false);
    setAddQuery("");
    setAddTarget(null);
    setAddName("");
    setNotice(null);
    // Arm capture on the fresh row — "name it, capture a key" in one flow.
    setCapturingId(actionId);
  };

  const handleDeleteMacro = (macro: MacroAction) => {
    removeMacro(macro.actionId); // also drops its runkit-keybindings diff
    if (capturingId === macro.actionId) setCapturingId(null);
    if (notice?.actionId === macro.actionId) setNotice(null);
  };

  if (!open) return null;

  const tierName = displayPlatform === "mac" ? "⇧ ⌘" : "Shift Ctrl";
  // The header hint advertises the HOST-effective overlay chord (260730-n789):
  // the toggle demotes to ⌘/ on mac hosts and user overrides move it, so the
  // effective map is the only accurate source. Formatted for the physical host
  // (the display toggle restyles keycaps; it never changes what THIS host must
  // press). Hidden when the binding is unbound/disabled — a hint advertising a
  // dead chord would lie.
  const sheetBinding = byAction.get("shortcuts-overlay");
  const sheetChord = sheetBinding?.enabled
    ? formatCombo({ code: sheetBinding.code, tier: sheetBinding.tier }, host.platform)
    : null;

  const keyCell = (
    states: Map<string, { cls: "bound" | "custom" | "claimed"; label: string }>,
    code: string,
    idx: number,
  ) => {
    if (code === "…") {
      // Decorative digit-run ellipsis cell (stands for Digit3–Digit8) — keyed
      // off Digit3 so mid-run claims render (260731-nv5r): the switcher
      // digits on the win/linux display, the ⇧⌘3/4/5 screenshot claims on the
      // mac shifted map (where Digit1/2/9's own cells are unclaimed).
      const digitClaim = states.get("Digit3");
      return (
        <div
          key={`ellipsis-${idx}`}
          className={`w-9 h-9 sm:w-11 sm:h-10 rounded border flex flex-col items-center justify-center text-xs ${digitClaim?.cls === "claimed" ? "opacity-55 border-border bg-bg-inset text-amber-600" : "border-border bg-bg-inset text-text-secondary"}`}
          aria-hidden="true"
        >
          …
        </div>
      );
    }
    const state = states.get(code);
    const base =
      "w-9 h-9 sm:w-11 sm:h-10 rounded border flex flex-col items-center justify-center text-xs transition-colors";
    const cls =
      state?.cls === "bound"
        ? "border-accent-green/60 bg-accent-green/10 text-text-primary"
        : state?.cls === "custom"
          ? "border-accent/70 bg-accent/10 text-text-primary"
          : state?.cls === "claimed"
            ? "opacity-55 border-border bg-bg-inset text-text-secondary"
            : "border-border bg-bg-inset text-text-secondary";
    const small =
      state?.cls === "bound"
        ? "text-accent-green"
        : state?.cls === "custom"
          ? "text-accent-bright"
          : "text-amber-600";
    return (
      <div key={code} className={`${base} ${cls}`} title={state ? state.label : "free"}>
        {keyLabel(code)}
        {state && (
          <small className={`hidden sm:block text-[7.5px] leading-tight text-center px-0.5 ${small}`}>
            {state.label}
          </small>
        )}
      </div>
    );
  };

  return (
    <div
      data-testid="shortcuts-overlay"
      className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[6vh]"
      onClick={onClose}
    >
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" />

      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="relative w-full max-w-3xl bg-bg-card border border-border rounded-lg shadow-2xl max-h-[calc(100vh-8vh-2rem)] overflow-y-auto text-[13px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── header ─────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-wrap">
          <h2 className="font-bold whitespace-nowrap text-text-primary">
            <span className="text-text-secondary select-none" aria-hidden="true">[ </span>
            <span className="text-text-secondary font-normal">Shortcuts:</span> keyboard
            <span className="text-text-secondary select-none" aria-hidden="true"> ]</span>
          </h2>
          <div className="flex flex-none border border-border rounded overflow-hidden" role="group" aria-label="Keycap platform">
            {(["mac", "other"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setDisplayPlatform(p)}
                className={`text-[11px] px-2.5 py-1 ${displayPlatform === p ? "bg-accent/20 text-text-primary" : "text-text-secondary hover:text-accent-green"}`}
              >
                {p === "mac" ? "macOS" : "Win · Linux"}
              </button>
            ))}
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="filter actions…"
            aria-label="Filter shortcuts"
            className="flex-1 min-w-[120px] text-xs bg-bg-inset border border-border rounded px-2.5 py-1 outline-none text-text-primary placeholder:text-text-secondary focus:border-accent"
          />
          {sheetChord && (
            <span className="hidden md:inline text-[11px] text-text-secondary whitespace-nowrap">
              {sheetChord} toggles this sheet
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-text-secondary hover:text-text-primary px-1.5"
          >
            ✕
          </button>
        </div>

        {/* ── shifted-tier map ───────────────────────────── */}
        <div className="px-4 pt-4 pb-2">
          <div className="flex justify-between flex-wrap gap-1.5 text-[11px] text-text-secondary mb-2.5">
            <span>
              run-kit tier — <b className="text-text-primary">{tierName}</b> + key
            </span>
            <span>plain Ctrl always reaches the pane</span>
          </div>
          <div className="flex flex-col items-center gap-1.5" aria-hidden="true">
            {KEY_ROWS.map((row, i) => (
              <div key={i} className="flex gap-1.5">
                {row.map((code, j) => keyCell(keyStates, code, j))}
              </div>
            ))}
          </div>
          {/* macOS page tier (260730-n789): the unshifted ⌘ tier the desktop
              shell frees — demoted defaults (⌘[/⌘]/⌘/ everywhere, ⌘N/T/W in
              the shell), the legacy ⌘ chords, and the per-host claimed set
              (shell menu accelerators inside the shell, browser-reserved keys
              outside). Not rendered for the Win·Linux display — plain Ctrl
              there belongs to the pane. */}
          {cmdKeyStates && (
            <>
              <div className="flex justify-between flex-wrap gap-1.5 text-[11px] text-text-secondary mt-4 mb-2.5">
                <span>
                  page tier — <b className="text-text-primary">⌘</b> + key
                </span>
                <span>
                  {host.shell
                    ? "freed by the desktop shell"
                    : "browser keys stay claimed — the desktop shell frees them"}
                </span>
              </div>
              <div className="flex flex-col items-center gap-1.5" aria-hidden="true">
                {KEY_ROWS.map((row, i) => (
                  <div key={`cmd-${i}`} className="flex gap-1.5">
                    {row.map((code, j) => keyCell(cmdKeyStates, code, j))}
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="flex flex-wrap gap-4 mt-3 text-[10.5px] text-text-secondary">
            <span><i className="inline-block w-2 h-2 mr-1 rounded-sm border border-accent-green bg-accent-green/25" />bound</span>
            <span><i className="inline-block w-2 h-2 mr-1 rounded-sm border border-accent bg-accent/25" />custom</span>
            <span><i className="inline-block w-2 h-2 mr-1 rounded-sm border border-amber-600/60 bg-amber-600/20" />claimed (shell · system · browser)</span>
            <span><i className="inline-block w-2 h-2 mr-1 rounded-sm border border-border" />free</span>
          </div>
        </div>

        {/* ── grouped rows ───────────────────────────────── */}
        <div className="px-4 pb-4">
          {GROUPS.map((group) => {
            // Macros render in their own CUSTOM section below, not here.
            const rows = bindings.filter(
              (b) => b.kind !== "macro" && b.scope === group.scope && matchesQuery(b),
            );
            if (rows.length === 0) return null;
            return (
              <section key={group.name} className="mt-4">
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="text-[11.5px] font-bold tracking-wider text-text-secondary select-none">
                    <span aria-hidden="true">[ </span>
                    <span className="text-text-primary">{group.name}</span>
                    <span aria-hidden="true"> ]</span>
                  </h3>
                  <span className="flex-1 border-t border-border" aria-hidden="true" />
                </div>
                {rows.map((b) => {
                  const modified = hasOverride(b.actionId);
                  const combo = { code: b.code, tier: b.tier };
                  return (
                    <div key={b.actionId} data-actionid={b.actionId}>
                      <div className="group flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-bg-inset/70">
                        <span
                          className={`w-1.5 h-1.5 rounded-full flex-none ${modified ? "bg-accent" : "bg-transparent"}`}
                          title={modified ? "modified from default" : undefined}
                        />
                        <span className="flex-1 min-w-0 truncate">
                          {b.label}
                          {b.description && (
                            <span className="text-[11px] text-text-secondary"> — {b.description}</span>
                          )}
                        </span>
                        <ScopeBadge scope={b.scope} />
                        {b.disabledReason === "user" ? (
                          <button
                            type="button"
                            onClick={() => setCapturingId(b.actionId)}
                            className="flex-none text-[11px] px-2 py-0.5 rounded border border-amber-600/50 text-amber-600"
                            title="unbound — click to rebind"
                          >
                            unbound
                          </button>
                        ) : capturingId === b.actionId ? (
                          <span className="flex gap-1 items-center px-1 py-0.5 rounded outline outline-1 outline-accent-green">
                            <Keycaps parts={["press keys…"]} />
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setNotice(null);
                              setCapturingId(b.actionId);
                            }}
                            aria-label={`Change binding for ${b.label}`}
                            title="click to rebind"
                            className={`flex gap-1 items-center px-1 py-0.5 rounded hover:outline hover:outline-1 hover:outline-dashed hover:outline-accent-green/60 ${b.disabledReason === "reserved" ? "opacity-50" : ""}`}
                          >
                            <Keycaps parts={comboParts(combo, displayPlatform)} />
                          </button>
                        )}
                        {b.disabledReason === "reserved" && (
                          <span
                            className="flex-none text-[9.5px] tracking-wider uppercase px-2 py-px rounded-full border border-amber-600/50 text-amber-600"
                            title="browser-reserved — use the command palette, or rebind; the desktop shell frees this key"
                          >
                            browser
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            resetBinding(b.actionId);
                            setNotice(null);
                          }}
                          aria-label={`Reset binding for ${b.label}`}
                          title="reset to default"
                          className={`flex-none text-text-secondary hover:text-amber-600 ${modified ? "visible" : "invisible"}`}
                        >
                          ↺
                        </button>
                      </div>
                      {notice?.actionId === b.actionId && (
                        <div className="mx-2 mb-1 px-2.5 py-1 text-[11px] rounded border border-amber-600/45 bg-amber-600/10 text-amber-600">
                          {notice.text}
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            );
          })}

          {/* Shell-owned rows — accelerators live in the shell menu, locked here. */}
          {shellRows.length > 0 && (
            <section className="mt-4">
              <div className="flex items-center gap-3 mb-1">
                <h3 className="text-[11.5px] font-bold tracking-wider text-text-secondary select-none">
                  <span aria-hidden="true">[ </span>
                  <span className="text-text-primary">SHELL — DESKTOP APP</span>
                  <span aria-hidden="true"> ]</span>
                </h3>
                <span className="flex-1 border-t border-border" aria-hidden="true" />
              </div>
              {shellRows.map((row) => (
                <div key={row.label} className="flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-bg-inset/70">
                  <span className="w-1.5 h-1.5 flex-none" />
                  <span className="flex-1 min-w-0 truncate">
                    {row.label}
                    {row.description && (
                      <span className="text-[11px] text-text-secondary"> — {row.description}</span>
                    )}
                  </span>
                  <span className="flex gap-1 items-center px-1 py-0.5">
                    <Keycaps parts={row.parts} />
                  </span>
                  <span
                    className="flex-none text-[11px] text-text-secondary"
                    role="img"
                    aria-label="Locked — bound by the desktop shell menu"
                    title="bound by the desktop shell menu — edit there"
                  >
                    🔒
                  </span>
                </div>
              ))}
            </section>
          )}

          {/* CUSTOM — user macros over riff presets / palette actions (260730-hbyh). */}
          {(macros.length > 0 || canAddMacro) && (
            <section className="mt-4" data-testid="macro-section">
              <div className="flex items-center gap-3 mb-1">
                <h3 className="text-[11.5px] font-bold tracking-wider text-text-secondary select-none">
                  <span aria-hidden="true">[ </span>
                  <span className="text-text-primary">CUSTOM</span>
                  <span aria-hidden="true"> ]</span>
                </h3>
                <span className="flex-1 border-t border-border" aria-hidden="true" />
              </div>
              {visibleMacros.map((m) => {
                const b = byAction.get(m.actionId);
                if (!b) return null;
                const combo = { code: b.code, tier: b.tier };
                const missingPreset =
                  m.target.type === "riff" &&
                  riffPresetNames != null &&
                  !riffPresetNames.includes(m.target.preset);
                return (
                  <div key={m.actionId} data-actionid={m.actionId}>
                    <div className="group flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-bg-inset/70">
                      <span className="w-1.5 h-1.5 rounded-full flex-none bg-transparent" />
                      <span className="flex-1 min-w-0 truncate">{m.label}</span>
                      <span
                        className="flex-none max-w-[46ch] truncate font-mono text-[11px] text-text-secondary bg-bg-inset border border-border rounded px-2 py-px"
                        title={macroCommandPreview(m.target)}
                      >
                        {macroCommandPreview(m.target)}
                      </span>
                      {missingPreset && (
                        <span
                          className="flex-none text-[9.5px] tracking-wider uppercase px-2 py-px rounded-full border border-red-500/60 text-red-500"
                          title={`preset “${m.target.type === "riff" ? m.target.preset : ""}” is not among this session's riff presets — running the macro will fail with an error toast`}
                        >
                          missing preset
                        </span>
                      )}
                      {capturingId === m.actionId ? (
                        <span className="flex gap-1 items-center px-1 py-0.5 rounded outline outline-1 outline-accent-green">
                          <Keycaps parts={["press keys…"]} />
                        </span>
                      ) : b.disabledReason === "user" ? (
                        <button
                          type="button"
                          onClick={() => setCapturingId(m.actionId)}
                          className="flex-none text-[11px] px-2 py-0.5 rounded border border-amber-600/50 text-amber-600"
                          title="unbound — click to bind"
                        >
                          unbound
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setNotice(null);
                            setCapturingId(m.actionId);
                          }}
                          aria-label={`Change binding for ${m.label}`}
                          title="click to rebind"
                          className={`flex gap-1 items-center px-1 py-0.5 rounded hover:outline hover:outline-1 hover:outline-dashed hover:outline-accent-green/60 ${b.disabledReason === "reserved" ? "opacity-50" : ""}`}
                        >
                          <Keycaps parts={comboParts(combo, displayPlatform)} />
                        </button>
                      )}
                      {b.disabledReason === "reserved" && (
                        <span
                          className="flex-none text-[9.5px] tracking-wider uppercase px-2 py-px rounded-full border border-amber-600/50 text-amber-600"
                          title="browser-reserved — rebind; the desktop shell frees this key"
                        >
                          browser
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteMacro(m)}
                        aria-label={`Delete macro ${m.label}`}
                        title="delete this macro"
                        className="flex-none text-text-secondary hover:text-red-500"
                      >
                        ✕
                      </button>
                    </div>
                    {notice?.actionId === m.actionId && (
                      <div className="mx-2 mb-1 px-2.5 py-1 text-[11px] rounded border border-amber-600/45 bg-amber-600/10 text-amber-600">
                        {notice.text}
                      </div>
                    )}
                  </div>
                );
              })}
              {canAddMacro && !addOpen && (
                <button
                  type="button"
                  onClick={() => setAddOpen(true)}
                  className="w-full text-left mt-1 px-2 py-1.5 text-[11px] text-text-secondary rounded border border-dashed border-border hover:text-accent-green hover:border-accent-green/60"
                >
                  + bind a key to a palette action or riff preset…
                </button>
              )}
              {canAddMacro && addOpen && (
                <div className="mt-1 px-2 py-2 rounded border border-dashed border-border flex flex-col gap-1.5">
                  <input
                    value={addQuery}
                    onChange={(e) => setAddQuery(e.target.value)}
                    placeholder="search riff presets + palette actions…"
                    aria-label="Search macro targets"
                    autoFocus
                    className="w-full text-xs bg-bg-inset border border-border rounded px-2.5 py-1 outline-none text-text-primary placeholder:text-text-secondary focus:border-accent"
                  />
                  <div className="max-h-36 overflow-y-auto flex flex-col">
                    {macroTargetOptions
                      .filter((o) => o.label.toLowerCase().includes(addQuery.trim().toLowerCase()))
                      .map((o) => (
                        <button
                          key={o.key}
                          type="button"
                          onClick={() => {
                            setAddTarget({ label: o.label, target: o.target });
                            setAddName(o.label);
                          }}
                          className={`text-left text-[11px] px-2 py-1 rounded font-mono ${addTarget?.label === o.label ? "bg-accent/15 text-text-primary" : "text-text-secondary hover:text-text-primary hover:bg-bg-inset/70"}`}
                        >
                          {o.label}
                        </button>
                      ))}
                    {macroTargetOptions.length === 0 && (
                      <span className="text-[11px] text-text-secondary px-2 py-1">
                        no targets available here
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      value={addName}
                      onChange={(e) => setAddName(e.target.value)}
                      placeholder="macro name"
                      aria-label="Macro name"
                      className="flex-1 min-w-0 text-xs bg-bg-inset border border-border rounded px-2.5 py-1 outline-none text-text-primary placeholder:text-text-secondary focus:border-accent"
                    />
                    <button
                      type="button"
                      onClick={handleAddMacro}
                      disabled={!addTarget || !addName.trim()}
                      className="rk-glint flex-none text-[11px] px-3 py-1 rounded border border-border text-text-primary disabled:opacity-40 hover:border-accent-green hover:text-accent-green"
                    >
                      add + capture key
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAddOpen(false);
                        setAddQuery("");
                        setAddTarget(null);
                        setAddName("");
                      }}
                      className="flex-none text-[11px] px-2 py-1 text-text-secondary hover:text-text-primary"
                    >
                      cancel
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>

        {/* ── footer ─────────────────────────────────────── */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-t border-border text-[11px] text-text-secondary flex-wrap">
          <span>
            overrides stored on this device{" "}
            <span className="opacity-60">(localStorage · runkit-keybindings)</span>
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => {
              resetAll();
              setNotice(null);
            }}
            className="rk-glint text-[11px] px-3 py-1 rounded border border-border text-text-primary hover:border-red-500 hover:text-red-500"
          >
            reset all
          </button>
        </div>
      </div>
    </div>
  );
}
