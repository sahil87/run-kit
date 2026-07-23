import { useState, useEffect, useRef } from "react";
import { Dialog } from "@/components/dialog";
import { Tip, TipGroup } from "@/components/tip";
import { SwatchPopover } from "@/components/swatch-popover";
import { useSettingsDialog } from "@/contexts/settings-dialog-context";
import { useInstanceName } from "@/contexts/instance-name-context";
import { useInstanceAccent } from "@/contexts/instance-accent-context";
import { useChromeState, useChromeDispatch, TERMINAL_FONT_BOUNDS } from "@/contexts/chrome-context";
import { useTheme, useThemeActions } from "@/contexts/theme-context";
import { THEMES } from "@/themes";
import { getSSHHost, setSSHHost } from "@/api/client";

/**
 * VS Code-style settings dialog (260723-o7q8), rendered ONCE in `AppLayout`
 * so it exists on every page — server routes, terminals, boards, and the host
 * page. Two labeled sections make the persistence scope visible:
 *
 *  - **This host** — settings stored on the instance's host
 *    (`~/.rk/settings.yaml`): instance display name, SSH host, instance
 *    accent color, theme pair. Every device viewing this instance sees them.
 *  - **This device** — browser-local ergonomics (localStorage): terminal
 *    font size. A value here deliberately does NOT sync across devices.
 *
 * Controls REUSE the existing models rather than rebuilding them: the accent
 * picker is the HOST-panel `SwatchPopover` + descriptor model, the theme pair
 * drives the existing `setTheme()` wiring, and the font stepper is the shared
 * `ChromeContext` control. Open/close state lives in `SettingsDialogContext`
 * (palette actions + the sidebar gear call `openSettings()`).
 */

/** Small uppercase section label carrying the scope split. */
function ScopeHeading({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-2 mt-1">
      <span className="text-[10px] uppercase tracking-wider text-text-primary font-medium">{label}</span>
      <span className="text-[10px] text-text-secondary">{hint}</span>
    </div>
  );
}

/**
 * A labeled text setting committed on Enter/blur (the window-rename
 * vocabulary: Enter/blur commit, Escape cancels the edit without closing the
 * dialog). `commit` receives the trimmed value ("" = clear) and may reject —
 * the rejection message renders inline and the input keeps the typed value.
 */
function TextSetting({
  id,
  label,
  value,
  placeholder,
  hint,
  commit,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  hint?: string;
  commit: (trimmed: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState("");
  // Follow external updates (fetch landing, another surface editing) unless
  // the user has diverged the draft.
  const lastValueRef = useRef(value);
  useEffect(() => {
    if (draft === lastValueRef.current) setDraft(value);
    lastValueRef.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleCommit = () => {
    const trimmed = draft.trim();
    if (trimmed === value.trim()) {
      setDraft(value);
      setError("");
      return;
    }
    commit(trimmed)
      .then(() => {
        setError("");
        setDraft(trimmed);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error && err.message ? err.message : "Failed to save");
      });
  };

  return (
    <div className="mb-3">
      <label htmlFor={id} className="block text-xs text-text-secondary mb-1.5">
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setError("");
        }}
        onBlur={handleCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleCommit();
          } else if (e.key === "Escape") {
            // Cancel the edit only — a second Escape closes the dialog.
            if (draft !== value) {
              e.stopPropagation();
              setDraft(value);
              setError("");
            }
          }
        }}
        placeholder={placeholder}
        className="w-full bg-transparent text-text-primary p-2 border border-border rounded outline-none placeholder:text-text-secondary focus:border-text-secondary"
      />
      {error ? (
        <p className="text-xs text-red-400 mt-1" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[10px] text-text-secondary mt-1">{hint}</p>
      ) : null}
    </div>
  );
}

/** Theme-pair second surface: mode buttons + per-mode preferred-theme selects,
 *  all driving the existing `setTheme()` wiring (the top-bar selector stays). */
function ThemePairControl() {
  const { preference, resolved, themeDark, themeLight } = useTheme();
  const { setTheme } = useThemeActions();
  const mode = preference === "system" ? "system" : resolved;

  const modeButton = (m: "system" | "light" | "dark", label: string, onPick: () => void) => (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={mode === m}
      className={`px-2 py-1 border rounded text-xs transition-colors ${
        mode === m
          ? "border-accent text-text-primary bg-bg-inset"
          : "border-border text-text-secondary hover:border-text-secondary"
      }`}
    >
      {label}
    </button>
  );

  const darkThemes = THEMES.filter((t) => t.category === "dark");
  const lightThemes = THEMES.filter((t) => t.category === "light");
  const selectClass =
    "w-full bg-bg-primary text-text-primary p-1.5 border border-border rounded outline-none text-xs";

  return (
    <div className="mb-3">
      <p className="text-xs text-text-secondary mb-1.5">Theme</p>
      <div className="flex gap-1.5 mb-2" role="group" aria-label="Theme mode">
        {modeButton("system", "System", () => setTheme("system"))}
        {modeButton("light", "Light", () => setTheme(themeLight))}
        {modeButton("dark", "Dark", () => setTheme(themeDark))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="settings-theme-dark" className="block text-[10px] text-text-secondary mb-1">
            Dark theme
          </label>
          <select
            id="settings-theme-dark"
            value={themeDark}
            onChange={(e) => setTheme(e.target.value)}
            className={selectClass}
          >
            {darkThemes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="settings-theme-light" className="block text-[10px] text-text-secondary mb-1">
            Light theme
          </label>
          <select
            id="settings-theme-light"
            value={themeLight}
            onChange={(e) => setTheme(e.target.value)}
            className={selectClass}
          >
            {lightThemes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

/** Instance accent color: the HOST-panel picker's descriptor model on a
 *  dialog-local anchor. Color-only `SwatchPopover` (its Clear row clears). */
function AccentColorControl() {
  const { color, isExplicit, stripeHex, setColor } = useInstanceAccent();
  const [showPicker, setShowPicker] = useState(false);

  return (
    <div className="mb-3">
      <p className="text-xs text-text-secondary mb-1.5">Accent color</p>
      <div className="relative">
        <Tip label="Set instance color">
          <button
            type="button"
            onClick={() => setShowPicker((v) => !v)}
            aria-label="Set instance color"
            aria-expanded={showPicker}
            className="flex items-center gap-2 px-2 py-1 border border-border rounded text-xs text-text-primary hover:border-text-secondary transition-colors"
          >
            <span
              aria-hidden="true"
              className="inline-block w-3.5 h-3.5 rounded-sm border border-border"
              style={stripeHex ? { backgroundColor: stripeHex } : undefined}
            />
            {stripeHex ? "Change…" : "None — choose…"}
          </button>
        </Tip>
        {showPicker && (
          <div className="absolute left-0 top-full mt-1 z-50">
            <SwatchPopover
              selectedColor={isExplicit && color != null ? color : undefined}
              onSelect={(c) => {
                setColor(c);
                setShowPicker(false);
              }}
              onClose={() => setShowPicker(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** Terminal font size: the shared ChromeContext stepper (This device). */
function TerminalFontControl() {
  const { terminalFontSize } = useChromeState();
  const { increaseTerminalFont, decreaseTerminalFont, resetTerminalFont } = useChromeDispatch();
  const stepBtn =
    "min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] border border-border rounded text-text-secondary hover:border-text-secondary hover:text-text-primary transition-colors flex items-center justify-center";

  return (
    <div className="mb-1">
      <p className="text-xs text-text-secondary mb-1.5">Terminal font size</p>
      <div className="flex items-center gap-1.5">
        <Tip label="Decrease terminal font">
          <button
            type="button"
            onClick={decreaseTerminalFont}
            aria-label="Decrease terminal font"
            className={stepBtn}
          >
            −
          </button>
        </Tip>
        <span className="text-xs text-text-primary min-w-[4ch] text-center" aria-live="polite">
          {terminalFontSize}px
        </span>
        <Tip label="Increase terminal font">
          <button
            type="button"
            onClick={increaseTerminalFont}
            aria-label="Increase terminal font"
            className={stepBtn}
          >
            +
          </button>
        </Tip>
        <button
          type="button"
          onClick={resetTerminalFont}
          className="ml-2 px-2 py-1 border border-border rounded text-xs text-text-secondary hover:border-text-secondary hover:text-text-primary transition-colors"
        >
          Reset
        </button>
      </div>
      <p className="text-[10px] text-text-secondary mt-1">
        {TERMINAL_FONT_BOUNDS.min}–{TERMINAL_FONT_BOUNDS.max}px, stored in this browser only
      </p>
    </div>
  );
}

export function SettingsDialog() {
  const { isOpen, closeSettings } = useSettingsDialog();
  if (!isOpen) return null;
  return <SettingsDialogBody onClose={closeSettings} />;
}

/** The dialog body — mounted only while open, so per-open fetches (the SSH
 *  host setting) run on mount without any reopen-staleness bookkeeping. */
function SettingsDialogBody({ onClose }: { onClose: () => void }) {
  const { hostname, instanceName, setInstanceName } = useInstanceName();

  // The SSH host field edits the stored SETTING (may be empty while the
  // RK_SSH_HOST env fallback is active) — fetched fresh per open.
  const [sshHost, setSSHHostState] = useState("");
  useEffect(() => {
    let alive = true;
    getSSHHost()
      .then((host) => {
        if (alive) setSSHHostState(host ?? "");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Dialog title="Settings" onClose={onClose}>
      <TipGroup>
        <section aria-label="This host settings">
          <ScopeHeading label="This host" hint="stored on this instance, shared by every device" />
          <TextSetting
            id="settings-instance-name"
            label="Instance name"
            value={instanceName ?? ""}
            placeholder={hostname || "hostname"}
            hint="Display name for this instance; empty uses the hostname"
            commit={(trimmed) => {
              // Optimistic context write (failure toasts globally); resolve
              // immediately so the field never shows a stale error.
              setInstanceName(trimmed === "" ? null : trimmed);
              return Promise.resolve();
            }}
          />
          <TextSetting
            id="settings-ssh-host"
            label="SSH host"
            value={sshHost}
            placeholder="alias or user@host"
            hint="Used verbatim in editor deeplinks; empty falls back to RK_SSH_HOST"
            commit={async (trimmed) => {
              await setSSHHost(trimmed === "" ? null : trimmed);
              setSSHHostState(trimmed);
            }}
          />
          <AccentColorControl />
          <ThemePairControl />
        </section>

        <div className="border-t border-border my-3" aria-hidden="true" />

        <section aria-label="This device settings">
          <ScopeHeading label="This device" hint="stored in this browser only" />
          <TerminalFontControl />
        </section>
      </TipGroup>
    </Dialog>
  );
}
