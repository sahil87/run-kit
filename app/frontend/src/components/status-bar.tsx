import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  useFloating,
  offset,
  flip,
  shift,
  useHover,
  useFocus,
  useDismiss,
  useInteractions,
  FloatingPortal,
  safePolygon,
  autoUpdate,
} from "@floating-ui/react";
import {
  useMetrics,
  useHostMetrics,
  useUpdateNotification,
} from "@/contexts/session-context";
import { useInstanceName } from "@/contexts/instance-name-context";
import { useChromeState } from "@/contexts/chrome-context";
import { useKeybindings } from "@/hooks/use-keybindings";
import { formatCombo } from "@/lib/keybindings";
import { Tip } from "@/components/tip";
import { StatusDot } from "@/components/status-dot";
import { HostMetrics, normalizeLoadPercent } from "@/components/host-metrics";
import { displayVersion } from "@/lib/palette-version";
import { formatMemory, gaugeColor } from "@/lib/gauge";
import { getAgentLine, getFabLine, getPrSegments } from "./sidebar/registers";
import { MENU_ROW_CLASS } from "@/components/top-bar-overflow-menu";
import type { MetricsSnapshot, WindowInfo } from "@/types";

/**
 * StatusBar (260814-ldbs R4/R5) — the shell's full-width ATTACHED status strip
 * on desktop: frame chrome like the top bar (flush, square, 1px `border-t`
 * seam, `bg-bg-primary`), never a card. It absorbs the sidebar's retired
 * desktop PANE/HOST panels: the LEFT cluster mirrors the CURRENT WINDOW's
 * registers (terminal route only), the RIGHT cluster carries the host
 * segments + the ⌘K / compose hints the deleted fine-pointer bottom bar used
 * to hold. The sidebar ends flush above it; the Shell grid spans the row
 * across ALL columns (sidebar included). Mobile renders no status bar at all
 * (the drawer keeps the panels — the drawer-only fork).
 *
 * MIRROR, NOT A ROLLUP: every value arrives from EXISTING derivations — the
 * shared register resolvers (`sidebar/registers.ts`), the PANE panel's
 * identity-row sources, the host-metrics contexts, and the shared PR
 * vocabulary (`pr-status-model.ts`, via the resolvers' segment colors).
 * Nothing is re-derived, nothing is fetched, and no attention/aggregation
 * logic lives here (the status-pyramid machinery is untouched).
 *
 * Data seams: the window record + server name + connection state arrive as
 * PROPS (the presentational-by-contract rule — state lives in the callers).
 * Metrics + version + the compose preference subscribe to their EXISTING
 * contexts at this leaf (the HostPanel/SidebarFooter precedent): the metrics
 * contexts are deliberately split from SessionContext so the ~2.5s metrics
 * stream re-renders only subscribers — passing metrics DOWN through AppShell
 * would re-render the whole shell every tick.
 *
 * OVERFLOW — degradation ladder, never scroll (R5, the top-bar precedent):
 *   1. Flexible values truncate in place (`min-w-0 truncate` on the branch /
 *      fab slug / cwd basename).
 *   2. Whole segments drop at deterministic CSS breakpoints (no JS
 *      measurement). The left cluster renders in DESCENDING relevance
 *      (git → pr → fab → agt → tmx → cwd), and display order equals survival
 *      order, so the rule is simply: RIGHTMOST DIES FIRST — cwd (≥xl), then
 *      tmx (≥lg), then git (≥md); PR/fab/agt never drop. The right cluster
 *      drops the hints (≥xl), then ld (≥lg), then cpu/mem (≥md), then
 *      version (≥700px); the connection dot never drops. The clusters
 *      degrade independently (separate sides of the `ml-auto` flex).
 *   3. A trailing `…` chevron (the top-bar `menuOnly` row pattern) lists every
 *      dropped segment — each menu row carries the INVERSE breakpoint class of
 *      its strip segment, so a row appears exactly when its segment is hidden.
 * Only the ~700–1100px band needs to survive: below 640px the mobile branch
 * renders no bar.
 */

/** The bar's fixed height — VS Code-class status strip. */
const BAR_HEIGHT = "h-[24px]";

const LABEL_CLASS = "text-text-secondary";
const VALUE_CLASS = "text-text-primary";

/** A plain text segment: dimmed 3-char-ish prefix + value. The outer span is
 *  `min-w-0` so the value's truncation actually engages in the ladder's
 *  compress-in-place stage (a flex item's default min-width is its content —
 *  without this the strip overflows instead of truncating). */
function Segment({
  label,
  tip,
  className = "",
  valueClassName = VALUE_CLASS,
  children,
}: {
  label: string;
  tip: string;
  className?: string;
  valueClassName?: string;
  children: ReactNode;
}) {
  return (
    <Tip label={tip} placement="top">
      <span className={`flex items-center gap-1 min-w-0 whitespace-nowrap ${className}`}>
        <span className={`${LABEL_CLASS} shrink-0`}>{label}</span>
        <span className={`min-w-0 truncate ${valueClassName}`}>{children}</span>
      </span>
    </Tip>
  );
}

/** Host-metrics hover flyout (R4) — the cpu sparkline + mem bar graphs demote
 *  to this card on the compact metrics segment, following the sidebar
 *  row-flyout-card pattern (floating-ui hover/focus card in a portal). The
 *  content is the SHARED `HostMetrics` component, so the graphs can never
 *  drift from the (drawer-only) HOST panel. Non-interactive content, so no
 *  FloatingFocusManager; keyboard reachability comes from `useFocus` on the
 *  tabbable trigger (Constitution V). */
function MetricsFlyout({
  metrics,
  className = "",
  children,
}: {
  metrics: MetricsSnapshot;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "top",
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const hover = useHover(context, {
    mouseOnly: true,
    move: false,
    delay: { open: 300, close: 0 },
    handleClose: safePolygon(),
  });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss]);
  return (
    <>
      <span
        ref={refs.setReference}
        tabIndex={0}
        aria-label="Host metrics — details on hover"
        className={`items-center gap-1.5 whitespace-nowrap outline-none focus-visible:outline-2 focus-visible:outline-accent-green ${className}`}
        {...getReferenceProps()}
      >
        {children}
      </span>
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 w-[240px] rounded-md border border-border bg-bg-primary p-2 shadow-lg"
          >
            <HostMetrics metrics={metrics} />
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

/** The normalized 1-minute load percentage (the shared HostMetrics rule). */
function loadPercent(m: MetricsSnapshot): number {
  return normalizeLoadPercent(m.load.avg1, m.load.cpus);
}

/** LEFT cluster (terminal route only) — the current window's registers,
 *  resolved by the shared `sidebar/registers.ts` helpers + the PANE panel's
 *  identity-row sources. */
function WindowCluster({ win }: { win: WindowInfo }) {
  const activePane = win.panes?.find((p) => p.isActive);
  const paneCount = win.panes?.length ?? 0;
  const paneId = activePane?.paneId ?? "";
  const tmxValue = `pane ${(activePane?.paneIndex ?? 0) + 1}/${paneCount}${paneId ? ` ${paneId}` : ""}`;
  const cwdFull = activePane?.cwd ?? win.worktreePath;
  const cwdMissing = activePane?.cwdMissing ?? false;
  const cwdBase = cwdFull.split("/").filter(Boolean).pop() ?? cwdFull;
  const gitBranch = activePane?.gitBranch ?? "";
  const agtLine = getAgentLine(win);
  const fabLine = getFabLine(win);
  const prSegments = getPrSegments(win);

  return (
    <div className="flex items-center gap-3 min-w-0" data-testid="status-bar-window">
      {/* DESCENDING relevance, branch-first (the stable anchor — pr/fab/agt
          are volatile per-window). Display order equals survival order, so
          the ladder is one rule: rightmost dies first — cwd (≥xl) → tmx
          (≥lg) → git (≥md); agt/fab/PR never drop from the strip (they
          truncate or ride the bar to 640px). */}
      {gitBranch && (
        <Segment label="⑂" tip="Git branch" className="hidden md:flex">
          {gitBranch}
        </Segment>
      )}
      {prSegments &&
        (win.prUrl ? (
          // Open-first (the PANE panel's PrLinkRow rule): a real anchor, so
          // middle-click / Ctrl-⌘-click / copy-link all work natively.
          <a
            href={win.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={win.prUrl}
            aria-label={`Open PR #${win.prNumber} in a new tab`}
            className="flex items-center gap-1 min-w-0 whitespace-nowrap hover:text-accent"
          >
            <span className={`${LABEL_CLASS} shrink-0`}>pr</span>
            <span className="flex items-center gap-1 min-w-0 truncate">
              {prSegments.map((seg, i) => (
                <span key={i} className="flex items-center gap-1 min-w-0">
                  {i > 0 && <span aria-hidden="true" className="text-text-secondary">·</span>}
                  <span className={seg.color}>{seg.text}</span>
                </span>
              ))}
            </span>
            <span aria-hidden="true" className="text-text-secondary shrink-0">
              ↗
            </span>
          </a>
        ) : (
          <span className="flex items-center gap-1 min-w-0 whitespace-nowrap">
            <span className={`${LABEL_CLASS} shrink-0`}>pr</span>
            <span className="flex items-center gap-1 min-w-0 truncate">
              {prSegments.map((seg, i) => (
                <span key={i} className="flex items-center gap-1 min-w-0">
                  {i > 0 && <span aria-hidden="true" className="text-text-secondary">·</span>}
                  <span className={seg.color}>{seg.text}</span>
                </span>
              ))}
            </span>
          </span>
        ))}
      {fabLine && (
        <Segment label="fab" tip="Fab change">
          {fabLine}
        </Segment>
      )}
      {agtLine && (
        <span className="flex items-center gap-1.5 min-w-0 whitespace-nowrap">
          <StatusDot win={win} />
          <Tip label="Agent state" placement="top">
            <span className="flex items-center gap-1 min-w-0">
              <span className={`${LABEL_CLASS} shrink-0`}>agt</span>
              <span className={`min-w-0 truncate ${VALUE_CLASS}`}>{agtLine}</span>
            </span>
          </Tip>
        </span>
      )}
      <Segment label="tmx" tip="tmux pane" className="hidden lg:flex">
        {tmxValue}
      </Segment>
      <Segment label="cwd" tip={cwdMissing ? `${cwdFull} (no longer exists)` : cwdFull} className="hidden xl:flex">
        <span className={cwdMissing ? "text-signal-red" : undefined}>
          {cwdBase}
          {cwdMissing ? " (deleted)" : ""}
        </span>
      </Segment>
    </div>
  );
}

/** The `…` overflow menu (R5 stage 3) — the top-bar `menuOnly` row pattern:
 *  a fixed-position `role="menu"` panel anchored to the chevron's viewport
 *  rect (so no ancestor `overflow-hidden` clips it), Escape / outside
 *  mousedown closes. Rows carry the INVERSE breakpoint class of their strip
 *  segment, so a row renders exactly while its segment is dropped.
 *
 *  Keyboard (`top-bar-overflow-menu.tsx`'s contract): focus enters the panel on
 *  open, ArrowUp/ArrowDown rove between rows, Escape closes and returns focus
 *  to the chevron. Most rows here are INFORMATIONAL spans rather than actions,
 *  so roving focus is what makes them readable at all — a `role="menuitem"`
 *  that never receives focus is unreachable for keyboard and screen-reader
 *  users (Constitution V). */
function OverflowMenu({
  win,
  metrics,
  version,
  onOpenCompose,
}: {
  win: WindowInfo | null;
  metrics: MetricsSnapshot | null;
  version: string | null;
  onOpenCompose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ bottom: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // The menu's rows in DOM (= visual) order, dropping the ones a breakpoint
  // class currently hides — a `display: none` row cannot take focus, so
  // including it would strand arrow-nav on a dead index. `checkVisibility` is
  // absent under jsdom, where no breakpoint CSS is loaded and every row is
  // genuinely rendered, so treating it as visible there is correct.
  const rows_ = useCallback((): HTMLElement[] => {
    const menu = menuRef.current;
    if (!menu) return [];
    return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter((el) =>
      typeof el.checkVisibility === "function" ? el.checkVisibility() : true,
    );
  }, []);

  // Move focus by `delta` (+1 down, -1 up), wrapping at both ends. Anchors off
  // the focused row's position so navigation stays stable as rows appear and
  // disappear across breakpoints.
  const moveFocus = useCallback(
    (delta: number) => {
      const items = rows_();
      if (items.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const curr = active ? items.indexOf(active) : -1;
      const base = curr === -1 ? (delta > 0 ? -1 : 0) : curr;
      items[(base + delta + items.length) % items.length]?.focus();
    },
    [rows_],
  );

  // On open, move focus into the panel (the canonical menu pattern — rows keep
  // `tabIndex={-1}` and are reached programmatically from here and arrow-nav).
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => rows_()[0]?.focus());
  }, [open, rows_]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        moveFocus(1);
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        moveFocus(-1);
      }
    }
    function onMouseDown(e: MouseEvent) {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [open, moveFocus]);

  const activePane = win?.panes?.find((p) => p.isActive);
  const cwdFull = activePane?.cwd ?? win?.worktreePath ?? "";
  const cwdBase = cwdFull.split("/").filter(Boolean).pop() ?? cwdFull;
  const gitBranch = activePane?.gitBranch ?? "";

  const textRow = (key: string, text: string, showClass: string) => (
    <span
      key={key}
      role="menuitem"
      tabIndex={-1}
      className={`${MENU_ROW_CLASS} focus-visible:outline-2 focus-visible:outline-accent ${showClass}`}
    >
      {text}
    </span>
  );

  const rows: ReactNode[] = [];
  if (win) {
    // Inverse of the strip: a row appears exactly while its segment is
    // hidden, in strip order (git → tmx → cwd) so the menu reads as the
    // strip's continuation.
    if (gitBranch) rows.push(textRow("git", `⑂ ${gitBranch}`, "md:hidden"));
    rows.push(
      textRow(
        "tmx",
        `tmx pane ${(activePane?.paneIndex ?? 0) + 1}/${win.panes?.length ?? 0}${activePane?.paneId ? ` ${activePane.paneId}` : ""}`,
        "lg:hidden",
      ),
    );
    rows.push(textRow("cwd", `cwd ${cwdBase}`, "xl:hidden"));
    // agt/fab/PR never drop from the strip, so they never need a menu row.
  }
  if (metrics) {
    rows.push(textRow("ld", `ld ${loadPercent(metrics)}%`, "lg:hidden"));
    rows.push(
      textRow("cpu", `cpu ${Math.round(metrics.cpu.current)}% · mem ${formatMemory(metrics.memory.used, metrics.memory.total)}`, "md:hidden"),
    );
  }
  if (version) {
    // The version fragment drops below 700px — its row mirrors that gate.
    rows.push(textRow("version", version, "min-[700px]:hidden"));
  }
  // The ⌘K / compose hints drop below xl — their menu rows keep the ACTIONS
  // (the top-bar menuOnly rule: the full set stays one click away at any
  // width, palette parity included).
  const actionRow = (key: string, label: string, onClick: () => void) => (
    <button
      key={key}
      type="button"
      role="menuitem"
      tabIndex={-1}
      className={`${MENU_ROW_CLASS} xl:hidden`}
      onClick={() => {
        setOpen(false);
        onClick();
      }}
    >
      {label}
    </button>
  );
  rows.push(
    actionRow("palette", "⌘K Command palette", () =>
      document.dispatchEvent(new CustomEvent("palette:open")),
    ),
  );
  if (onOpenCompose) rows.push(actionRow("compose", "a▏ Compose text", onOpenCompose));

  return (
    <div className="relative flex items-center xl:hidden">
      <button
        ref={buttonRef}
        type="button"
        aria-label="More status segments"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="status-bar-overflow"
        className="rk-glint rounded border border-border px-1.5 text-text-secondary transition-colors hover:border-text-secondary"
        onClick={() => {
          if (!open && buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            setMenuPos({ bottom: window.innerHeight - rect.top + 4, right: window.innerWidth - rect.right });
          }
          setOpen((v) => !v);
        }}
      >
        …
      </button>
      {open && menuPos && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Overflow status segments"
          className="fixed z-50 flex min-w-[180px] flex-col rounded-md border border-border bg-bg-primary py-1 shadow-2xl"
          style={{ bottom: menuPos.bottom, right: menuPos.right }}
        >
          {rows}
        </div>
      )}
    </div>
  );
}

export type StatusBarProps = {
  /** The current window record (terminal route); null elsewhere — the left
   *  cluster renders only with a window. */
  window: WindowInfo | null;
  /** The current tmux server name; null/undefined off-server routes (board). */
  server?: string | null;
  /** Connection state for the terminator dot (the sidebar footer's rule). */
  isConnected: boolean;
  /** Compose-strip opener (the relocated bottom-bar `a▏` chip action). */
  onOpenCompose?: () => void;
};

export function StatusBar({ window: win, server, isConnected, onOpenCompose }: StatusBarProps) {
  // Leaf subscriptions (the HostPanel precedent): BOTH hooks are called
  // unconditionally and coalesced AFTER (`??` directly between hook calls
  // would short-circuit the second hook once server metrics arrive — a
  // Rules-of-Hooks violation). Server-scoped metrics win, host-global
  // broadcast is the every-route fallback; version via the tolerant
  // update-notification seam (null until the first `version` event — the
  // fragment is omitted rather than rendering "vundefined").
  const serverMetrics = useMetrics();
  const hostMetrics = useHostMetrics();
  const metrics = serverMetrics ?? hostMetrics;
  const { daemonVersion } = useUpdateNotification();
  const { composeStripEnabled } = useChromeState();
  // Instance display name (o7q8): the host segment shows the settings override
  // over the metrics-reported hostname — display-only, the HOST panel's rule.
  const { instanceName } = useInstanceName();
  // Registry-resolved chords for the hint tips (the bottom-bar chip pattern,
  // 260801-mqim): reflect rebinds, omitted when unbound/disabled.
  const { byAction: keybindingsByAction, host: keybindingHost } = useKeybindings();
  const chordFor = (actionId: string) => {
    const binding = keybindingsByAction.get(actionId);
    return binding?.enabled
      ? formatCombo({ code: binding.code, tier: binding.tier }, keybindingHost.platform)
      : undefined;
  };

  const version = daemonVersion ? displayVersion(daemonVersion) : null;
  const hostName = instanceName ?? metrics?.hostname ?? null;

  return (
    <div
      role="region"
      aria-label="Status bar"
      data-testid="status-bar"
      className={`${BAR_HEIGHT} flex items-center gap-3 overflow-hidden border-t border-border bg-bg-primary px-2 font-mono text-[10.5px] leading-none`}
    >
      {/* LEFT — the current-window mirror (terminal route only). */}
      {win && <WindowCluster win={win} />}

      {/* RIGHT — host-scoped, every desktop route. Death order (R5): hints
          (≥xl) → ld (≥lg) → cpu/mem (≥md) → version (≥700px); the connection
          dot never drops. */}
      <div className="ml-auto flex items-center gap-3 min-w-0" data-testid="status-bar-host">
        {metrics && (
          <MetricsFlyout metrics={metrics} className="hidden md:flex min-w-0">
            <span className={LABEL_CLASS}>cpu</span>
            <span className={VALUE_CLASS}>{Math.round(metrics.cpu.current)}%</span>
            <span className={LABEL_CLASS}>mem</span>
            <span className={gaugeColor((metrics.memory.used / Math.max(metrics.memory.total, 1)) * 100)}>
              {formatMemory(metrics.memory.used, metrics.memory.total)}
            </span>
            <span className={`${LABEL_CLASS} hidden lg:inline`}>ld</span>
            <span className={`${VALUE_CLASS} hidden lg:inline`}>{loadPercent(metrics)}%</span>
          </MetricsFlyout>
        )}
        {server && (
          <span className="min-w-0 truncate whitespace-nowrap text-text-secondary">{server}</span>
        )}
        {(hostName || version) && (
          <span className="min-w-0 truncate whitespace-nowrap">
            {hostName && <span className="text-text-secondary">{hostName}</span>}
            {version && (
              <span className={`${VALUE_CLASS} hidden min-[700px]:inline`}>
                {hostName ? " " : ""}
                {version}
              </span>
            )}
          </span>
        )}
        {/* ⌘K / compose hints — the deleted fine-pointer bottom bar's two
            useful desktop affordances, relocated (R4). Clickable, with palette
            parity (the palette entries are the keyboard-first path; the PR
            segment's parity is the palette's Open PR action). */}
        <Tip label="Command palette" kbd={chordFor("command-palette")} placement="top">
          <button
            type="button"
            aria-label="Open command palette"
            className="hidden xl:flex items-center rounded border border-border px-1 text-text-secondary transition-colors hover:border-text-secondary"
            onClick={() => document.dispatchEvent(new CustomEvent("palette:open"))}
          >
            <kbd aria-hidden="true">{"\u2318K"}</kbd>
          </button>
        </Tip>
        {onOpenCompose && (
          <Tip label="Compose text" kbd={chordFor("compose-toggle")} placement="top">
            <button
              type="button"
              aria-label="Compose text"
              aria-pressed={composeStripEnabled}
              data-testid="status-bar-compose"
              className={`hidden xl:flex items-center rounded border px-1 transition-colors ${
                composeStripEnabled
                  ? "border-accent bg-accent/20 text-accent"
                  : "border-border text-text-secondary hover:border-text-secondary"
              }`}
              onClick={onOpenCompose}
            >
              <span aria-hidden="true">
                a<span className={composeStripEnabled ? "rk-compose-caret" : undefined}>{"▏"}</span>
              </span>
            </button>
          </Tip>
        )}
        <OverflowMenu win={win} metrics={metrics} version={version} onOpenCompose={onOpenCompose} />
        {/* The connection dot is the right-most status terminator (the sidebar
            footer's vocabulary) and never drops. */}
        <span role="status" aria-live="polite" className="flex items-center">
          <Tip label={isConnected ? "Connected" : "Disconnected"} placement="top">
            <span
              className={`block h-2 w-2 rounded-full ${isConnected ? "bg-accent-green" : "bg-text-secondary"}`}
              aria-label={isConnected ? "Connected" : "Disconnected"}
            />
          </Tip>
        </span>
      </div>
    </div>
  );
}
