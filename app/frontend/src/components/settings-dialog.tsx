import { useState, useEffect, useRef } from "react";
import { Dialog } from "@/components/dialog";
import { Tip, TipGroup } from "@/components/tip";
import { SwatchPopover } from "@/components/swatch-popover";
import { useSettingsDialog } from "@/contexts/settings-dialog-context";
import { useInstanceName } from "@/contexts/instance-name-context";
import { useInstanceAccent } from "@/contexts/instance-accent-context";
import { useChromeState, useChromeDispatch, TERMINAL_FONT_BOUNDS } from "@/contexts/chrome-context";
import { useTheme, useThemeActions } from "@/contexts/theme-context";
import { usePushSubscription } from "@/hooks/use-push-subscription";
import { NOTIFICATIONS_HELP_URL } from "@/components/global-chrome";
import { THEMES } from "@/themes";
import { getSSHHost, setSSHHost } from "@/api/client";
import { invalidateOpenContext } from "@/hooks/use-open-targets";

/**
 * VS Code-style settings dialog (260723-o7q8; desktop preference-pane layout
 * 260724-6j1v), rendered ONCE in `AppLayout` so it exists on every page —
 * server routes, terminals, boards, and the host page. Two labeled sections
 * make the persistence scope visible:
 *
 *  - **This host** — settings stored on the instance's host
 *    (`~/.rk/settings.yaml`): instance display name, SSH host, instance
 *    accent color, theme pair. Every device viewing this instance sees them.
 *  - **This device** — browser-local ergonomics (localStorage / this
 *    browser's push subscription): terminal font size, notifications.
 *
 * Layout (6j1v): the dialog uses the wide `size="lg"` Dialog variant
 * (~672px). Each setting is a PREFERENCE ROW — a `190px 1fr` CSS grid (label
 * + sublabel hint left, control right) so all controls align on one vertical
 * rule, with hairline separators between rows and scope headings as
 * full-width rules carrying the storage hint right-aligned. Below 480px the
 * row grid collapses to a single column (label above control) via the
 * `min-[480px]:` variant — ONE code path, no second dialog.
 *
 * Controls REUSE the existing models rather than rebuilding them: the accent
 * picker is the HOST-panel `SwatchPopover` + descriptor model, the theme pair
 * drives the existing `setTheme()` wiring, the font stepper is the shared
 * `ChromeContext` control, and the Notifications block (moved here from the
 * retired top-bar bell, 6j1v) is `usePushSubscription`. Open/close state
 * lives in `SettingsDialogContext` (palette actions + the sidebar gear call
 * `openSettings()`).
 */

/** Scope heading — a full-width underlined rule: uppercase scope name left,
 *  storage hint right-aligned on the same line (6j1v). */
function ScopeHeading({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border pb-1.5 mb-1">
      <span className="text-[10px] uppercase tracking-wider text-text-primary font-medium shrink-0">
        {label}
      </span>
      <span className="text-[10px] text-text-secondary text-right">{hint}</span>
    </div>
  );
}

/**
 * One preference row (6j1v): label column left (label + optional small
 * sublabel hint underneath), control column right. `min-[480px]:` gates the
 * two-column grid — below it the row stacks label-above-control (today's
 * phone layout) from the same markup. `htmlFor` renders the label as a real
 * `<label>` bound to the row's input; rows whose control has its own labeled
 * elements (theme selects, steppers) pass none.
 */
function PreferenceRow({
  label,
  sublabel,
  htmlFor,
  children,
}: {
  label: string;
  sublabel?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 min-[480px]:grid-cols-[190px_1fr] gap-x-6 gap-y-1.5 py-2.5 items-start">
      <div className="min-[480px]:pt-1">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block text-xs text-text-primary">
            {label}
          </label>
        ) : (
          <p className="text-xs text-text-primary">{label}</p>
        )}
        {sublabel && (
          <p className="text-[10px] text-text-secondary mt-0.5 leading-relaxed">{sublabel}</p>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * A labeled text setting committed on Enter/blur (the window-rename
 * vocabulary: Enter/blur commit, Escape cancels the edit without closing the
 * dialog). `commit` receives the trimmed value ("" = clear) and may reject —
 * the rejection message renders inline and the input keeps the typed value.
 * The former below-input hint is the row's SUBLABEL now (6j1v).
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
    <PreferenceRow label={label} sublabel={hint} htmlFor={id}>
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
        className="w-full max-w-[320px] bg-transparent text-text-primary p-2 border border-border rounded outline-none placeholder:text-text-secondary focus:border-text-secondary"
      />
      {error && (
        <p className="text-xs text-red-400 mt-1" role="alert">
          {error}
        </p>
      )}
    </PreferenceRow>
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
    <PreferenceRow label="Theme" sublabel="Mode plus the theme each mode resolves to">
      <div className="flex gap-1.5 mb-2" role="group" aria-label="Theme mode">
        {modeButton("system", "System", () => setTheme("system"))}
        {modeButton("light", "Light", () => setTheme(themeLight))}
        {modeButton("dark", "Dark", () => setTheme(themeDark))}
      </div>
      <div className="grid grid-cols-2 gap-2 max-w-[420px]">
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
    </PreferenceRow>
  );
}

/** Instance accent color: the HOST-panel picker's descriptor model on a
 *  dialog-local anchor. Color-only `SwatchPopover` (its Clear row clears). */
function AccentColorControl() {
  const { color, isExplicit, stripeHex, setColor } = useInstanceAccent();
  const [showPicker, setShowPicker] = useState(false);

  return (
    <PreferenceRow label="Accent color">
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
              // Selection does NOT close (the picker's dismissal contract).
              onSelect={(c) => setColor(c)}
              onClose={() => setShowPicker(false)}
            />
          </div>
        )}
      </div>
    </PreferenceRow>
  );
}

/** Terminal font size: the shared ChromeContext stepper (This device). */
function TerminalFontControl() {
  const { terminalFontSize } = useChromeState();
  const { increaseTerminalFont, decreaseTerminalFont, resetTerminalFont } = useChromeDispatch();
  const stepBtn =
    "min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] border border-border rounded text-text-secondary hover:border-text-secondary hover:text-text-primary transition-colors flex items-center justify-center";

  return (
    <PreferenceRow
      label="Terminal font size"
      sublabel={`${TERMINAL_FONT_BOUNDS.min}–${TERMINAL_FONT_BOUNDS.max}px, stored in this browser only`}
    >
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
    </PreferenceRow>
  );
}

/**
 * Notifications row (260724-6j1v — moved here from the retired top-bar bell).
 * Maps 1:1 from the bell popover's `usePushSubscription` model: subscription
 * status line, Enable action, subscribed-gated test send, the denied re-allow
 * note, and the setup-guide link. Unlike the bell (which rendered NOTHING
 * where push can't work), a settings pane explains absence: the unsupported
 * state keeps the row with a "Not supported in this browser" note.
 */
function NotificationsControl() {
  const { state, enable, sendTest } = usePushSubscription();
  const subscribed = state === "subscribed";
  const denied = state === "denied";

  const actionBtn =
    "px-2 py-1 border border-border rounded text-xs text-text-secondary hover:border-text-secondary hover:text-text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:text-text-secondary";

  return (
    <PreferenceRow label="Notifications" sublabel="Web Push to this browser">
      {state === "unsupported" ? (
        // Push needs a secure context + service-worker support. The bell chip
        // hid itself here; a settings pane explains the absence instead.
        <p className="text-xs text-text-secondary pt-1">Not supported in this browser</p>
      ) : (
        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-2 text-xs text-text-primary" role="status">
            <span
              aria-hidden="true"
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                subscribed ? "bg-accent-green" : "bg-text-secondary"
              }`}
            />
            {subscribed
              ? "Subscribed on this device"
              : denied
                ? "Blocked in browser settings"
                : "Not subscribed"}
          </span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {!subscribed && (
              <button type="button" onClick={() => void enable()} className={actionBtn}>
                Enable notifications
              </button>
            )}
            <Tip label={subscribed ? "Send a local test notification" : "Enable notifications first"}>
              <button
                type="button"
                onClick={() => void sendTest()}
                disabled={!subscribed}
                className={actionBtn}
              >
                Send test notification
              </button>
            </Tip>
          </div>
          {denied && (
            <p className="text-[10px] text-text-secondary">
              Re-allow notifications for this site in your browser/OS settings.
            </p>
          )}
          <a
            href={NOTIFICATIONS_HELP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-accent hover:underline w-fit"
          >
            Setup &amp; troubleshooting guide ↗
          </a>
        </div>
      )}
    </PreferenceRow>
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
    <Dialog title="Settings" onClose={onClose} size="lg">
      <TipGroup>
        <section aria-label="This host settings">
          <ScopeHeading label="This host" hint="stored on this instance, shared by every device" />
          {/* Hairline separators between rows — a low-opacity border (6j1v). */}
          <div className="divide-y divide-border/40">
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
                // The Open control's cached context embeds the SSH host in
                // editor deeplinks — refresh it at the one seam where it
                // changes. Success only: a rejected commit left the server
                // value unchanged, so the cache is still correct.
                invalidateOpenContext();
              }}
            />
            <AccentColorControl />
            <ThemePairControl />
          </div>
        </section>

        <section aria-label="This device settings" className="mt-4">
          <ScopeHeading label="This device" hint="stored in this browser only" />
          <div className="divide-y divide-border/40">
            <TerminalFontControl />
            <NotificationsControl />
          </div>
        </section>
      </TipGroup>
    </Dialog>
  );
}
