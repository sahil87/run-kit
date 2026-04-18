# Tasks: Right-align Server Name in Server Panel Header

**Change**: 260418-2cjc-right-align-server-name
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

<!-- No setup tasks — this is a scoped two-file edit, no dependencies or scaffolding needed. -->

_(none)_

## Phase 2: Core Implementation

- [x] T001 Update `ServerPanel` header props in `app/frontend/src/components/sidebar/server-panel.tsx`:
  - Change `title={`Tmux \u00B7 ${server}`}` to `title="Server"`.
  - Replace the current `headerRight` expression (currently: `refreshing ? <LogoSpinner size={10} /> : null`) with a fragment that renders the server name first and the refresh spinner second when refreshing:
    ```tsx
    const headerRight = (
      <>
        <span className="truncate text-text-primary font-mono">{server}</span>
        {refreshing && <LogoSpinner size={10} />}
      </>
    );
    ```
  - Leave all other props (`storageKey`, `defaultOpen`, `onToggle`, `contentClassName`, `headerAction`, `tint`, `tintOnlyWhenCollapsed`, `resizable`, `defaultHeight`, `minHeight`, `mobileHeight`) untouched.
  - Leave the tile grid body and `ServerTile` component untouched.
  - Do not introduce new imports (`LogoSpinner` is already imported at line 4).

## Phase 3: Integration & Edge Cases

- [x] T002 Update `openPanel` test helper in `app/frontend/src/components/sidebar/server-panel.test.tsx`:
  - At line 53, change the regex from `/Tmux/` to `/Server/`.
  - No other changes to this helper.

- [x] T003 Add a behavior test in `app/frontend/src/components/sidebar/server-panel.test.tsx` that verifies the active server name is rendered in the header region before the panel is opened:
  - The test SHOULD render the panel with `server: "work"` (or similar recognizable non-default server name) and call only `renderPanel(...)` — it MUST NOT call `openPanel()`.
  - Assert that the static title `Server` is present in the document (e.g., via `screen.getByText("Server")` or by asserting on the toggle button's accessible name containing `Server`).
  - Assert that the active server name `work` is present in the document — because the panel body is closed by default, any occurrence of the server name in the DOM comes from the `headerRight` slot. This encodes the right-slot contract behaviorally without coupling to Tailwind classes.
  - Place the test alongside the existing `describe("ServerPanel", ...)` block at the end of the file (after line 181).

- [x] T004 Run the scoped frontend test suite and fix any remaining failures:
  - Run only the `server-panel` tests via the `just` runner. Per `fab/project/context.md`, tests MUST go through `just` — never invoke `pnpm test`/`vitest`/`playwright` directly. Use `just test-frontend` (scoped via Vitest filter flag) or run `just pw`-equivalent only if e2e is needed; since T004 is Vitest-only, prefer `just test-frontend -- src/components/sidebar/server-panel.test.tsx` (or the nearest equivalent passthrough supported by the justfile recipe). <!-- clarified: replaced raw `pnpm vitest run` invocation with a `just`-routed command to comply with the project's test-runner convention in context.md -->
  - Do not invoke Playwright e2e at this step.
  - If any test beyond the helper/new coverage fails, triage: if it was already testing the old `Tmux · …` title form, adapt it to the new static title; otherwise investigate and fix the root cause.

## Phase 4: Polish

- [x] T005 Run the broader quality gates before marking apply done:
  - `cd app/frontend && npx tsc --noEmit` — type check.
  - `just test-frontend` — full Vitest unit suite. Fix any collateral failures.
  - (Optional — include only if a Playwright spec explicitly covers the Server panel header; if none exists, skip e2e for this change.) `just pw test <server-panel-header-spec>` — targeted e2e if applicable.
  - Do NOT run `just build` here; the production build runs automatically at ship time.

## Phase 5: Rework (cycle 1 — review feedback)

<!-- rework: outward review found Playwright e2e spec + companion doc + memory drift referencing the old "Tmux" title; T005's "optional" e2e check missed the existing server-panel-grid.spec.ts -->

- [x] T006 Update Playwright e2e spec `app/frontend/tests/e2e/server-panel-grid.spec.ts` to match the new accessible names:
  - Replace every `getByRole("button", { name: /^Tmux/ })` with `getByRole("button", { name: /^Server/ })` — 5 call sites (lines ~46, 69, 85, 105, 120).
  - Replace every `getByRole("separator", { name: /Resize.*Tmux/ })` with `getByRole("separator", { name: /Resize.*Server/ })` — 2 call sites (lines ~108, 123). The separator's `aria-label` is derived from `CollapsiblePanel` as `Resize {title} panel` — with title now `"Server"`, the full aria-label is `Resize Server panel`.
  - Do **not** change `getByRole("listbox", { name: /Tmux servers/ })` references — that aria-label comes from the grid itself (`server-panel.tsx:126` `aria-label="Tmux servers"`) and is unchanged by this change. Leaving those match the current source keeps the test accurate.
  - Rename the local `tmuxButton` variable (if present, ~line 46) to `serverButton` to reflect the new accessible name.

- [x] T007 Update the companion e2e doc `app/frontend/tests/e2e/server-panel-grid.spec.md` per constitution §35 (Test Companion Docs — must update in the same commit as the spec):
  - Replace occurrences describing the accessible name of the toggle button (e.g., "Locate the Tmux header button (`name: /^Tmux/`)") with the new name (`name: /^Server/`).
  - Replace prose references to "Expand the Tmux panel" / "Resize Tmux panel" with "Expand the Server panel" / "Resize Server panel" where they describe the UI or assertion.
  - Leave occurrences that describe the listbox aria-label (`/Tmux servers/`) unchanged — the underlying aria-label is unchanged.
  - Preserve the "tmux server" conceptual phrasing where it refers to the domain concept (e.g., "two temporary sessions on the e2e tmux server").

- [x] T008 Update `docs/memory/run-kit/ui-patterns.md` to document the Server panel's header title/right-slot for parity with WindowPanel (line 219) and HostPanel (line 251):
  - Locate the existing ServerPanel description starting around line 150.
  - Add a sentence documenting `title="Server"`, `storageKey="runkit-panel-server"`, `defaultOpen={false}`, and that the active server name is rendered in `headerRight` with `text-text-primary font-mono truncate` — same pattern as WindowPanel and HostPanel. This closes the should-fix memory drift and keeps ui-patterns.md as the canonical source for sidebar panel conventions.

- [x] T009 Re-run the quality gates after T006-T008:
  - `cd app/frontend && npx tsc --noEmit` — type check.
  - `just test-frontend` — Vitest unit suite.
  - `just pw test server-panel-grid` — targeted Playwright e2e against the newly updated spec. The `just pw` recipe routes through port 3020 with the isolated `rk-e2e` tmux server per `fab/project/context.md`.
  - If any step fails, triage before marking the task `[x]`.

---

## Execution Order

- T001 must complete before T002 (test helper regex change depends on title having already changed).
- T001 and T002 must both complete before T003 runs (new test relies on the new title).
- T004 depends on T001, T002, T003 — it verifies them together.
- T005 is the final quality gate — run after T001-T004 all pass.
- No tasks are parallelizable — the change is small and strictly sequential by file dependency.
- Rework cycle 1: T006 and T007 MUST be completed together (constitution §35 — companion doc in same commit as spec). T008 is independent. T009 is the re-validation gate after all three.
