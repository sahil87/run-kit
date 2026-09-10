import { useNavigate, useSearch } from "@tanstack/react-router";
import { controlClass } from "@/components/control";

const SEGMENTS = [
  { tab: "terminal", label: "Terminal" },
  { tab: "activity", label: "Activity" },
] as const;

export type ConsoleSegment = (typeof SEGMENTS)[number]["tab"];

/**
 * The presentational `Terminal | Activity` segment strip — one controlled
 * render shared by the mobile operator route's tabs (`TerminalActivityTabs`
 * below, driven by the router `tab` search param) and the desktop operator
 * console drawer (driven by console-local component state). Both consumers
 * get identical markup, roles, and test ids.
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
 * The mobile operator route's `Terminal | Activity` segmented header (mounted
 * by AppShell only when the shared `useIsMobile()` rule holds AND the
 * resolved window's role is `operator`). Each segment drives the terminal
 * route's `tab` search param through the router's search-param setter — a
 * client-side search update, never a full navigation — and `tab` absent reads
 * as `terminal`.
 */
export function TerminalActivityTabs() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  const active: ConsoleSegment = search.tab === "activity" ? "activity" : "terminal";

  return (
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
  );
}
