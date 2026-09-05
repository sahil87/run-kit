import { useContext, useEffect, useMemo, useRef } from "react";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { evaluateMediaQuery, useMediaQuery } from "@/hooks/use-media-query";
import { useKeybindings } from "@/hooks/use-keybindings";
import { formatCombo } from "@/lib/keybindings";
import { SessionContext } from "@/contexts/session-context";
import {
  attachOperatorFiles,
  resolveOperatorConsoleTarget,
  sendOperatorMessage,
  setConsoleMachineState,
  setOperatorComposeText,
  useConsoleMachineState,
  useOperatorCompose,
} from "@/lib/operator-console";

/** The wide-desktop rung (tailwind `lg`) — the standing omnibox replaces the
 *  ghost/morph pair at and above it. Evaluated at event time (focus/blur), so
 *  no live subscription is needed. */
const WIDE_RUNG_QUERY = "(min-width: 1024px)";

/** The extra-wide rung (tailwind `2xl`) — the only width where the standing
 *  box takes its full rest width and long placeholder. */
const EXTRA_WIDE_RUNG_QUERY = "(min-width: 1536px)";

/**
 * The operator omnibox — the console's compose relocated into the top bar's
 * center cell (desktop only; mobile keeps the sheet compose and renders
 * nothing here). One component at two widths:
 *
 *  - ≥ lg: a STANDING bordered input (`◉` glyph, a chord keycap) beside the
 *    compact heading. Slim at rest — `12ch` with the short "Ask ◉…"
 *    placeholder, widening to `20ch` + the full "Ask the operator…"
 *    placeholder only at ≥ 2xl, so the standing box never eats the crumbs'
 *    min-useful-width at `lg`/`xl` (the box grows meaning on focus, not at
 *    rest).
 *  - md–lg: a dim `· ◉ ask` ghost that (on click, or when the chord focuses
 *    the machine) morphs the center into the same box in place; Esc or an
 *    empty-draft blur restores the heading.
 *
 * The box IS the console compose — draft, send, and image-paste upload ride
 * the shared seam in lib/operator-console.ts, so nothing is duplicated with
 * the mobile sheet. Enter (non-empty) sends through the `target:"agent"` lane
 * and auto-opens the drawer with focus retained for follow-ups; the ⌘J
 * three-state machine (rest → focused → open) owns focus: entering the
 * machine from rest focuses the box and selects any draft, returning to rest
 * blurs and restores the previously focused element. Escape is NOT handled
 * here — the console's document listener steps the machine back one level so
 * a single Esc can never double-step.
 *
 * The wrapper carries the console-root attribute so the route terminals'
 * document-level file-paste forward skips omnibox-origin pastes (the box owns
 * its own file path: paste an image and it uploads to the operator window's
 * session, insert-staged into the TUI composer).
 */
export function OperatorOmnibox({ routeServer }: { routeServer: string | null }) {
  const isMobile = useIsMobile();
  const extraWide = useMediaQuery(EXTRA_WIDE_RUNG_QUERY);
  const machine = useConsoleMachineState();
  const compose = useOperatorCompose();
  // The route server arrives as a prop: the TopBar already carries it, and
  // this component must not pull router hooks the bar's test harness doesn't
  // mock (the OperatorConsoleButton precedent). Tolerant of a missing
  // SessionProvider — degrades to "no operator", never crashes.
  const ctx = useContext(SessionContext);
  const lastViewedRef = useRef<string | null>(null);
  if (routeServer) lastViewedRef.current = routeServer;
  const servers = ctx?.servers ?? [];
  const sessionsByServer = ctx?.sessionsByServer;
  const { server, target } = useMemo(
    () =>
      resolveOperatorConsoleTarget(
        routeServer,
        servers.map((s) => s.name),
        sessionsByServer,
        lastViewedRef.current,
      ),
    [routeServer, servers, sessionsByServer],
  );
  const { byAction, host } = useKeybindings();
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<Element | null>(null);
  const machineRef = useRef(machine);
  machineRef.current = machine;
  const textRef = useRef(compose.text);
  textRef.current = compose.text;

  const binding = byAction.get("operator-console");
  const chord = binding?.enabled
    ? formatCombo({ code: binding.code, tier: binding.tier }, host.platform)
    : undefined;

  // Focus ownership: entering the machine from rest moves focus into the box
  // (draft selected); returning to rest blurs the box (when it holds focus)
  // and restores the previously focused element. Intermediate steps
  // (focused ⇄ open) leave focus untouched — the peek keeps the box focused.
  const prevMachineRef = useRef(machine);
  useEffect(() => {
    const prev = prevMachineRef.current;
    prevMachineRef.current = machine;
    if (machine !== "rest" && prev === "rest") {
      restoreFocusRef.current = document.activeElement;
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    } else if (machine === "rest" && prev !== "rest") {
      if (document.activeElement === inputRef.current) inputRef.current?.blur();
      const el = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (el instanceof HTMLElement && el.isConnected) el.focus();
    }
  }, [machine]);

  if (isMobile) return null;

  const active = machine !== "rest";

  return (
    <>
      {/* The md–lg ghost: the dim affordance whose click morphs the center
          into the box. Rendered only in the md–lg band — at ≥ lg the box
          stands instead, and below md the 640px no-overlap budget (nav floor
          + hamburger against the anchored heading) has no room for it; the
          chord/palette still morph the box in place there. Hidden while the
          machine is engaged (the box is showing). */}
      {!active && (
        <button
          type="button"
          data-testid="operator-omnibox-ghost"
          aria-label="Ask the operator"
          onClick={() => setConsoleMachineState("focused")}
          className="hidden md:block lg:hidden ml-2 shrink-0 text-xs text-text-secondary hover:text-text-primary transition-colors"
        >
          · ◉ ask
        </button>
      )}
      <div
        data-operator-console=""
        data-testid="operator-omnibox"
        className={`${
          active ? "flex" : "hidden lg:flex"
        } ml-2 w-[12ch] 2xl:w-[20ch] max-w-[40vw] items-center gap-1.5 rounded border px-2 py-0.5 ${
          active ? "border-accent-green/60" : "border-border"
        }`}
      >
        <span aria-hidden="true" className="shrink-0 text-xs text-text-secondary">
          ◉
        </span>
        <input
          ref={inputRef}
          type="text"
          value={compose.text}
          data-testid="operator-omnibox-input"
          placeholder={extraWide ? "Ask the operator…" : "Ask ◉…"}
          aria-label="Ask the operator"
          onChange={(e) => setOperatorComposeText(e.target.value)}
          onFocus={() => {
            // Clicking into the standing box engages the machine.
            if (machineRef.current === "rest") setConsoleMachineState("focused");
          }}
          onBlur={() => {
            // Only the focused rung (drawer closed) ends on blur: the standing
            // box always releases; the md–lg morph holds while a draft exists
            // so a click away never silently discards the in-place box.
            if (machineRef.current !== "focused") return;
            if (evaluateMediaQuery(WIDE_RUNG_QUERY) || textRef.current.trim() === "") {
              setConsoleMachineState("rest");
            }
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const value = textRef.current;
            if (value.trim() === "") return;
            void sendOperatorMessage(server, target, value);
            setConsoleMachineState("open");
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
    </>
  );
}
