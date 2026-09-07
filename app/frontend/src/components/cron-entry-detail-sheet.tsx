import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { controlClass } from "@/components/control";
import {
  SWITCH_KNOB_OFF,
  SWITCH_KNOB_ON,
  SWITCH_TRACK_OFF,
  SWITCH_TRACK_ON,
} from "@/components/controls";
import { deleteCron, muteCron, pinCron, type CronEntry } from "@/api/client";
import { describeSchedule } from "@/lib/cron-schedule";
import { formatDuration } from "@/lib/format";

/** "3m ago" for a unix-seconds timestamp. Render-time only — the feed's
 *  SSE-cadence refetch is the clock (the recovery-section precedent: no
 *  ticking timer). */
function agoLabel(ts: number, nowMs: number): string {
  const elapsed = Math.max(0, Math.floor(nowMs / 1000 - ts));
  return `${formatDuration(elapsed)} ago`;
}

/** "in 5m" for a unix-seconds timestamp; a past-due fire reads "due". */
function inLabel(ts: number, nowMs: number): string {
  const delta = Math.floor(ts - nowMs / 1000);
  return delta > 0 ? `in ${formatDuration(delta)}` : "due";
}

/** The track visual for a bool row — the shared switch color recipe around
 *  this sheet's own geometry (per the controls.ts contract). */
function SwitchTrack({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`relative block w-8 h-[18px] shrink-0 rounded-full border transition-colors ${
        on ? SWITCH_TRACK_ON : SWITCH_TRACK_OFF
      }`}
    >
      <span
        className={`absolute top-[2px] block w-3 h-3 rounded-full transition-all ${
          on ? `left-[16px] ${SWITCH_KNOB_ON}` : `left-[2px] ${SWITCH_KNOB_OFF}`
        }`}
      />
    </span>
  );
}

/**
 * The cron entry detail sheet — the mobile action surface for one entry (the
 * spec's "alarm-app anatomy": name, schedule in plain words, last/next, a
 * first-class mute switch, pin and delete rows). No Sheet/BottomSheet
 * primitive exists in the codebase; this is a bottom-anchored overlay panel
 * riding the Dialog idioms (backdrop tap + Escape close via the focus trap,
 * settings-dialog row/toggle markup, kill-confirm two-step for delete).
 *
 * Mute/pin reflect OPTIMISTICALLY: the row overrides the prop value until the
 * next SSE-driven refetch confirms it (every mutation wakes the hub
 * server-side), then the override clears; a failure reverts to the prop and
 * surfaces the error inline.
 */
export function CronEntryDetailSheet({
  server,
  entry,
  onClose,
}: {
  server: string;
  entry: CronEntry;
  onClose: () => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  useFocusTrap(sheetRef, true, onClose);

  const [mutedOverride, setMutedOverride] = useState<boolean | null>(null);
  const [pinnedOverride, setPinnedOverride] = useState<boolean | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const entryMuted = entry.muted === true;
  const entryPinned = entry.pinned === true;
  // Reconcile: once a refetch's entry carries the optimistic value, the
  // override has nothing left to say.
  useEffect(() => {
    if (mutedOverride !== null && entryMuted === mutedOverride) setMutedOverride(null);
  }, [entryMuted, mutedOverride]);
  useEffect(() => {
    if (pinnedOverride !== null && entryPinned === pinnedOverride) setPinnedOverride(null);
  }, [entryPinned, pinnedOverride]);

  const muted = mutedOverride ?? entryMuted;
  const pinned = pinnedOverride ?? entryPinned;

  const toggleMute = () => {
    const next = !muted;
    setError("");
    setMutedOverride(next);
    muteCron(server, entry.id, next).catch((err: unknown) => {
      setMutedOverride(null);
      setError(err instanceof Error && err.message ? err.message : "Mute failed");
    });
  };
  const togglePin = () => {
    const next = !pinned;
    setError("");
    setPinnedOverride(next);
    pinCron(server, entry.id, next).catch((err: unknown) => {
      setPinnedOverride(null);
      setError(err instanceof Error && err.message ? err.message : "Pin failed");
    });
  };
  const confirmDelete = () => {
    if (deleting) return;
    setDeleting(true);
    setError("");
    deleteCron(server, entry.id)
      .then(onClose)
      .catch((err: unknown) => {
        setError(err instanceof Error && err.message ? err.message : "Delete failed");
      })
      .finally(() => setDeleting(false));
  };

  const nowMs = Date.now();
  const title = entry.name || entry.id;

  const rowClass = "flex items-center justify-between gap-4 px-3 py-2.5";
  const labelClass = "text-xs text-text-primary";
  const valueClass = "text-xs text-text-secondary text-right";

  return (
    <div className="fixed inset-0 z-40" data-testid="cron-entry-sheet">
      <div
        className="fixed inset-0 bg-black/50"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Cron entry ${title}`}
        className="absolute bottom-0 left-0 right-0 sm:left-1/2 sm:right-auto sm:w-full sm:max-w-lg sm:-translate-x-1/2 max-h-[80vh] overflow-y-auto rounded-t-lg border border-b-0 border-border bg-bg-primary text-[11px] shadow-2xl"
      >
        <div className="flex items-center gap-2 px-3 py-2.5">
          <h2 className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close entry details"
            onClick={onClose}
            className="rk-glint ml-auto inline-flex shrink-0 items-center justify-center rounded px-1 text-text-secondary transition-colors hover:text-text-primary coarse:min-h-[36px] coarse:min-w-[36px]"
          >
            ✕
          </button>
        </div>
        <p className="px-3 pb-2 text-xs text-text-secondary">{describeSchedule(entry)}</p>
        <div className="border-t border-border">
          <div className={rowClass}>
            <span className={labelClass}>Last fired</span>
            <span className={valueClass} data-testid="cron-entry-last-fired">
              {entry.lastFired > 0 ? agoLabel(entry.lastFired, nowMs) : "never"}
            </span>
          </div>
          <div className={`${rowClass} border-t border-border`}>
            <span className={labelClass}>Next fire</span>
            <span className={valueClass} data-testid="cron-entry-next-fire">
              {entry.nextFire !== undefined ? inLabel(entry.nextFire, nowMs) : "unknown"}
            </span>
          </div>
          {/* The whole row is the switch hit target — the phone affordance. */}
          <button
            type="button"
            role="switch"
            aria-checked={muted}
            aria-label="Mute entry"
            onClick={toggleMute}
            className={`${rowClass} w-full border-t border-border text-left coarse:min-h-[44px]`}
          >
            <span className={labelClass}>Mute</span>
            <SwitchTrack on={muted} />
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={pinned}
            aria-label="Pin entry"
            onClick={togglePin}
            className={`${rowClass} w-full border-t border-border text-left coarse:min-h-[44px]`}
          >
            <span className={labelClass}>Pin</span>
            <SwitchTrack on={pinned} />
          </button>
          <div className="border-t border-border px-3 py-2.5">
            {confirmingDelete ? (
              <div className="flex items-center gap-2">
                <span className="flex-1 text-xs text-text-secondary">Delete this entry?</span>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className={controlClass({ variant: "confirm" })}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDelete}
                  disabled={deleting}
                  className={controlClass({ variant: "confirm", danger: true })}
                >
                  Delete
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="w-full text-left text-xs text-signal-red coarse:min-h-[44px]"
              >
                Delete entry
              </button>
            )}
          </div>
        </div>
        {error && (
          <p role="alert" className="px-3 py-2 text-xs text-signal-red">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
