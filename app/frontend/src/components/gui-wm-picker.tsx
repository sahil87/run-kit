import { useEffect, useState } from "react";
import { fetchGuiStatus, type GuiStatus, type SettingsEntry } from "@/api/client";
import { INPUT_FOCUS } from "@/components/controls";
import { TextEntryControl } from "@/components/settings-all-panel";
import {
  useTextSettingDraft,
  textSettingInputClass,
  TextSettingError,
} from "@/components/text-setting-core";
import { useDesktopPick } from "@/hooks/use-desktop-pick";
import { AUTO_WM, OTHER_WM, buildWMOptions, isOtherWM, missingWMs } from "@/lib/gui-desktop";

/**
 * GuiWMPicker — the `gui.wm` named-key override in the All-settings table
 * (spec docs/specs/gui.md § Switching desktops; the `theme_dark` precedent —
 * no registry schema change, no new kind). On mount it fetches the status
 * document once (never polled — the off-dialog precedent); until the document
 * resolves, and permanently if the fetch rejects, the row renders today's
 * free-text control unchanged. Once resolved it renders a select — Auto
 * (ladder), one option per installed candidate, one disabled `— not
 * installed` option per known-but-missing desktop, Other… — whose commits run
 * the shared pick flow (write, then the enabled-check/restart confirm via
 * `useDesktopPick`); a selection alone never calls the restart route. When
 * missing desktops exist, an `Install more ▾` disclosure below the select
 * lists each one's install line.
 */

/** The revealed free-text field under the select — the TextSetting contract
 *  (Enter/blur commits, Escape cancels the edit, inline error). */
function OtherWMField({
  entry,
  value,
  pick,
}: {
  entry: SettingsEntry;
  value: string;
  pick: (name: string) => Promise<void>;
}) {
  const { draft, error, handleCommit, onChange, onKeyDown } = useTextSettingDraft(value, pick);
  return (
    <div className="mt-1.5">
      <input
        type="text"
        aria-label={`${entry.key} (custom)`}
        value={draft}
        onChange={onChange}
        onBlur={handleCommit}
        onKeyDown={onKeyDown}
        placeholder="binary name, e.g. startlxde"
        className={textSettingInputClass}
      />
      <TextSettingError error={error} />
    </div>
  );
}

export function GuiWMPicker({
  entry,
  value,
  commit,
}: {
  entry: SettingsEntry;
  /** The stored pin ("" = Auto). */
  value: string;
  /** The entry's registry write seam; `null` is the Auto/unset convention. */
  commit: (value: string | null) => Promise<void>;
}) {
  const desktopPick = useDesktopPick();
  const [status, setStatus] = useState<GuiStatus | null>(null);
  const [showOther, setShowOther] = useState(false);
  const [showInstallMore, setShowInstallMore] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetchGuiStatus()
      .then((s) => {
        if (alive) setStatus(s);
      })
      .catch(() => {
        // The free-text fallback is permanent for a rejected fetch.
      });
    return () => {
      alive = false;
    };
  }, []);

  const pick = (name: string) =>
    desktopPick(name, (n) => commit(n === AUTO_WM ? null : n));

  if (status === null) {
    return <TextEntryControl entry={entry} value={value} commit={commit} />;
  }

  const candidates = status.wm_candidates ?? [];
  // A stored pin naming no candidate (installed or known-missing) selects
  // Other… with the field revealed and pre-filled.
  const otherSelected = showOther || isOtherWM(value, candidates);
  const missing = missingWMs(status);

  return (
    <div>
      <select
        id={`setting-${entry.key}`}
        aria-label={entry.key}
        value={otherSelected ? OTHER_WM : value}
        onChange={(e) => {
          const next = e.target.value;
          if (next === OTHER_WM) {
            // The reveal alone writes nothing — the field's commit owns it.
            setShowOther(true);
            return;
          }
          setShowOther(false);
          setError("");
          pick(next).catch((err: unknown) =>
            setError(err instanceof Error && err.message ? err.message : "Failed to save"),
          );
        }}
        className={`w-full max-w-[320px] bg-transparent text-text-primary p-2 border border-border rounded ${INPUT_FOCUS}`}
      >
        {buildWMOptions(status).map((o) => (
          <option key={o.value === AUTO_WM ? "auto" : o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      {otherSelected && <OtherWMField entry={entry} value={value} pick={pick} />}
      <TextSettingError error={error} />
      {missing.length > 0 && (
        <div className="mt-1">
          <button
            type="button"
            data-testid="gui-wm-install-more"
            aria-expanded={showInstallMore}
            onClick={() => setShowInstallMore((v) => !v)}
            className={`text-[10px] text-text-secondary ${INPUT_FOCUS}`}
          >
            Install more ▾
          </button>
          {showInstallMore && (
            <div className="mt-0.5">
              {missing.map((c) => (
                <div
                  key={c.name}
                  data-testid="gui-wm-install-line"
                  className="font-mono text-[10px] text-text-secondary select-text"
                >
                  {c.label}: {c.hint}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
