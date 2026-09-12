import { useContext, useEffect, useMemo, useRef } from "react";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useKeybindings } from "@/hooks/use-keybindings";
import { formatCombo } from "@/lib/keybindings";
import { SessionContext } from "@/contexts/session-context";
import { OperatorStateGlyph } from "@/components/operator-state-glyph";
import {
  attachOperatorFiles,
  isQuakeTerminalTarget,
  resolveQuakeTerminalTarget,
  sendOperatorMessage,
  setQuakeMachineState,
  setQuakeRestoreOrigin,
  setOperatorComposeText,
  useQuakeComposeEngaged,
  useQuakeMachineState,
  useOperatorCompose,
} from "@/lib/quake-terminal";

/** The wide-desktop rung (tailwind `lg`) — the standing quake launcher box
 *  exists at and above it; below it the md–lg ghost stands instead. */
const WIDE_RUNG_QUERY = "(min-width: 1024px)";

/** The extra-wide rung (tailwind `2xl`) — the only width where the standing
 *  box takes its full rest width and long placeholder. */
const EXTRA_WIDE_RUNG_QUERY = "(min-width: 1536px)";

/**
 * The quake launcher — the quake terminal's standing affordance in the top
 * bar's center cell (desktop only; on mobile the quake terminal's seam arm
 * navigates to the operator window's terminal route and nothing renders
 * here). The launcher is a LAUNCHER: the compose itself docks inside the
 * drawer while it is open (the QuakeCompose strip in quake-terminal.tsx),
 * sharing the one compose seam in lib/quake-terminal.ts — same draft, same
 * send path. One component at two widths at REST:
 *
 *  - ≥ lg: a STANDING bordered input (`◉` glyph with the resolved operator's
 *    live state dot, plus a chord keycap) beside the
 *    compact heading. Slim — `12ch` with the short "Ask…"
 *    placeholder, widening to `20ch` + the full "Ask the operator…"
 *    placeholder only at ≥ 2xl, so the standing box never eats the crumbs'
 *    min-useful-width at `lg`/`xl`. The short form does not repeat the `◉` —
 *    the standing glyph beside the input already names the operator, and a
 *    second glyph plus ellipsis reads as a truncated label. A draft left in
 *    the shared store (a failed send, an unsent message) shows here.
 *  - md–lg: a dim `· ◉ ask` ghost carrying the same state dot whose click
 *    opens the drawer. Below md nothing renders — the 640px no-overlap
 *    budget (nav floor + hamburger against the anchored heading) has no room
 *    — but the chord/palette still open the drawer there.
 *
 * While the machine is OPEN both rungs collapse to one control (glyph +
 * chord): a click re-focuses the docked textarea (the machine is already
 * open — the action is the focus). The collapsed control carries the accent
 * border while the shared `engaged` slot says the compose owns input — a
 * focus-derived flag, so pinned-and-unfocused renders plain.
 *
 * Enter in the standing box (non-empty draft) sends through the seam and
 * opens the drawer; clicking or tabbing into it opens the drawer too
 * (`onFocus → open`), and focus then moves to the docked textarea — the box
 * collapses under the pointer by design. Escape is NOT handled here — the
 * quake terminal's document listener owns the release so a single Esc can
 * never double-step. Blur is not a release either: the open drawer is a peek
 * that outlives any one element's focus — the quake terminal's outside-click
 * collapse owns click-away.
 *
 * Focus ownership's invariant (a) lives here: at machine entry (rest → open)
 * the restore origin is captured into the lib's slot ONLY when the active
 * element lies outside every quake-terminal-owned element
 * (`isQuakeTerminalTarget`) — a mouse entry focuses the standing input BEFORE
 * `onFocus` transitions the machine, so an unguarded capture would name the
 * box itself. The ownership-gated return (invariant (b)) lives in the
 * drawer's own machine-follower effect.
 *
 * The wrapper carries the quake-terminal root attribute so the route
 * terminals' document-level file-paste forward skips launcher-origin pastes
 * (the box owns its own file path: paste an image and it uploads to the
 * operator window's session, insert-staged into the TUI composer).
 */
export function QuakeLauncher({ routeServer }: { routeServer: string | null }) {
  const isMobile = useIsMobile();
  const wide = useMediaQuery(WIDE_RUNG_QUERY);
  const extraWide = useMediaQuery(EXTRA_WIDE_RUNG_QUERY);
  const machine = useQuakeMachineState();
  const engaged = useQuakeComposeEngaged();
  const compose = useOperatorCompose();
  // The route server arrives as a prop: the TopBar already carries it, and
  // this component must not pull router hooks the bar's test harness doesn't
  // mock. Tolerant of a missing
  // SessionProvider — degrades to "no operator", never crashes.
  const ctx = useContext(SessionContext);
  const lastViewedRef = useRef<string | null>(null);
  if (routeServer) lastViewedRef.current = routeServer;
  const servers = ctx?.servers ?? [];
  const sessionsByServer = ctx?.sessionsByServer;
  const { server, target } = useMemo(
    () =>
      resolveQuakeTerminalTarget(
        routeServer,
        servers.map((s) => s.name),
        sessionsByServer,
        lastViewedRef.current,
      ),
    [routeServer, servers, sessionsByServer],
  );
  const agentState = target?.window.agentState;
  const { byAction, host } = useKeybindings();
  const machineRef = useRef(machine);
  machineRef.current = machine;
  const textRef = useRef(compose.text);
  textRef.current = compose.text;

  const binding = byAction.get("quake-terminal");
  const chord = binding?.enabled
    ? formatCombo({ code: binding.code, tier: binding.tier }, host.platform)
    : undefined;

  // Invariant (a): entering the machine from rest records the restore origin
  // — the previously focused element — into the lib's slot, kept only when it
  // lies outside every quake-terminal-owned element. The drawer focuses its
  // docked textarea a commit later, and the exit-time restore (the drawer's
  // ownership-gated effect) reads this slot.
  const prevMachineRef = useRef(machine);
  useEffect(() => {
    const prev = prevMachineRef.current;
    prevMachineRef.current = machine;
    if (machine !== "rest" && prev === "rest") {
      const origin = document.activeElement;
      setQuakeRestoreOrigin(
        origin instanceof HTMLElement && !isQuakeTerminalTarget(origin) ? origin : null,
      );
    }
  }, [machine]);

  if (isMobile) return null;

  // Wherever the launcher renders something at rest (≥ lg box, md–lg ghost),
  // it renders the collapsed control instead while the drawer is open.
  const open = machine === "open";

  return (
    <>
      {/* The md–lg ghost: the dim affordance whose click opens the drawer.
          Rendered only in the md–lg band — at ≥ lg the box stands instead,
          and below md the 640px no-overlap budget (nav floor + hamburger
          against the anchored heading) has no room for it; the chord/palette
          still open the drawer there. */}
      {!open && (
        <button
          type="button"
          data-testid="quake-launcher-ghost"
          aria-label="Ask the operator"
          onClick={() => setQuakeMachineState("open")}
          className="hidden md:inline-flex lg:hidden ml-2 shrink-0 items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
        >
          <span aria-hidden="true">·</span>
          <OperatorStateGlyph agentState={agentState} showDot={!wide} />
          <span aria-hidden="true">ask</span>
        </button>
      )}
      {open ? (
        // The collapsed control: glyph + chord, a click re-focuses the docked
        // compose textarea. It carries the quake-terminal root attribute so
        // its click is recognised as quake-owned (not an outside click that
        // would collapse the drawer); the same-value machine re-assertion
        // bumps the activity counter the settle check honours. The accent
        // border mirrors the compose's engaged flag — chrome never claims
        // focus it lacks.
        <button
          type="button"
          data-quake-terminal=""
          data-testid="quake-launcher-collapsed"
          aria-label="Focus quake terminal compose"
          onClick={() => {
            setQuakeMachineState("open");
            const el = document.querySelector('[data-testid="quake-terminal-compose-input"]');
            if (el instanceof HTMLElement) el.focus();
          }}
          className={`hidden md:inline-flex ml-2 shrink-0 h-[28px] items-center gap-1 rounded border px-1.5 ${
            engaged ? "border-accent-green" : "border-border"
          }`}
        >
          <OperatorStateGlyph agentState={agentState} />
          {chord && (
            <kbd
              aria-hidden="true"
              className="shrink-0 rounded border border-border px-1 text-[10px] leading-4 text-text-secondary"
            >
              {chord}
            </kbd>
          )}
        </button>
      ) : (
        <div
          data-quake-terminal=""
          data-testid="quake-launcher"
          className={
            // Slim standing width at rest — the box never grows on focus (the
            // compose lives in the drawer now), so the top bar never reflows.
            // Height is fixed at the shared bar control height (--ctl-h-bar).
            // Hand-spelled rather than `controlClass({ variant: "icon", box:
            // "height" })`: that recipe's `coarse:h-[40px]` half would need
            // its own coarse-pointer accounting this box doesn't do.
            "hidden lg:flex w-[12ch] 2xl:w-[20ch] ml-2 max-w-[40vw] items-center gap-1.5 rounded border px-2 h-[28px] border-border"
          }
        >
          <OperatorStateGlyph agentState={agentState} showDot={wide} />
          <input
            type="text"
            value={compose.text}
            data-testid="quake-launcher-input"
            placeholder={extraWide ? "Ask the operator…" : "Ask…"}
            aria-label="Ask the operator"
            onChange={(e) => setOperatorComposeText(e.target.value)}
            onFocus={() => {
              // Clicking into the standing box engages the machine — focus and
              // the drawer are linked, so entry lands directly at `open`, and
              // the drawer's focus-on-open then moves focus to the docked
              // textarea.
              if (machineRef.current === "rest") setQuakeMachineState("open");
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              const value = textRef.current;
              if (value.trim() === "") return;
              void sendOperatorMessage(server, target, value);
              setQuakeMachineState("open");
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files ?? []);
              if (files.length === 0) return;
              e.preventDefault();
              void attachOperatorFiles(server, target, files);
            }}
            className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-secondary"
          />
          {chord && (
            <kbd
              aria-hidden="true"
              className="shrink-0 rounded border border-border px-1 text-[10px] leading-4 text-text-secondary"
            >
              {chord}
            </kbd>
          )}
        </div>
      )}
    </>
  );
}
