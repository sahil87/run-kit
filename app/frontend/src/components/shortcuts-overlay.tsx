import { useEffect, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useKeybindings } from "@/hooks/use-keybindings";
import {
  captureFromEvent,
  claimedKeys,
  comboParts,
  formatCombo,
  keyLabel,
  type BindingPlatform,
  type BindingScope,
  type EffectiveBinding,
} from "@/lib/keybindings";

/**
 * The keyboard-shortcuts cheatsheet overlay (260730-g40a) — a focus-trapped
 * dialog (Constitution IV: NOT a route; the route set is fixed), opened by
 * ⇧CmdOrCtrl+/ (toggle) and the `Help: Shortcuts` palette action, mounted on
 * both AppShell and BoardPage.
 *
 * Per the reviewed design mock (`design-mock.html` in the change folder):
 * a shifted-tier keyboard visualization (bound / custom / claimed / free per
 * key), a platform display toggle (macOS ↔ Win·Linux keycap rendering,
 * initialized from the detected platform), a filter input, grouped rows with
 * scope badges, click-to-rebind capture (Esc cancels) with steal warning,
 * modified-dot + per-row reset + unbound flag, shell-owned rows shown locked
 * (the shell menu owns their accelerators), and a footer with the storage
 * note + reset-all. Export/import is deferred; macro rows belong to change
 * 260730-hbyh and do not render here.
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

export function ShortcutsOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { bindings, byAction, overrides, host, setBinding, resetBinding, resetAll } =
    useKeybindings();
  const sheetRef = useRef<HTMLDivElement>(null);
  useFocusTrap(sheetRef, open, onClose);

  // Display platform for keycap rendering — a VIEW toggle only (capture always
  // reads the physical host platform). Initialized from the detected host.
  const [displayPlatform, setDisplayPlatform] = useState<BindingPlatform>(host.platform);
  const [query, setQuery] = useState("");
  const [capturingId, setCapturingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ actionId: string; text: string } | null>(null);

  // Reset transient state whenever the overlay closes.
  useEffect(() => {
    if (open) return;
    setQuery("");
    setCapturingId(null);
    setNotice(null);
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
      const claimed = claimedKeys(host.platform, host.shell).find(
        (c) => combo.tier === "shifted" && c.code === combo.code,
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

  // Tier-map key states for the DISPLAY platform (shifted tier only). Claimed
  // wins over bound/custom (a browser-reserved N shows claimed, not bound).
  const keyStates = useMemo(() => {
    const claimed = new Map(
      claimedKeys(displayPlatform, host.shell).map((c) => [c.code, c] as const),
    );
    const states = new Map<string, { cls: "bound" | "custom" | "claimed"; label: string }>();
    for (const b of bindings) {
      if (b.tier !== "shifted" || !b.enabled) continue;
      states.set(b.code, { cls: b.isDefault ? "bound" : "custom", label: b.mapLabel ?? b.label });
    }
    for (const [code, claim] of claimed) {
      states.set(code, { cls: "claimed", label: claim.label });
    }
    return states;
  }, [bindings, displayPlatform, host.shell]);

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
  const shellRows = useMemo(() => {
    const tierCaps = (key: string) =>
      displayPlatform === "mac" ? ["⇧", "⌘", key] : ["Shift", "Ctrl", key];
    const rows = [
      { label: "Switch to server 1–9", description: "owned by the shell menu", parts: tierCaps("1…9") },
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

  if (!open) return null;

  const tierName = displayPlatform === "mac" ? "⇧ ⌘" : "Shift Ctrl";
  const sheetChord = formatCombo({ code: "Slash", tier: "shifted" }, displayPlatform);

  const keyCell = (code: string, idx: number) => {
    if (code === "…") {
      // Decorative digit-run ellipsis cell — claimed with the switcher digits.
      const digitClaim = keyStates.get("Digit1");
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
    const state = keyStates.get(code);
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
          <span className="hidden md:inline text-[11px] text-text-secondary whitespace-nowrap">
            {sheetChord} toggles this sheet
          </span>
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
              run-kit tier — <b className="text-text-primary">{tierName}</b> + key · one tier,
              every platform
            </span>
            <span>plain Ctrl always reaches the pane</span>
          </div>
          <div className="flex flex-col items-center gap-1.5" aria-hidden="true">
            {KEY_ROWS.map((row, i) => (
              <div key={i} className="flex gap-1.5">
                {row.map((code, j) => keyCell(code, j))}
              </div>
            ))}
          </div>
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
            const rows = bindings.filter((b) => b.scope === group.scope && matchesQuery(b));
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
