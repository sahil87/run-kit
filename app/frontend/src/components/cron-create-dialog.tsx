import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/dialog";
import { controlClass } from "@/components/control";
import { INPUT_COARSE, INPUT_FOCUS } from "@/components/controls";
import { createCron, type CronSchedule } from "@/api/client";

type ScheduleKind = "every" | "backoff" | "cron";

/**
 * The dialog behind the palette's `Cron: new entry` — the minimal web
 * creation surface for the operator clock (the CLI, `rk cron add`, stays the
 * full-featured path). Fields: optional name, required payload, and a
 * schedule — kind segment (every / backoff / cron) with its param input(s)
 * (Go-style durations like "10m"/"1h"; a raw 5-field expression for cron).
 * The target is fixed to role "operator" — cron is the operator's clock.
 * Submit POSTs createCron; a server validation failure renders inline and the
 * dialog stays open for edit (the TextSetting rejection idiom).
 */
export function CronCreateDialog({
  server,
  onClose,
}: {
  server: string;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [payload, setPayload] = useState("");
  const [kind, setKind] = useState<ScheduleKind>("every");
  const [interval, setInterval_] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [expr, setExpr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const payloadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    payloadRef.current?.focus();
  }, []);

  const inputClass = `w-full bg-transparent text-text-primary p-2 border border-border rounded ${INPUT_FOCUS} ${INPUT_COARSE} placeholder:text-text-secondary`;

  const scheduleValid =
    kind === "every"
      ? interval.trim().length > 0
      : kind === "backoff"
        ? min.trim().length > 0 && max.trim().length > 0
        : expr.trim().length > 0;
  const canSubmit = payload.trim().length > 0 && scheduleValid && !submitting;

  function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    const schedule: CronSchedule =
      kind === "every"
        ? { kind, interval: interval.trim() }
        : kind === "backoff"
          ? { kind, min: min.trim(), max: max.trim() }
          : { kind, expr: expr.trim() };
    createCron(server, {
      ...(name.trim() ? { name: name.trim() } : {}),
      schedule,
      target: { kind: "role", role: "operator" },
      payload: payload.trim(),
    })
      .then(onClose)
      .catch((err: unknown) => {
        setError(err instanceof Error && err.message ? err.message : "Create failed");
      })
      .finally(() => setSubmitting(false));
  }

  const kindButton = (k: ScheduleKind, label: string) => (
    <button
      type="button"
      onClick={() => setKind(k)}
      aria-pressed={kind === k}
      className={controlClass({
        variant: "toggle",
        base: "px-2 py-1 border rounded text-xs transition-colors",
        pressed: kind === k,
      })}
    >
      {label}
    </button>
  );

  return (
    <Dialog title="New cron entry" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <input
          ref={payloadRef}
          type="text"
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          aria-label="Payload"
          placeholder="payload — the prompt the entry delivers"
          className={inputClass}
        />
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          aria-label="Name"
          placeholder="name (optional)"
          className={inputClass}
        />
        <div className="flex gap-1.5" role="group" aria-label="Schedule kind">
          {kindButton("every", "Every")}
          {kindButton("backoff", "Backoff")}
          {kindButton("cron", "Cron")}
        </div>
        {kind === "every" && (
          <input
            type="text"
            value={interval}
            onChange={(e) => setInterval_(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            aria-label="Interval"
            placeholder='interval — e.g. "1h"'
            className={inputClass}
          />
        )}
        {kind === "backoff" && (
          <div className="flex gap-2">
            <input
              type="text"
              value={min}
              onChange={(e) => setMin(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              aria-label="Backoff minimum"
              placeholder='min — e.g. "60s"'
              className={inputClass}
            />
            <input
              type="text"
              value={max}
              onChange={(e) => setMax(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              aria-label="Backoff maximum"
              placeholder='max — e.g. "30m"'
              className={inputClass}
            />
          </div>
        )}
        {kind === "cron" && (
          <input
            type="text"
            value={expr}
            onChange={(e) => setExpr(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            aria-label="Cron expression"
            placeholder='expression — e.g. "0 * * * *" (not yet evaluated)'
            className={inputClass}
          />
        )}
        {error && (
          <p role="alert" className="text-xs text-signal-red">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`w-full ${controlClass({ variant: "wide", disabled: !canSubmit })}`}
        >
          Create entry
        </button>
      </div>
    </Dialog>
  );
}
