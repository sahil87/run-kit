import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getSettingsEntries,
  postSettings,
  type SettingsEntry,
} from "@/api/client";
import { useInstanceAccent } from "@/contexts/instance-accent-context";
import { useInstanceName } from "@/contexts/instance-name-context";
import { useTheme, useThemeActions } from "@/contexts/theme-context";
import { useToast } from "@/components/toast";
import { invalidateOpenContext } from "@/hooks/use-open-targets";

/**
 * The settings dialog's ONE registry seam (the drift-guard rule): the
 * SettingsEntry[] fetch + write routing live here, hoisted to the dialog body
 * (one fetch per open, mount-gated on `isOpen`), and every settings surface in
 * the dialog — the curated General/Appearance rows and the All-settings table
 * rows of the same key — reads and writes through this value, so the two
 * presentations cannot disagree within an open dialog.
 *
 * Read path: `settingValue` (and the exposed `entries`, which the table's
 * modified-dot computation reads) derive from ONE effective list — the fetched
 * entries overlaid with the live values of context-backed keys (theme /
 * theme_dark / theme_light / instance_name / instance_color) — so a write
 * through ANY route (context setter or generic POST) reflects in the row's
 * control and its modified dot alike. Per-key mirror logic in consumers is
 * forbidden (the rework-cycle-1/3 defect class); context-less keys update the
 * fetched list optimistically via `commitSetting`.
 *
 * Write routing: keys with an existing optimistic context POST through that
 * context's setter (theme via `setTheme`, `instance_color` via
 * `useInstanceAccent().setColor`, `instance_name` via
 * `useInstanceName().setInstanceName`); context-less keys (`auto_name`,
 * `ssh_host`, `log_level`, `tmux_conf`) POST via `postSettings` and update the
 * shared list on success. A backend rejection rejects `commitSetting`, so the
 * row surfaces the 400 inline (the TextSetting contract) without clobbering
 * the stored value.
 */
export function useSettingsRegistry() {
  const { preference, themeDark, themeLight } = useTheme();
  const { setTheme } = useThemeActions();
  const accent = useInstanceAccent();
  const { instanceName, setInstanceName } = useInstanceName();
  const { addToast } = useToast();

  const [entries, setEntries] = useState<SettingsEntry[]>([]);
  useEffect(() => {
    let alive = true;
    getSettingsEntries()
      .then((list) => {
        if (alive) setEntries(list);
      })
      .catch(() => {
        // A failed registry fetch leaves the table empty; the curated rows
        // still render from their contexts.
      });
    return () => {
      alive = false;
    };
  }, []);

  const updateEntryValue = useCallback((key: string, value: unknown) => {
    setEntries((prev) => prev.map((e) => (e.key === key ? { ...e, value } : e)));
  }, []);

  const entriesWithMirrors = useMemo(() => {
    // The effective registry = the fetched list with live context values
    // overlaid. A key appears here ONLY when its context is the authoritative
    // read for that key — the overlay is derived, not a per-key write mirror.
    const mirrors = new Map<string, unknown>([
      ["theme", preference],
      ["theme_dark", themeDark],
      ["theme_light", themeLight],
      ["instance_name", instanceName],
    ]);
    // The accent context's `color` falls back to the localStorage echo seed
    // while its fetch pends — only an explicit setting is authoritative.
    if (accent.isExplicit) mirrors.set("instance_color", accent.color);
    return entries.map((e) => (mirrors.has(e.key) ? { ...e, value: mirrors.get(e.key) } : e));
  }, [entries, preference, themeDark, themeLight, instanceName, accent.isExplicit, accent.color]);

  const settingValue = useCallback(
    (key: string): unknown =>
      entriesWithMirrors.find((e) => e.key === key)?.value ?? null,
    [entriesWithMirrors],
  );

  const commitSetting = useCallback(
    async (key: string, value: string | boolean | null): Promise<void> => {
      switch (key) {
        case "theme": {
          // Mode values are not theme ids — map them to the per-mode slot id
          // exactly as the Appearance tab's mode buttons do (a bare "dark"/
          // "light" hits setTheme's unknown-id branch and persists system).
          const mode = value === null || value === "" ? "system" : String(value);
          setTheme(mode === "dark" ? themeDark : mode === "light" ? themeLight : "system");
          return;
        }
        case "theme_dark":
        case "theme_light":
          if (value === null) {
            // Empty clears the slot back to its registry default.
            await postSettings({ [key]: null });
            updateEntryValue(key, null);
            return;
          }
          // The theme setter owns both slots' persistence contract.
          setTheme(String(value));
          return;
        case "instance_color": {
          // setColor returns void (optimistic, failure toasts) — resolve
          // immediately so the control never shows a stale error.
          const color = value === null || value === "" ? null : String(value);
          accent.setColor(color);
          // A clear flips isExplicit false and drops the overlay — write
          // through to the fetched list (the instance_name shape) so the
          // effective read path keeps the cleared value instead of falling
          // back to the pre-clear fetch.
          updateEntryValue("instance_color", color);
          return;
        }
        case "instance_name": {
          const name = value === null || value === "" ? null : String(value);
          setInstanceName(name);
          // The context setter is fire-and-forget (failure toasts globally);
          // mirror the write into the list so table rows and the modified dot
          // never wait on a refetch.
          updateEntryValue("instance_name", name);
          return;
        }
        case "ssh_host": {
          const host = value === null || value === "" ? null : String(value);
          await postSettings({ ssh_host: host });
          updateEntryValue("ssh_host", host);
          // The Open control's cached context embeds the SSH host in editor
          // deeplinks — refresh it at the one seam where it changes. Success
          // only: a rejected commit left the server value unchanged.
          invalidateOpenContext();
          return;
        }
        default: {
          // Draft-less controls (toggle, select) must not snap back during
          // the round trip: apply optimistically, roll back on rejection.
          let prev: unknown = null;
          setEntries((cur) => {
            prev = cur.find((e) => e.key === key)?.value ?? null;
            return cur.map((e) => (e.key === key ? { ...e, value } : e));
          });
          try {
            await postSettings({ [key]: value });
          } catch (err: unknown) {
            updateEntryValue(key, prev);
            addToast(err instanceof Error && err.message ? err.message : "Failed to save", "error");
            throw err;
          }
        }
      }
    },
    [setTheme, themeDark, themeLight, accent, setInstanceName, addToast, updateEntryValue],
  );

  return { entries: entriesWithMirrors, settingValue, commitSetting };
}

export type SettingsRegistry = ReturnType<typeof useSettingsRegistry>;
