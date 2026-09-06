/**
 * Dev-only control gallery (`/__controls`) — renders the full Control-variant
 * × state matrix from the REAL primitive (`controlClass`) with forced-state
 * props, so the Playwright drift guard (tests/e2e/control-gallery.spec.ts)
 * screenshots the shipped control vocabulary per pointer class (fine /
 * coarse). The route is registered only when `import.meta.env.DEV` (see
 * router.tsx) — the prod bundle never serves this page (the fixed route set
 * stays minimal; this is a dev harness, not a product surface).
 *
 * Hover/focus treatments are deliberately NOT rendered: they are
 * interaction-time behavior owned by the global rules in globals.css, not
 * per-state compositions. The menu-row checked cell carries the trailing ✓
 * (`MENU_ROW_CHECK_MARK`) because the mark is call-site content, not part of
 * the row's class composition.
 */
import type { ReactNode } from "react";
import { MENU_ROW_CHECK_MARK, POPOVER_SHELL } from "./controls";
import { Control, controlClass } from "./control";

/** Bordered toggle geometry (the settings theme-mode precedent). */
const TOGGLE_BORDERED_BASE = "px-2 py-1 border rounded text-xs transition-colors";
/** Ringed (borderless) toggle geometry + rest arm (the sidebar section-rail
 *  precedent). */
const TOGGLE_RINGED_BASE =
  "flex items-center justify-center rounded-sm px-0.5 min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] transition-colors";
const TOGGLE_RINGED_REST = "text-text-secondary hover:text-text-primary";
/** The segment cell's per-site wrapper chrome (the split/open-chevron
 *  precedent) — the primitive supplies the stateful segment core. */
const SEGMENT_PREFIX =
  "rk-glint px-1 border-l flex items-center justify-center transition-colors";

function Cell({ testid, label, children }: { testid: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="text-[10px] uppercase tracking-wider text-text-secondary select-none">
        {label}
      </span>
      <div data-testid={testid} className="flex items-center">
        {children}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs text-text-primary border-b border-border pb-1">{title}</h2>
      <div className="flex items-start gap-4 flex-wrap">{children}</div>
    </section>
  );
}

export function ControlGalleryPage() {
  return (
    <div className="h-full overflow-y-auto bg-bg-primary">
      <div className="p-6 flex flex-col gap-6 w-max" data-testid="control-gallery">
        <Section title="icon · bar axis (28/40 fixed squares)">
          <Cell testid="ctl-icon-rest" label="rest">
            <Control variant="icon">↻</Control>
          </Cell>
          <Cell testid="ctl-icon-pressed" label="pressed">
            <Control variant="icon" pressed>↻</Control>
          </Cell>
          <Cell testid="ctl-icon-open" label="open">
            <Control variant="icon" open aria-expanded="true">▾</Control>
          </Cell>
          <Cell testid="ctl-icon-disabled" label="disabled">
            <Control variant="icon" disabled>↻</Control>
          </Cell>
        </Section>

        <Section title="chip · chip axis (33×35 fine / 40 coarse)">
          <Cell testid="ctl-chip-rest" label="rest">
            <Control variant="chip" className="text-text-secondary">⌘K</Control>
          </Cell>
          <Cell testid="ctl-chip-pressed" label="pressed">
            <Control variant="chip" pressed>^</Control>
          </Cell>
          <Cell testid="ctl-chip-open" label="open">
            <Control variant="chip" open aria-expanded="true">F▴</Control>
          </Cell>
          <Cell testid="ctl-chip-disabled" label="disabled">
            <Control variant="chip" disabled className="text-text-secondary">⌘K</Control>
          </Cell>
        </Section>

        <Section title="chip · ringed (borderless menu key cells, 40 flat)">
          <Cell testid="ctl-chip-ringed-rest" label="rest">
            <Control variant="chip" ringed>F1</Control>
          </Cell>
          <Cell testid="ctl-chip-ringed-pressed" label="pressed">
            <Control variant="chip" ringed pressed>⌥</Control>
          </Cell>
          <Cell testid="ctl-chip-ringed-disabled" label="disabled">
            <Control variant="chip" ringed disabled>F1</Control>
          </Cell>
        </Section>

        <Section title="toggle · latched on-state (bordered / ringed)">
          <Cell testid="ctl-toggle-rest" label="rest">
            <Control variant="toggle" base={TOGGLE_BORDERED_BASE} pressed={false}>System</Control>
          </Cell>
          <Cell testid="ctl-toggle-pressed" label="pressed">
            <Control variant="toggle" base={TOGGLE_BORDERED_BASE} pressed>System</Control>
          </Cell>
          <Cell testid="ctl-toggle-disabled" label="disabled">
            <Control variant="toggle" base={TOGGLE_BORDERED_BASE} pressed={false} disabled>System</Control>
          </Cell>
          <Cell testid="ctl-toggle-ringed-rest" label="ringed rest">
            <Control variant="toggle" base={TOGGLE_RINGED_BASE} rest={TOGGLE_RINGED_REST} ringed pressed={false}>▣</Control>
          </Cell>
          <Cell testid="ctl-toggle-ringed-pressed" label="ringed pressed">
            <Control variant="toggle" base={TOGGLE_RINGED_BASE} rest={TOGGLE_RINGED_REST} ringed pressed>▣</Control>
          </Cell>
        </Section>

        <Section title="segment · inset bar axis (26/38 inside a bordered wrapper)">
          <Cell testid="ctl-segment-rest" label="rest">
            <span className={`flex items-center rounded border border-border ${controlClass({ variant: "icon", box: "height", glint: false })}`}>
              <button type="button" className={`${SEGMENT_PREFIX} ${controlClass({ variant: "segment" })}`}>▾</button>
            </span>
          </Cell>
          <Cell testid="ctl-segment-open" label="open">
            <span className={`flex items-center rounded border border-border ${controlClass({ variant: "icon", box: "height", glint: false })}`}>
              <button type="button" aria-expanded="true" className={`${SEGMENT_PREFIX} ${controlClass({ variant: "segment", open: true })}`}>▾</button>
            </span>
          </Cell>
          <Cell testid="ctl-segment-disabled" label="disabled">
            <span className={`flex items-center rounded border border-border ${controlClass({ variant: "icon", box: "height", glint: false })}`}>
              <button type="button" disabled className={`${SEGMENT_PREFIX} ${controlClass({ variant: "segment", disabled: true })}`}>▾</button>
            </span>
          </Cell>
        </Section>

        <Section title="menu-row · row axis (28/40 floors)">
          <div className={`w-[220px] ${POPOVER_SHELL}`}>
            <Control variant="menu-row" role="menuitem" data-testid="ctl-menu-row-rest">
              <span>Rest row</span>
            </Control>
            <Control variant="menu-row" pressed role="menuitem" aria-current="true" data-testid="ctl-menu-row-checked">
              <span>Checked row</span>
              <span aria-hidden="true" className={MENU_ROW_CHECK_MARK}>✓</span>
            </Control>
            <Control variant="menu-row" disabled role="menuitem" data-testid="ctl-menu-row-disabled">
              <span>Disabled row</span>
            </Control>
          </div>
        </Section>

        <Section title="wide · dialog button (bar-axis floors)">
          <Cell testid="ctl-wide-rest" label="rest">
            <div className="w-[180px]">
              <Control variant="wide" className="w-full">Create</Control>
            </div>
          </Cell>
          <Cell testid="ctl-wide-disabled" label="disabled">
            <div className="w-[180px]">
              <Control variant="wide" disabled className="w-full">Create</Control>
            </div>
          </Cell>
        </Section>

        <Section title="confirm · the neutral/danger pair">
          <Cell testid="ctl-confirm-rest" label="neutral">
            <div className="w-[140px]">
              <Control variant="confirm" className="w-full">Cancel</Control>
            </div>
          </Cell>
          <Cell testid="ctl-confirm-danger" label="danger">
            <div className="w-[140px]">
              <Control variant="confirm" danger className="w-full">Kill</Control>
            </div>
          </Cell>
          <Cell testid="ctl-confirm-disabled" label="disabled">
            <div className="w-[140px]">
              <Control variant="confirm" disabled className="w-full">Cancel</Control>
            </div>
          </Cell>
          <Cell testid="ctl-confirm-danger-disabled" label="danger disabled">
            <div className="w-[140px]">
              <Control variant="confirm" danger disabled className="w-full">Kill</Control>
            </div>
          </Cell>
        </Section>
      </div>
    </div>
  );
}
