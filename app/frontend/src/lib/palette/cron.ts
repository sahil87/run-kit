/**
 * Pure builder for the command-palette cron actions (`Cron: new entry`,
 * `Cron: mute…`, `Cron: pin…`, `Cron: delete…`) — Constitution V palette
 * parity for the cron clock's mutations. Follows the lib/palette/sort.ts /
 * lib/palette/pin.ts pure-builder convention so the gating and label
 * composition are unit-testable without mounting the shell. The bodies are
 * thin callbacks; app.tsx wires them to the api/client.ts mutations (and the
 * delete confirm dialog).
 *
 * The `…` actions pick their entry through the palette's optionPicker
 * sub-step (the established `…` idiom — Space toggle, Enter applies). The
 * picker is multi-select by construction; cron mutations are single-entry, so
 * only the FIRST picked key applies. With no entries the pickers are omitted
 * entirely (omit-not-disable — a picker over an empty list is a dead end),
 * leaving `Cron: new entry` as the always-present opener.
 */
import type { PaletteAction } from "@/components/command-palette";
import type { CronEntry } from "@/api/client";

export type CronActionHandlers = {
  onCreate: () => void;
  /** Toggles the entry's current flag — the caller reads `entry.muted`. */
  onMute: (entry: CronEntry) => void;
  onPin: (entry: CronEntry) => void;
  onDelete: (entry: CronEntry) => void;
};

export function buildCronActions(
  entries: CronEntry[],
  handlers: CronActionHandlers,
): PaletteAction[] {
  const newEntry: PaletteAction = {
    id: "cron-new-entry",
    label: "Cron: new entry",
    onSelect: handlers.onCreate,
  };
  if (entries.length === 0) return [newEntry];

  const pickerFor = (
    options: { key: string; label: string }[],
    placeholder: string,
    apply: (entry: CronEntry) => void,
  ): PaletteAction["optionPicker"] => ({
    options,
    placeholder,
    onApply: (keys) => {
      const entry = entries.find((e) => e.id === keys[0]);
      if (entry) apply(entry);
    },
  });

  const muteOptions = entries.map((e) => ({
    key: e.id,
    label: `${e.name || e.id}${e.muted === true ? " (muted)" : ""}`,
  }));
  const pinOptions = entries.map((e) => ({
    key: e.id,
    label: `${e.name || e.id}${e.pinned === true ? " (pinned)" : ""}`,
  }));
  const deleteOptions = entries.map((e) => ({ key: e.id, label: e.name || e.id }));

  return [
    newEntry,
    {
      id: "cron-mute",
      label: "Cron: mute…",
      optionPicker: pickerFor(muteOptions, "Pick an entry to mute/unmute — Space toggle · Enter apply", handlers.onMute),
      onSelect: () => {},
    },
    {
      id: "cron-pin",
      label: "Cron: pin…",
      optionPicker: pickerFor(pinOptions, "Pick an entry to pin/unpin — Space toggle · Enter apply", handlers.onPin),
      onSelect: () => {},
    },
    {
      id: "cron-delete",
      label: "Cron: delete…",
      optionPicker: pickerFor(deleteOptions, "Pick an entry to delete — Space toggle · Enter apply", handlers.onDelete),
      onSelect: () => {},
    },
  ];
}
