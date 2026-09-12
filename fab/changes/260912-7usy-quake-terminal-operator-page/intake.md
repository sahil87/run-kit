# Intake: Quake Terminal Operator Page

**Change**: 260912-7usy-quake-terminal-operator-page
**Created**: 2026-09-13

## Origin

One-shot `/fab-new` with a plan pointer. Raw input:

> The operator window's terminal route renders the quake terminal full-screen on desktop -- segment strip above the tty tile, docked compose below, non-terminal segments swapping the body -- so the drawer is a peek of the same surface; a server without an operator gets a Start operator button in the Operator Terminal segment and a placeholder pinned row that opens the drawer. This is Change 3 of the sequential plan at fab/plans/sahil/26-09-12-quake-terminal-drawer.md -- read that file's Standing context and Change 3 sections in full before writing the intake; slug quake-terminal-operator-page. Changes 0, 1, 2, and 5 are all merged to main -- start fresh off it.

**Plan of record**: `fab/plans/sahil/26-09-12-quake-terminal-drawer.md` — § Decisions of record, § Standing context, and § Change 3 were read in full. Design study: `docs/wiki/operator-console-drawer-studies.html`. Pre-change truth: `docs/memory/run-kit/ui/quake-terminal.md`, `ui/sidebar.md` § Operator Pinned Row, `ui/routes-and-shell.md` § Quake Terminal Overlay.

**Ladder state verified at intake**: the worktree branch `quake-terminal-operator-page` sits exactly on `origin/main` (`8e505423 feat: Quake Terminal Docked Compose (#962)`), zero commits either way. Changes 0 (rename, `260912-nynf`), 1 (resize, `260912-jl4w`), 2 (docked compose, `260912-m5lo`) and 5 (data table, `260912-xi3h`) are merged, so this intake is written in the post-rename vocabulary (`QuakeTerminal`, `quake-terminal.tsx`, `lib/quake-terminal.ts`, `quake-terminal.spec.ts`, `requestQuakeTerminal`, `rk:quake-terminal`). Where the plan's Standing context still names `operator-console.spec.ts`, read `tests/e2e/quake-terminal.spec.ts`.

**Decisions of record carried from the plan (2026-09-12 discussion)**:

- The operator window's route wears the quake surface on desktop too — mobile already does (`quakeTerminalTabs = isMobile && windowParam != null && currentWindow?.role === "operator"` at `app.tsx:948`); the desktop drawer becomes a **peek** of the same surface.
- **No synthetic route.** An always-present Operator sidebar row is wanted, but its empty state opens the drawer (an overlay needs no URL) rather than inventing `/$server/operator` — Constitution IV's fixed route set; a window-less row would have to redirect once the operator exists.
- The **one-input rule** stands: one compose view per surface; the drawer's docked compose (change 2) is the drawer's; the route's compose strip is the page's (see § 1 and Assumption 1 — the plan's parenthetical "change 2's docked compose is this same strip in the drawer" conflates two components; this intake pins which one the page renders).
- Auto-starting the operator is a non-goal — strictly user-initiated (`rk operator`'s opt-in posture).

**Facts established by reading the code at intake** (they shape the design below):

- `rk operator -L <server> [--json]` already exists as the **daemon-invocable form** (`app/backend/cmd/rk/operator.go` — no `$TMUX` needed, every tmux call `-L`-addressed, window opened in `$HOME`, singleton hit reported without `switch-client`). With `--json` it prints the receipt `{"window":"@N","server":"<label>","created":true|false}` **immediately after creating and role-stamping the window, before the kickoff delivery** (which then runs up to `operatorDeliverDeadline` = 25 s and is best-effort). `fab` on PATH is a hard precondition (exit 1 with a one-line stderr message). The cron daemon already runs this argv through `internal/cron/respawn.go` `runRespawnExec` (argv-slice `exec.CommandContext`, `DefaultRespawnTimeout` = 90 s) as the operator entry's respawn — the same launch this change exposes to a button.
- The desktop quake terminal's seam listener treats `toggle`/`open` on the resolved operator route as a no-op with the toast `already viewing the operator — nothing to open` (`ALREADY_ON_OPERATOR_HINT`, `quake-terminal.tsx:74`, gate at `:455`), **except** a request carrying a non-terminal segment, which opens the drawer because those views exist only inside it on desktop. The quake launcher (`quake-launcher.tsx`) bypasses the seam — it calls `setQuakeMachineState("open")` directly (lines 153/175/220/228) — so on the desktop operator route it still opens a duplicate drawer over the operator's own terminal.
- `app.tsx:955–972` hands a desktop `?tab=tasks|list|log` deep link to the drawer and strips the param (the "param is inert on desktop" rule). Two e2e tests assert that (`quake-terminal.spec.ts:821`, `:925`).
- The route's compose strip (`components/compose-strip.tsx`) is a **chrome preference, off by default** (`readComposeStrip()` in `contexts/chrome-context.tsx` returns `localStorage["runkit-compose-strip"] === "true"`). The mobile operator route's e2e enables it via `addInitScript`. It already forks onto the templated chat lane behind the `?from=` chip on the operator route and reads the chat-subject store the drawer stamps. On desktop it docks IN the first tty tile (`inTileDock`, `app.tsx:3846`) when the layout has a tty; otherwise the footer dock (`:5213`).
- `sidebar/index.tsx:2490` `operatorEntry` memo → `null` renders nothing ("no placeholder, no wrapper, the DOM is identical to before"). `onOperatorCompose` is the optional-prop precedent for "the shell wired a handler" — passed by AppShell (`app.tsx:5175`, gated on `hasOperatorWindow`) and omitted by the board route (`board/board-page.tsx:970`).
- `Control` (`components/control.tsx`) has a `wide` variant (`wide: "bar"`).
- API conventions: server via `serverFromRequest(r)` = `?server=` query (`api/router.go:406`; the client's `withServer()`); errors via `writeError` / `writeErrorCode`; the daemon's own binary via the `resolveSelfPathFn` seam (`api/update.go:35`, used by `api/restart.go`); SSE repaint via `s.sseHub.wake(server)`.
- CI has **no fab-kit** on the runner (`.github/workflows/ci.yml:30`), so a real `rk operator` launch cannot be exercised end-to-end in CI.

## Why

**The problem.** The operator has two homes that disagree. On mobile the operator window's own route already IS the operator page — a four-segment strip (`Operator Terminal | Operator Tasks | Cron List | Cron Log`), `?tab=` as segment state, the terminal column hidden-not-unmounted under a non-terminal tab. On desktop that same route is an ordinary terminal: the segments live only in the ⌘J drawer, so a user sitting on the operator's tab who wants the tracked list or the cron log has to drop a drawer over the very terminal they are looking at (a duplicate embed of the same pane), and a desktop `?tab=` deep link has to be translated into "open the drawer" and stripped. Every opener on that route dead-ends in a toast (`already viewing the operator — nothing to open`) — the launcher, which bypasses the seam, does not even do that and opens the duplicate. The drawer and the page are one surface in the design (the drawer is a peek) but two implementations in the code.

**The second problem.** A server with no operator has no on-screen way to get one. The drawer body says `no operator on this server — run rk operator`; the sidebar's operator row does not exist at all (the `operatorEntry === null` branch renders nothing), so the pinned slot that would otherwise be the operator's constant landmark is simply absent, and a new user has no affordance to discover. `rk operator -L <server>` — the exact daemon-invocable launch — already exists and is already exec'd by the cron respawn path; only the button is missing.

**If we don't.** Changes 0–2 made the drawer a good peek; without this change the thing it peeks at does not exist on desktop, so the drawer stays the operator's only desktop surface and keeps carrying UI that wants a full page (Operator Tasks, Cron Log). Change 4 (cron ungated) then has to add its operator-less cron homes into a drawer only. And the operator stays a CLI-first feature on a web dashboard.

**Why this approach.** Dropping the `isMobile` term from the existing gate reuses the mobile arm wholesale — strip, content swap, hidden terminal column, `?tab=` contract (`router-url.ts`), compose strip with its chat-lane fork — rather than building a second page: one component, two form factors, and the drawer's segment body already renders the same `WatchedTasks` / `CronList` / `CronLog` / `CronStaleBanner`. The Start button is a thin HTTP door onto `rk operator -L --json`, which already owns creation, role-stamping, singleton probing, agent resolution and kickoff. The placeholder row reuses the pinned row's slot and roving-tabindex position, and its activation reuses the document-event seam — no new route, no new store.

## What Changes

### 1. The operator page — the operator route wears the quake surface on both form factors

**Gate.** In `app/frontend/src/app.tsx` the mobile-only gate becomes form-factor-neutral:

```ts
// before
const quakeTerminalTabs = isMobile && windowParam != null && currentWindow?.role === "operator";
// after — the operator PAGE: the operator window's own terminal route, any form factor
const operatorPage = windowParam != null && currentWindow?.role === "operator";
const quakeTab = operatorPage ? (search.tab ?? "terminal") : "terminal";
```

Everything already keyed on the old gate follows it unchanged: `cronTabActive` / `tasksTabActive` / `terminalHidden`, the `hidden`-class (never unmount) posture on the surface-layout column, the content swap (`WatchedTasks` with sessions by prop; `CronList` / `CronLog` under one `CronStaleBanner`), and the strip mount `{operatorPage && <TerminalActivityTabs />}`. `TerminalActivityTabs` keeps driving the router `tab` search param with `replace: true` — `?tab=terminal|tasks|list|log` **is** the page's segment state on desktop too (the mobile deep-link contract in `lib/router-url.ts`, `validateTerminalSearch`, unchanged). The `pt-9` tongue clearance on the strip wrapper applies only on mobile (the tongue never renders on desktop) — pass a prop or branch on `isMobile` at the mount; the strip's markup/test ids (`terminal-activity-tabs`, `role="tablist"`) stay identical.

**The tty tile stays the ordinary `TerminalClient`** — the operator page is the tty lens of a `role === "operator"` window wearing the strip, not a fifth lens; `surface-layout` / `?layout=` semantics are untouched. A non-terminal tab hides the whole surface-layout column, as today on mobile.

**Delete the desktop handoff.** Remove the `useEffect` at `app.tsx:955–972` that dispatched `requestQuakeTerminal({ action: "open", segment: search.tab })` and stripped `?tab=` on desktop — the param now drives the page directly. The two e2e tests that assert the handoff (`quake-terminal.spec.ts:821` "desktop ?tab=activity deep link opens the drawer on Cron Log and strips the param", `:925` "…?tab=tasks…") are rewritten to assert the page lands on that segment with the param retained (`tab=activity` still normalizes to `log`).

**Docked compose below — the route's compose strip, forced on, footer-docked.** The page's input is the existing `ComposeStrip` (the mobile operator route's input today, with its operator-route chat-lane fork and `?from=` chip), rendered whenever `operatorPage` holds **regardless of the `composeStripEnabled` preference** (the operator page has an input by definition; the `>_` chip keeps toggling the preference for every other route and is a visual no-op here), and always in the **footer dock** on the operator page — `inTileDock` gains `&& !operatorPage` — so the strip stays visible under a non-terminal tab (the in-tile dock would hide with the terminal column). Both changes are one predicate each at `app.tsx:3846` and `:5213`:

```ts
const composeStripVisible = composeStripEnabled || operatorPage;
const inTileDock = composeStripEnabled && !operatorPage && !isMobile && !!windowParam && !selectionBroadcastKeys && layout.order.includes("tty");
…
{composeStripVisible && !inTileDock && composeStripElement}
```

No new compose store, no new send lane: drafts stay in `lib/compose-draft-store.ts` (`server:windowId`-keyed), sends ride `POST /api/windows/{id}/send` or the templated `user-message` lane per the strip's existing fork. The drawer's docked compose (`QuakeCompose`, the `useOperatorCompose` seam) is untouched and never renders on the page — the drawer cannot open on the operator route (§ 2).

**Variant table** (for memory § The operator page):

| | Drawer (peek) | Page |
|---|---|---|
| Mount | root-layout overlay, `QuakeTerminal` | the operator window's `/$server/$window` route, AppShell |
| Segment state | drawer-local component state | `?tab=` search param (`replace: true`) |
| Strip | folded into the one header row (`QuakeSegments`, `className` override) | `TerminalActivityTabs` above the surface-layout column |
| Header extras | server · agentState · tick · ⌖ pin · `⤢ open as tab` · ▼ | none — the top-bar heading and the pinned sidebar row carry state |
| Terminal | `TerminalClient` embed, unmounted on non-terminal segments (one relay stream per drawer) | the route's ordinary tty tile, hidden-not-unmounted on non-terminal tabs |
| Compose | `QuakeCompose` (operator compose seam) | `ComposeStrip`, forced on, footer dock |
| Esc | strip rung (blur to embed) → collapse rung | the strip's own Esc; no collapse rung |
| Form factor | desktop only | desktop + mobile (mobile unchanged except the forced strip) |

### 2. Drawer ⇄ page

**Openers on the operator route focus the page, never a drawer.** In `components/quake-terminal.tsx`'s seam listener the desktop `onOperatorRouteRef` branch stops toasting and does what the mobile arm already does for the same state:

- `detail.segment` absent or `"terminal"` → `focusComposeStrip()` (`lib/compose-strip-events.ts:78`, the existing helper; the strip is always mounted on the page per § 1). `toggle` and `open` both focus — ⌘J on the operator page puts the caret in the docked compose. If `detail.send` is set (the palette Ask-operator fallback row), seed the strip's draft via `setComposeText(\`${server}:${windowId}\`, text)` exactly as the mobile arm does (unsent — the user reviews and sends).
- `detail.segment` is `tasks` / `list` / `log` → in-place `navigate({ to: ".", search: (prev) => ({ ...prev, tab: segment }), replace: true })` — the mobile arm's already-on-route branch. The palette's `Operator: Show tasks / cron list / cron log` and the `◷` chip therefore switch the page's segment instead of dropping a drawer.
- Retire `ALREADY_ON_OPERATOR_HINT`, `alreadyOnOperatorHintAtRef`, and the requirement "Desktop openers are inert on the resolved operator route" (memory). Unify the two arms: the on-operator-route handling becomes form-factor-neutral code the desktop branch and the mobile branch both call.

**The launcher on the operator route** (`components/quake-launcher.tsx`): while the resolved target is the current route (the same `onOperatorRoute` derivation the drawer uses — `routeServer === server && routeWindow === target.window.windowId`), render the **collapsed** form (glyph + state dot + chord keycap, the change-2 `open`-state look, `engaged` false) instead of the standing textarea, and route its click to `focusComposeStrip()` instead of `setQuakeMachineState("open")`. Its draft (`useOperatorCompose`) is left alone — it is not the page's store and reappears in the drawer on the next non-operator route. No other launcher behavior changes.

**Drawer peek from elsewhere is unchanged**: on every other route a segment click, the chord, the palette rows and the `◷` chip open the drawer exactly as after change 2.

**`⤢ open as tab`.** The drawer header row gains one control between the pin and the collapse button: `Control` icon variant, glyph `⤢`, `aria-label="Open as tab"`, `data-testid="quake-terminal-open-as-tab"`. Click → `navigate({ to: "/$server/$window", params: { server, window: target.window.windowId }, search: segment === "terminal" ? {} : { tab: segment } })` then `setQuakeMachineState("rest")` — mobile's navigation arm, now on desktop. Rendered only while `target` resolves (no operator → no control; the Start button is the body's answer). Palette twin (Constitution V): `Operator: Open as tab` (id `quake-terminal-open-as-tab`, `buildQuakeTerminalOpenAsTabAction(...)` in `lib/palette/quake-terminal.ts`), listed only while the desktop machine is `open` and a target resolves — the pin entry's gating precedent — registered after the pin entry.

### 3. Start operator

**Button.** In the Operator Terminal segment's operator-less body (`data-testid="quake-terminal-empty"`, today one hint line) render:

```
[ Start operator ]                       ← Control, variant "wide", data-testid="quake-terminal-start-operator"
no operator on this server — run rk operator   ← NO_OPERATOR_HINT, unchanged text, as the sub-line (text-text-secondary)
```

The constant `NO_OPERATOR_HINT` keeps its exact text (asserted by `quake-terminal.spec.ts:1022` and `:1917`); the container keeps `data-testid="quake-terminal-empty"`. States: idle → click → pending (`disabled`, `aria-busy="true"`, label `starting…`) → on success the button unmounts by itself when the SSE `sessions` payload carries the new `role === "operator"` window and `target` resolves (the drawer's `TerminalClient` mounts on the new target — that IS the "retarget the drawer's terminal"; nothing to pin). On failure an inline line under the button (`role="alert"`, `data-testid="quake-terminal-start-error"`, `text-signal-red`) carries the server's `error` message and the button returns to idle. A `409 operator_exists` is treated as success (the operator appeared under us — the SSE tick shows it). The same body renders on the page variant by construction; the page cannot be operator-less (its route requires the operator window), so there is no page-specific branch.

**Client.** `api/client.ts`:

```ts
export type OperatorStartResult = { windowId: string; server: string };
export async function startOperator(server: string): Promise<OperatorStartResult> {
  const res = await fetch(withServer("/api/operator/start", server), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (!res.ok) await throwOnError(res);
  return res.json();
}
```

**Palette.** `Operator: Start operator` (id `operator-start`), listed only when the resolved server has **no** operator window (`!hasOperatorWindow` — degrade to absent, never disabled; the inverse of the `Fix tab name` gate), on both form factors. `onSelect` → `startOperator(server)` → on 202 (or the 409-as-success) `navigate` to `/$server/<windowId>` (the palette has no drawer context to retarget; on mobile this is the only Start path). Errors → `toast.addToast(message, "error")`.

**Placeholder row → drawer** (§ 4) is the pointer path to the button on desktop.

**Backend.** New route `POST /api/operator/start` (`app/backend/api/operator_start.go`, registered in `router.go` beside `/api/operator-request`; Constitution IX — mutation ⇒ POST). Contract:

| Step | Behavior |
|---|---|
| Server | `serverFromRequest(r)` (`?server=`; invalid/absent → `default`). Body is ignored (`{}` by convention). |
| Pre-check | ONE `s.sessions.FetchSessions(ctx, server)`; fetch error → `500`; `findOperatorWindow(sess) != nil` → `409` via `writeErrorCode(w, 409, "operator_exists", "operator already present")` with the body extended by `windowId` (the race backstop; the UI hides the button when an operator exists). |
| Exec | `selfPath, _ := resolveSelfPathFn()` (the daemon's own binary — never PATH-resolved `rk`); argv `[selfPath, "operator", "-L", server, "--json"]` via `exec.CommandContext` under a **process context detached from the request** (`context.WithTimeout(context.Background(), operatorStartProcessTimeout)`, `operatorStartProcessTimeout = 90 * time.Second` — the same bound the cron respawn uses for this launch: ≤10 s creation + 25 s kickoff deadline + slack); stdout via `StdoutPipe`, stderr captured. |
| Respond early | Read stdout line-by-line until the `--json` receipt parses (`{"ok":true,"result":{"window","server","created"}}` — the rk JSON envelope, see `newSink(cmd).JSONResult`), bounded by `operatorStartReceiptTimeout = 30 * time.Second`. Then `s.sseHub.wake(server)` and respond; the process finishes its kickoff delivery in a goroutine (`cmd.Wait()`, exit logged at `slog` warn on non-zero). |
| `created: true` | `202 {"windowId":"@N","server":"<server>"}` |
| `created: false` | `409 operator_exists` + `windowId` (a race the pre-check missed) |
| Non-zero exit before a receipt | `502 {"error":"<first non-empty stderr line>"}` — e.g. `run-kit operator: fab not found on PATH — …` |
| No receipt within 30 s | kill the process, `504 {"error":"operator start timed out"}` |

Constitution I: argv slice, bounded context, `server` already validated by `serverFromRequest`. `rk operator -L default` addresses the bare default socket (`operatorServerPrefix` drops `-L` for `default`) — correct for the daemon, whose environment has `TMUX` scrubbed. The exec sits behind a package seam (`operatorStartRunFn func(ctx context.Context, argv []string) (receipt operatorStartReceipt, stderr string, err error)`) so the handler's status mapping is unit-testable without a binary; the seam's default implementation gets its own test with a stub script.

**Docs/spec**: `docs/specs/api.md` gains a `POST /api/operator/start` section under § Windows-adjacent operator endpoints and a Route Summary row; `docs/memory/run-kit/api-and-sockets.md` gains the endpoint row.

**rk skill text**: `app/backend/cmd/rk/skill/tutorial.md:64` ("**No operator**: run `rk operator` — …") adds the dashboard path: "or press **Start operator** in the quake terminal (⌘J) / the `Operator: Start operator` palette entry". Check `shll standards` for the skill-surface standard before editing (Constitution § Toolkit Standards).

### 4. Always-present pinned row (placeholder)

In `sidebar/index.tsx` `ServerGroupInner`, when `operatorEntry === null` **and** the shell wired a handler (new optional prop `onOperatorPlaceholder?: (server: string) => void`, threaded `Sidebar → ServerGroup` exactly like `onOperatorCompose`; AppShell passes it, `board-page.tsx` omits it ⇒ board-route sidebars render no placeholder), render in the pinned row's slot:

```
[HeadsetIcon]  operator   not running          ← data-testid="operator-placeholder-row"
```

- `HeadsetIcon` (13px, same tone rules), name `operator`, sub-label `not running` in `text-text-secondary`; **no** status dot, no kill/pin/compose cluster, no marker well, no flyout; `draggable={false}`; not selectable (excluded from the `x`/checkbox selection registry and from `dataKeys`).
- **Activation** (click, and Enter/Space through the roving-tabindex tree path) → `onOperatorPlaceholder(server)`; AppShell's handler is `requestQuakeTerminal({ action: "open", server, segment: "terminal" })` — the drawer opens on the Operator Terminal segment where the Start button sits. On mobile the seam's mobile arm runs (no drawer exists): an operator-less server toasts `NO_OPERATOR_HINT` as it does for every opener today; the palette's `Operator: Start operator` is the mobile Start path. <!-- assumed: mobile placeholder activation falls through to the existing operator-less toast rather than starting the operator directly — a one-tap agent launch from a row labelled "not running" felt too easy to trigger; revisit if mobile Start needs a pointer path -->
- **Roving tabindex**: `rowKey = \`${server}:operator-placeholder\``, joins the group's row slice as the **leading** row exactly where the real pinned row would (the visible-row signature changes when it appears/disappears); `role="treeitem"`, `aria-selected={false}`, `tabIndex` per the roving rule.
- **Swap**: once a carrier appears, `operatorEntry` resolves and the ordinary pinned `WindowRow` renders in the slot; no animation. Ghost rows are still never carriers.
- The row renders inside the group's `{isOpen && …}` body like the real pinned row (a collapsed group hides it).

### 5. Tests

- **Vitest**: `app.test.tsx` — the desktop operator route mounts `terminal-activity-tabs`, `?tab=tasks` hides the terminal column and shows `WatchedTasks`, the compose strip renders with `composeStripEnabled` false, and a non-operator desktop route renders neither; the handoff effect is gone (no `rk:quake-terminal` dispatch on `?tab=`). `quake-terminal.test.tsx` — on the operator route `open`/`toggle` call `focusComposeStrip` (spy) and mutate no machine state; a non-terminal segment request writes `?tab=`; the Start button renders in the operator-less body, posts once, shows pending, surfaces a 502 message inline, treats 409 as success; `⤢ open as tab` navigates with the right `search` and rests the machine. `quake-launcher.test.tsx` — collapsed form on the operator route; click focuses the strip. `lib/palette/quake-terminal.test.ts` — `Operator: Open as tab` builder; `Operator: Start operator` listed iff no operator. `sidebar/index.test.tsx` (or the sidebar's existing suites) — placeholder renders only with the handler and no carrier; activation calls the handler; roving order; swap to the real row.
- **Go**: `api/operator_start_test.go` — argv shape `[self, "operator", "-L", "<server>", "--json"]`; `409 operator_exists` on an existing operator (pre-check) and on `created:false`; `202` with `windowId` on `created:true`; `502` with the stderr line on non-zero exit; `504` on receipt timeout; SSE wake called once on success.
- **e2e** (`just test-e2e <name>.spec` — pass the `.spec` suffix: the worktree directory is named `quake-terminal-operator-page`, so a bare `quake-terminal` filter matches every spec): `quake-terminal.spec.ts` — ⌘J on the desktop operator route focuses the compose strip (no drawer); `Operator: Show cron list` on that route lands on `?tab=list`; `⤢ open as tab` from the drawer on another route lands on `/$server/@N?tab=<segment>`; the two rewritten deep-link tests. New `operator-page.spec.ts` — the desktop operator route shows the strip and swaps the body; `Start operator` (backend stubbed with `page.route` — CI has no fab-kit, so the real launch is a dev-box manual check) posts and, once the mocked sessions payload carries the operator window, the embed mounts and the button is gone; the error path surfaces the stubbed 502 message inline; the placeholder row is present without an operator, opens the drawer on activation, and is replaced by the pinned row once the operator exists. Every `test()` carries the Proves/Steps JSDoc; a file header documents the stubs.
- **Verification gate for the change** (never the full suite): `npx tsc --noEmit`; the Vitest suites above; `just test-e2e quake-terminal.spec`, `just test-e2e operator-page.spec`, `just test-e2e operator-pinned-row.spec`, `just test-e2e mobile-cron-tabs.spec` (the gate refactor touches the mobile tabs); `go test ./api/ -run 'Operator'` from `app/backend` (after `just _ensure-tmux-conf` in a fresh worktree). Fresh worktree: `pnpm install --frozen-lockfile` in `app/frontend` first.

### Non-goals

- Mobile behavior changes beyond what the shared gate implies (the forced compose strip on the operator route is the one deliberate mobile-visible consequence; the tongue, the navigation arm and `?from=` are untouched).
- Any change to the operator's launcher resolution (`fab agent operator -o yaml` stays inside `rk operator`), the kickoff prompt, or `rk operator`'s CLI surface — the route is a caller.
- Auto-starting the operator; a Start affordance anywhere but the drawer body and the palette.
- Cron ungating (change 4) — `list`/`log` keep today's gating in the drawer body; the page's cron tabs already need only a server.
- Header state/tick/pin/collapse on the page variant; a fifth lens; any `surface-layout` / `?layout=` change; the tmux status bar (parked).
- Migrating the page's compose onto the operator compose seam (`useOperatorCompose`) — the strip is the route's input on both form factors.

## Affected Memory

- `run-kit/ui/quake-terminal`: (modify) new § Requirement: The operator page (the variant table above; the gate; `?tab=` as desktop segment state; the forced footer-docked compose strip); rewrite § Desktop openers are inert on the resolved operator route → "Openers on the operator route focus the page" (focus the strip / in-place `?tab=`; toast retired); § Availability degrades to absent gains the Start operator button + the `POST /api/operator/start` client contract and states; § Mobile open is navigation…'s second paragraph (the tabs) moves into the page section as form-factor-neutral truth; § Anatomy gains `⤢ open as tab`; § The quake launcher gains the collapsed-on-operator-route form. Design Decisions: supersede "Operator-route openers stay visible and answer with a toast" with "Operator-route openers focus the page compose"; add "The page's compose is the route's compose strip, not the operator compose seam", "Start operator is an HTTP door onto `rk operator -L --json`, responding on the receipt line", "The drawer is a peek of the page; `open as tab` is mobile's navigation arm on desktop".
- `run-kit/ui/sidebar`: (modify) § Operator Pinned Row — the "No operator ⇒ null ⇒ nothing renders — no placeholder" sentence flips; add the placeholder row's anatomy, the `onOperatorPlaceholder` gate, roving position, activation, swap; Design Decision "Placeholder row opens the drawer, not a synthetic route" (the Constitution IV rationale from the plan).
- `run-kit/ui/routes-and-shell`: (modify) § Quake Terminal Overlay notes the page variant (the operator window's route wears the strip on every form factor; the overlay is the peek); § URL Structure / § URL as Resumable Bookmark: `?tab=` is live on desktop too (no handoff/strip).
- `run-kit/ui/keyboard-and-palette`: (modify) § Command Palette Actions — `Operator: Start operator` (listed iff no operator), `Operator: Open as tab` (listed while open); the ⌘J paragraph's desktop clause gains "on the operator route the chord focuses the page's compose strip".
- `run-kit/ui/top-bar`: (modify) center cell — the launcher's collapsed form also renders on the operator route.
- `run-kit/ui/compose-and-bottom-bar`: (modify) the compose strip is forced on and footer-docked on the operator page.
- `run-kit/api-and-sockets`: (modify) endpoint row for `POST /api/operator/start` (contract table from § 3).
- `run-kit/ui/index` (regenerate via `fab docs-index` if descriptions change).

Memory hygiene (standing context): resolve `](x.md)` same-directory links across the whole `docs/memory/run-kit/ui/` folder if any file is renamed or split — none is planned here.

## Impact

- **Frontend** (`app/frontend/src/`): `app.tsx` (gate, handoff-effect removal, compose dock predicates, `onOperatorPlaceholder` handler + prop, palette registration of two entries, `hasOperatorWindow` reuse); `components/quake-terminal.tsx` (seam on-operator-route branch, `⤢ open as tab`, Start button + states, `ALREADY_ON_OPERATOR_HINT` removal); `components/quake-launcher.tsx` (collapsed on the operator route); `components/terminal-activity-tabs.tsx` (mobile-only `pt-9`); `components/sidebar/index.tsx` (placeholder row, prop threading, roving slice); `lib/palette/quake-terminal.ts` (+ a Start-operator builder — in the same file or `lib/palette/operator.ts` per existing grouping); `api/client.ts` (`startOperator`); tests colocated; e2e `tests/e2e/quake-terminal.spec.ts`, new `tests/e2e/operator-page.spec.ts`, `operator-pinned-row.spec.ts` possibly extended.
- **Backend** (`app/backend/`): new `api/operator_start.go` + `_test.go`; `api/router.go` one route line; no change to `cmd/rk/operator.go`.
- **Docs**: `docs/specs/api.md` (section + Route Summary row); `app/backend/cmd/rk/skill/tutorial.md` (one clause); memory per § Affected Memory.
- **Constitution check**: IV — no new URL route (`/$server/$window?tab=` is the existing shape); the API route is a mutation door on existing CLI behavior, justified in `docs/specs/api.md`. V — two new controls (`⤢ open as tab`, `Start operator`) get palette entries; the placeholder row is keyboard-reachable through the tree. I — argv exec, bounded contexts. IX — POST. Test Intent Comments — every new/changed e2e `test()` updated in the same commit. No change-ID citations in code comments.
- **Risk surface**: the gate refactor touches the mobile operator route (run `mobile-cron-tabs.spec`); `inTileDock`/footer-dock predicate changes touch every terminal route's compose placement (assert non-operator routes are byte-identical); the seam's on-operator-route unification touches the mobile arm (its `?from=` merge and draft seeding must survive); the launcher's collapsed form depends on `onOperatorRoute` resolving only after the sessions payload lands (a cold load renders the standing form for a beat — acceptable, the same lag the strip's mount has); `rk operator -L` requires `fab` on the daemon's PATH — a missing fab surfaces as the CLI's precondition line in the inline error (desired). Lane hint from the plan: **full lane**.

## Open Questions

- None blocking. The one judgment call worth a human glance is Assumption 1 (the page's compose is the route's `ComposeStrip`, forced on, rather than the drawer's `QuakeCompose`) — the plan's text points at the strip; the "one seam" decision of record could be read the other way.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The page's docked compose is the route's `ComposeStrip` (mobile's today), forced on for the operator page and footer-docked so it survives non-terminal tabs — not the drawer's `QuakeCompose` | Plan § Change 3 item 1 says "the route's compose strip docked below"; mobile already uses it with the chat-lane fork; the alternative would split the route's input per form factor and duplicate inputs when the preference is on | S:60 R:70 A:75 D:60 |
| 2 | Confident | On the operator route the seam focuses the strip for terminal/undefined segments and writes `?tab=` in place for non-terminal ones; the toast is retired | Plan item 2 names the focus; the mobile arm already implements the in-place `?tab=` branch for the same state — reuse, not invention | S:70 R:85 A:80 D:75 |
| 3 | Certain | `POST /api/operator/start` takes the server as `?server=` (`serverFromRequest`), body `{}` — not a `{server}` body field as the plan sketched | Every server-scoped route and the client's `withServer()` use the query form; deviating would be the odd one out | S:50 R:90 A:95 D:90 |
| 4 | Confident | Exec `[selfPath, "operator", "-L", server, "--json"]` via `resolveSelfPathFn`, respond on the `--json` receipt line (30 s bound) while the process finishes kickoff under a detached 90 s context | `rk operator --json` prints the receipt before the up-to-25 s kickoff delivery; waiting for exit would make the button feel hung; 90 s mirrors the cron respawn's bound for the identical launch | S:65 R:75 A:70 D:65 |
| 5 | Confident | Status mapping 202 created / 409 `operator_exists` (pre-check or `created:false`) / 502 non-zero exit with the first stderr line / 504 receipt timeout | Plan gives 202/409/5xx; 502 is the codebase's spawn-failure code (`runJobAndRespond`), 504 the natural timeout code | S:60 R:85 A:75 D:70 |
| 6 | Certain | No new URL route: the page is `/$server/$window?tab=`; the placeholder opens the drawer | Decision of record (no synthetic route; Constitution IV) | S:90 R:90 A:95 D:95 |
| 7 | Certain | `⤢ open as tab` gets the palette twin `Operator: Open as tab`, listed only while the drawer is open with a resolved target | Constitution V + the pin entry's listing precedent | S:60 R:90 A:85 D:80 |
| 8 | Tentative | Mobile placeholder-row activation falls through to the seam's existing operator-less toast; the palette entry is the mobile Start path | Plan says mobile behavior changes are a non-goal; a one-tap agent launch from a "not running" row felt too easy to trigger; three plausible behaviors, none specified | S:30 R:75 A:45 D:35 |
| 9 | Certain | The placeholder's "handler wired" gate is a new optional prop `onOperatorPlaceholder` mirroring `onOperatorCompose`; the board route omits it | The plan names the gate ("no console handler wired"); the optional-prop precedent is exactly this shape | S:65 R:90 A:85 D:80 |
| 10 | Confident | The launcher renders its collapsed form on the operator route and its click focuses the strip; its own draft store is left alone | The launcher bypasses the seam today and would open a duplicate drawer; collapsed-with-focus-forward mirrors the change-2 open state; the draft handoff across stores is not worth its edge cases | S:55 R:80 A:70 D:65 |
| 11 | Certain | The Start button is rendered by the shared operator-less segment body; the page never hits that branch (its route requires the operator window), so no page-specific Start code | Structural fact of the route; the plan's "drawer and page" is satisfied by the shared body | S:70 R:85 A:85 D:80 |
| 12 | Confident | `Operator: Start operator` is listed on both form factors iff no operator; success navigates to `/$server/<windowId>` | Plan item 3 (palette, gated on absence) + the inverse of the `Fix tab name` availability gate; the palette has no drawer to retarget | S:60 R:80 A:70 D:70 |
| 13 | Confident | e2e stubs `POST /api/operator/start` for both outcomes; the real launch is a dev-box manual check; Go tests cover the mapping through a seam | CI has no fab-kit, so a real `rk operator` would fail deterministically there and pass locally — an environment-dependent test is worse than a stub | S:55 R:90 A:80 D:75 |
| 14 | Certain | The desktop `?tab=` handoff effect is deleted and its two e2e tests rewritten to assert the page's segment with the param retained | The param is no longer inert on desktop by construction | S:80 R:85 A:90 D:90 |
| 15 | Confident | `s.sseHub.wake(server)` after a successful start so the new window paints in one tick | The options handler's post-mutation precedent; without it the sidebar/drawer lag to the next poll | S:50 R:90 A:80 D:80 |
| 16 | Confident | The page's strip is the plain `TerminalActivityTabs` — no state/tick/pin/collapse row; the `pt-9` tongue clearance is mobile-only | Plan item 1 ("what the mobile operator route already renders"); the top-bar heading and the pinned row carry state on the page; desktop has no tongue | S:70 R:85 A:75 D:75 |

16 assumptions (6 certain, 9 confident, 1 tentative, 0 unresolved).
