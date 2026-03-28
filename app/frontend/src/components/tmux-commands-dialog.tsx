import { useState, useEffect, useRef, useCallback } from "react";
import { Dialog } from "@/components/dialog";

type TmuxCommandsDialogProps = {
  server: string;
  session: string;
  window: string;
  onClose: () => void;
};

type CommandRow = {
  label: string;
  command: string;
};

function buildCommands(server: string, session: string, window: string): CommandRow[] {
  const prefix = server === "default" ? "tmux" : `tmux -L ${server}`;
  return [
    { label: "Attach", command: `${prefix} attach-session -t ${session}:${window}` },
    { label: "New window", command: `${prefix} new-window -t ${session}` },
    { label: "Detach", command: `${prefix} detach-client -t ${session}` },
  ];
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5V3a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h2.5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8.5 6.5 12 13 4" />
    </svg>
  );
}

export function TmuxCommandsDialog({ server, session, window, onClose }: TmuxCommandsDialogProps) {
  const commands = buildCommands(server, session, window);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback((command: string, index: number) => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      return;
    }
    navigator.clipboard
      .writeText(command)
      .then(() => {
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current);
        }
        setCopiedIndex(index);
        timerRef.current = setTimeout(() => {
          setCopiedIndex(null);
          timerRef.current = null;
        }, 1500);
      })
      .catch(() => {});
  }, []);

  return (
    <Dialog title="tmux commands" onClose={onClose}>
      <div className="flex flex-col gap-2.5">
        {commands.map((row, i) => (
          <div key={row.label}>
            <div className="text-text-secondary text-[11px] mb-1">{row.label}</div>
            <div className="flex items-center gap-1.5">
              <code className="flex-1 bg-bg-inset border border-border rounded px-2 py-1.5 font-mono text-[11px] select-all break-all">
                {row.command}
              </code>
              <button
                type="button"
                onClick={() => handleCopy(row.command, i)}
                className="shrink-0 p-1 text-text-secondary hover:text-text-primary transition-colors"
                aria-label={`Copy ${row.label.toLowerCase()} command`}
              >
                {copiedIndex === i ? <CheckIcon /> : <CopyIcon />}
              </button>
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
