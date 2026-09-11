import { useNavigate, useSearch } from "@tanstack/react-router";
import { controlClass } from "@/components/control";

const SEGMENTS = [
  { tab: "terminal", label: "Operator Terminal" },
  { tab: "activity", label: "Activity" },
  { tab: "tasks", label: "Operator Tasks" },
] as const;

export type ConsoleSegment = (typeof SEGMENTS)[number]["tab"];

// The accepted tab values are exported for the union-agreement guard: the
// strip's tabs, `OperatorConsoleRequest.segment`, and router-url.ts's literal
// `tab` union are three spellings of the same set and must never drift.
export { SEGMENTS };

/**
 * The presentational `Operator Terminal | Activity | Operator Tasks` segment
 * strip — one controlled
 * render shared by the mobile operator route's tabs (`TerminalActivityTabs`
 * below, driven by the router `tab` search param) and the desktop operator
 * console drawer (driven by console-local component state). Both consumers
 * get identical markup, roles, and test ids. The file name and the
 * `terminal-activity-tabs` test id predate the third segment and stay —
 * renaming would churn every spec for no behavior gain.
 */
export function ConsoleSegments({
  value,
  onChange,
}: {
  value: ConsoleSegment;
  onChange: (tab: ConsoleSegment) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Console view"
      data-testid="terminal-activity-tabs"
      className="flex shrink-0 border-b border-border bg-bg-primary"
    >
      {SEGMENTS.map(({ tab, label }) => {
        const pressed = value === tab;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={pressed}
            onClick={() => onChange(tab)}
            className={`rk-glint flex-1 py-2 text-center text-[11px] font-mono transition-colors coarse:min-h-[36px] ${controlClass({ variant: "segment", pressed, rest: "border-transparent text-text-secondary hover:text-text-primary" })}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The mobile operator route's segmented header (mounted
 * by AppShell only when the shared `useIsMobile()` rule holds AND the
 * resolved window's role is `operator`). Each segment drives the terminal
 * route's `tab` search param through the router's search-param setter — a
 * client-side search update, never a full navigation — and `tab` absent reads
 * as `terminal`.
 *
 * The `pt-9` wrapper clears the mobile tongue's hit area: the tongue hangs
 * `absolute top-0 h-9 w-16` centered over the content column (app.tsx), and
 * with three equal-width segments the middle segment's center would land
 * squarely under it — the strip must start below the tongue's 36px box.
 */
export function TerminalActivityTabs() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  const active: ConsoleSegment =
    search.tab === "activity" || search.tab === "tasks" ? search.tab : "terminal";

  return (
    <div className="shrink-0 pt-9">
      <ConsoleSegments
        value={active}
        onChange={(tab) =>
          void navigate({
            to: ".",
            search: (prev) => ({ ...prev, tab }),
            replace: true,
          })
        }
      />
    </div>
  );
}
