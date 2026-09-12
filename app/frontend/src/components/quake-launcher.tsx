import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useKeybindings } from "@/hooks/use-keybindings";
import { formatCombo } from "@/lib/keybindings";
import { SessionContext } from "@/contexts/session-context";
import { OperatorContextChip } from "@/components/operator-context-chip";
import {
  OPERATOR_STATE_DOT,
  attachOperatorFiles,
  resolveQuakeTerminalTarget,
  sendOperatorMessage,
  setQuakeMachineState,
  setOperatorComposeText,
  useQuakeMachineState,
  useOperatorCompose,
} from "@/lib/quake-terminal";

/** The wide-desktop rung (tailwind `lg`) — the standing quake launcher
 *  replaces the
 *  ghost/morph pair at and above it. Subscribed for render (the `engaged`
 *  chrome rule below). */
const WIDE_RUNG_QUERY = "(min-width: 1024px)";

/** The extra-wide rung (tailwind `2xl`) — the only width where the standing
 *  box takes its full rest width and long placeholder. */
const EXTRA_WIDE_RUNG_QUERY = "(min-width: 1536px)";

function OperatorStateGlyph({
  agentState,
  showDot = true,
}: {
  agentState: string | undefined;
  showDot?: boolean;
}) {
  return (
    <span aria-hidden="true" className="relative inline-flex shrink-0 text-xs text-text-secondary">
      ◉
      {showDot && agentState && (
        <span
          data-testid="quake-launcher-state"
          data-state={agentState}
          className={`absolute -bottom-0.5 -right-0.5 block h-2 w-2 rounded-full border border-bg-primary ${
            OPERATOR_STATE_DOT[agentState] ?? "bg-text-secondary"
          }`}
        />
      )}
    </span>
  );
}

/**
 * The quake launcher — the quake terminal's compose relocated into the top
 * bar's
 * center cell (desktop only; on mobile the quake terminal's seam arm
 * navigates to
 * the operator window's terminal route and nothing renders here). One
 * component at two widths:
 *
 *  - ≥ lg: a STANDING bordered input (`◉` glyph with the resolved operator's
 *    live state dot, plus a chord keycap) beside the
 *    compact heading. Slim at rest — `12ch` with the short "Ask…"
 *    placeholder, widening to `20ch` + the full "Ask the operator…"
 *    placeholder only at ≥ 2xl, so the standing box never eats the crumbs'
 *    min-useful-width at `lg`/`xl` (the box grows meaning on focus, not at
 *    rest). The short form does not repeat the `◉` — the standing glyph
 *    beside the input already names the operator, and a second glyph plus
 *    ellipsis reads as a truncated label. The placeholder gate is width-only,
 *    never `engaged`: the mounted context chip leaves the engaged input
 *    ~12ch, where the long form would clip mid-word.
 *  - md–lg: a dim `· ◉ ask` ghost carrying the same state dot that (on click,
 *    or when the chord engages the machine) morphs the center into the same
 *    box in place; Esc, the chord, or an outside click restores the heading.
 *
 * The box IS the quake terminal compose — draft, send, and image-paste
 * upload ride
 * the shared seam in lib/quake-terminal.ts. Enter (non-empty) sends through
 * the `target:"agent"` lane with focus retained for follow-ups; the ⌘J
 * two-state machine (rest ⇄ open — focus and drawer linked) owns focus:
 * entering the machine from rest focuses the box and selects any draft,
 * returning to rest blurs and restores the previously focused element — under
 * two invariants, both load-bearing. An origin INSIDE the box is never
 * recorded (a mouse entry focuses the input before the machine transitions, so
 * an unguarded capture would name the box itself and the restore would re-focus
 * it, whose onFocus re-enters the machine — a loop with no release), and the
 * restore runs only while the box STILL owns focus (a release caused by the
 * user focusing a terminal pane already has its owner; overriding it steals the
 * keystrokes). Escape is NOT handled here — the quake terminal's document
 * listener
 * owns the release so a single Esc can never double-step. Blur is not a
 * release either: the open drawer is a peek that outlives the box's focus
 * (clicking into its terminal must not collapse it) — the quake terminal's
 * outside-click collapse owns click-away.
 *
 * Two derived flags, deliberately not one: `morphed` (machine-derived, the same
 * value the top bar calls `launcherMorphed`) says the box is RENDERED in place
 * of the heading; `engaged` says it LOOKS like it owns input. They diverge at
 * `open` whenever a blur has left the drawer standing — a machine-derived
 * chrome would claim focus the box no longer has.
 *
 * The wrapper carries the quake-terminal root attribute so the route
 * terminals'
 * document-level file-paste forward skips launcher-origin pastes (the box
 * owns
 * its own file path: paste an image and it uploads to the operator window's
 * session, insert-staged into the TUI composer).
 */
export function QuakeLauncher({ routeServer }: { routeServer: string | null }) {
  const isMobile = useIsMobile();
  const wide = useMediaQuery(WIDE_RUNG_QUERY);
  const extraWide = useMediaQuery(EXTRA_WIDE_RUNG_QUERY);
  const machine = useQuakeMachineState();
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
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxFocused, setBoxFocused] = useState(false);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const machineRef = useRef(machine);
  machineRef.current = machine;
  const textRef = useRef(compose.text);
  textRef.current = compose.text;

  const binding = byAction.get("quake-terminal");
  const chord = binding?.enabled
    ? formatCombo({ code: binding.code, tier: binding.tier }, host.platform)
    : undefined;

  // Focus ownership: entering the machine from rest moves focus into the box
  // (draft selected); returning to rest blurs the box and restores the
  // previously focused element.
  const prevMachineRef = useRef(machine);
  useEffect(() => {
    const prev = prevMachineRef.current;
    prevMachineRef.current = machine;
    if (machine !== "rest" && prev === "rest") {
      // Only an origin OUTSIDE the box is a restore target. A mouse entry
      // focuses the input before this transition, so an unguarded capture
      // records the box itself — and the release below would then re-focus it,
      // whose onFocus re-enters the machine: a loop the user cannot escape,
      // not even with Esc.
      const origin = document.activeElement;
      restoreFocusRef.current =
        origin instanceof HTMLElement && !boxRef.current?.contains(origin) ? origin : null;
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    } else if (machine === "rest" && prev !== "rest") {
      const el = restoreFocusRef.current;
      restoreFocusRef.current = null;
      // The box hands focus back only when it still HAS it — the release came
      // from Esc, the chord, or the collapse button. A release caused by the user focusing
      // something else (a terminal pane) already has its owner; acting here
      // would steal the keystrokes it is about to receive.
      if (document.activeElement !== inputRef.current) return;
      inputRef.current?.blur();
      if (el?.isConnected) el.focus();
    }
  }, [machine]);

  if (isMobile) return null;

  // The box is RENDERED in place of the heading (the top bar keys its own
  // heading hiding on the same value, as `launcherMorphed`).
  const morphed = machine !== "rest";
  // The box LOOKS like it owns input. Below `lg` the morph keeps it lit even
  // while unfocused: the box stands where the heading was for as long as the
  // machine is engaged, so the in-place morph never reads as half-dismissed.
  const engaged = morphed && (boxFocused || !wide);

  return (
    <>
      {/* The md–lg ghost: the dim affordance whose click morphs the center
          into the box. Rendered only in the md–lg band — at ≥ lg the box
          stands instead, and below md the 640px no-overlap budget (nav floor
          + hamburger against the anchored heading) has no room for it; the
          chord/palette still morph the box in place there. Hidden while the
          machine is engaged (the box is showing). */}
      {!morphed && (
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
      <div
        ref={boxRef}
        data-quake-terminal=""
        data-testid="quake-launcher"
        className={`${
          // Engaged, the box widens to hold the draft plus the capped chip;
          // at rest it stays the slim standing width. Height is fixed at the
          // shared bar control height (--ctl-h-bar) in both states — the box
          // must never resize on focus/blur, so mounting the context chip
          // can't jitter the top bar (the chip's own dismiss button is sized
          // to fit this budget; see operator-context-chip.tsx). Hand-spelled
          // rather than `controlClass({ variant: "icon", box: "height" })`:
          // that recipe's `coarse:h-[40px]` half would need its own
          // coarse-pointer chip-budget accounting this box doesn't yet do —
          // fine-only is the deliberate scope of this fix.
          engaged ? "flex w-[34ch]" : "hidden lg:flex w-[12ch] 2xl:w-[20ch]"
        } ml-2 max-w-[40vw] items-center gap-1.5 rounded border px-2 h-[28px] ${
          engaged ? "border-accent-green" : "border-border"
        }`}
      >
        <OperatorStateGlyph agentState={agentState} showDot={wide || morphed} />
        <input
          ref={inputRef}
          type="text"
          value={compose.text}
          data-testid="quake-launcher-input"
          placeholder={extraWide ? "Ask the operator…" : "Ask…"}
          aria-label="Ask the operator"
          onChange={(e) => setOperatorComposeText(e.target.value)}
          onFocus={() => {
            setBoxFocused(true);
            // Clicking into the standing box engages the machine — focus and
            // the drawer are linked, so entry lands directly at `open`.
            if (machineRef.current === "rest") setQuakeMachineState("open");
          }}
          onBlur={(e) => {
            // Focus moving WITHIN the box (the context chip's ✕, the keycap)
            // is not a release — standing down here would unmount the chip
            // before its click lands, making dismissal impossible by mouse.
            if (
              e.relatedTarget instanceof Node &&
              boxRef.current?.contains(e.relatedTarget)
            ) {
              return;
            }
            setBoxFocused(false);
            // Blur never steps the machine: the open drawer is a peek that
            // outlives the box's focus (clicking into its terminal must not
            // collapse it). The quake terminal's outside-click collapse and
            // Esc own
            // the release.
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
        {/* The chat-lane context chip — shown only while the machine is
            engaged (composing), so the resting box stays slim; the user sees
            what a send will attach before pressing Enter. */}
        {engaged && <OperatorContextChip server={server} compact />}
        {chord && (
          <kbd
            aria-hidden="true"
            className="shrink-0 rounded border border-border px-1 text-[10px] leading-4 text-text-secondary"
          >
            {chord}
          </kbd>
        )}
      </div>
    </>
  );
}
