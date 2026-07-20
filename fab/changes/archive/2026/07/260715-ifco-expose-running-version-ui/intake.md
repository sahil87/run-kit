# Intake: Expose Running Version in Web UI

**Change**: 260715-ifco-expose-running-version-ui
**Created**: 2026-07-15

## Origin

Synthesized from a discussion session (promptless dispatch — `_intake` procedure with `{questioning-mode} = promptless-defer`). The user explored where and how the *currently running* run-kit version should surface in the web UI, verified the existing version plumbing in this session, agreed on exactly four display surfaces, and explicitly rejected four alternatives. The description below captures those decisions faithfully.

> **Feature**: Expose the currently running run-kit version in the web UI — steady-state visibility of the *current* version, which today is invisible unless an update is pending. Frontend-only: the version already flows to every tab.
>
> Four surfaces: (1) a command palette version entry whose label carries the version itself, copy-to-clipboard on select; (2) the top-bar connection-dot hover title extended with the version; (3) a small passive BIOS/boot-style stamp on the Cockpit page; (4) the UpdateChip's hover title showing the `v<current> → v<latest>` transition instead of only the target.

## Why

1. **The pain point**: The running version is invisible in the web UI during steady state. The only version surface today is the `UpdateChip` — which renders *only when a qualifying update is pending* and names *only the target* version. A user filing a bug report, checking whether a restart picked up a new build, or comparing two machines has no way to answer "what version am I on?" from the browser; they must shell into the host and run `rk --version`.

2. **The consequence of not doing it**: Bug reports arrive without version info; post-update verification requires SSH; the `v<current> → v<latest>` context is missing from update decisions (the chip says where you're going but not where you are).

3. **Why this approach**: The data already reaches every tab — the daemon pushes its version over a server-global SSE `event: version` replayed on connect, and the frontend already holds it as `daemonVersion` in session context. So this is a pure display change: four small, passive surfaces on existing chrome, honoring Constitution IV (minimal surface — no new pages, routes, panels, or top-bar buttons) and Constitution V (keyboard-first — the palette entry is the primary discovery surface). Alternatives that added chrome or new fetches were explicitly rejected (see Rejected Alternatives below).

## What Changes

### Existing infrastructure (verified in this session — ground truth)

- `main.version` is ldflags-injected at build time; `var version = "dev"` sentinel for local builds (`app/backend/cmd/rk/root.go:10-11`), with a `displayVersion()` helper (root.go:16-21) that prefixes `v` to numeric versions and leaves `dev` bare. `rk --version` already works.
- The daemon pushes its version to clients over a server-global SSE `event: version` (payload `{version, boot, brew}`), replayed on connect — wired via `apiServer.SetVersion(version, newBootID(), resolveBrewInstalled())` (`app/backend/cmd/rk/serve.go:139-150`).
- The frontend holds it as `daemonVersion: string | null` in session context (`app/frontend/src/contexts/session-context.tsx:119,247`), alongside `updateAvailable: { current: string; latest: string } | null` (line 122/253) and a `brew` flag. The `useUpdateNotification()` hook (session-context.tsx:1086) already exposes `daemonVersion`, `latest`, `qualifies`, `showChip`, `brew`, and the update/restart actions — and is tolerant of a missing provider.
- `UpdateChip` (`app/frontend/src/components/top-bar.tsx:1932`) renders in the top-bar right cluster only when a qualifying update is pending; its `title`/`aria-label` (top-bar.tsx:1958-1959) currently name only the TARGET version (`Update run-kit to v${latest}`).
- The top-bar connection status dot (top-bar.tsx:712-725) is the right-most L3 element, `hidden sm:inline`, and carries only `aria-label={isConnected ? "Connected" : "Disconnected"}` — no `title` today. Its meaning is per-page live-data health, but the element itself represents "the daemon's stream".
- Command palette update actions are built by a pure builder module (`app/frontend/src/lib/palette-update.ts` — `buildUpdateActions` + `buildMaintenanceActions`), with a local `DEV_VERSION = "dev"` sentinel constant and a colocated `palette-update.test.ts`. This is the pattern to follow.
- On phone board routes the top-bar right cluster is hidden below `sm` and the palette is the designated fallback surface (comments at `app/frontend/src/components/board/board-page.tsx:354-360` and `464-473`; update actions are dual-mounted into the AppShell palette at `app/frontend/src/app.tsx:1726,1747` and the board's own palette for this reason).
- The Cockpit page `/` is `ServerListPage` (`app/frontend/src/components/server-list-page.tsx`, 448 lines) — four zones: HOST HEALTH (line 218), BOARDS (242), TMUX SERVERS (293), SERVICES (365).
- A clipboard helper already exists: `app/frontend/src/lib/clipboard.ts` `copyToClipboard(text)` — Clipboard API first, `execCommand` fallback for non-secure contexts, currently returns `void` and silently swallows total failure.
- A toast system already exists: `app/frontend/src/components/toast.tsx` — `useToast().addToast(message, variant)` with variants `"error" | "info"`, 4s duration.

### 1. Command palette version entry (new pure builder module)

New module `app/frontend/src/lib/palette-version.ts` following the `palette-update.ts` pattern (pure, dependency-free, unit-testable), with colocated `palette-version.test.ts`:

```ts
export function buildVersionAction(
  version: string | null,
  onSelect: () => void,
): PaletteAction[] {
  if (!version) return [];  // no version event yet — omit, never render a placeholder
  return [{
    id: "run-kit-version",
    label: `run-kit: Version — ${displayVersion(version)}`,  // e.g. `run-kit: Version — v0.6.2`; dev → `run-kit: Version — dev`
    onSelect,
  }];
}
```

- The LABEL carries the version itself, so typing "version" in the palette answers the question without selecting anything.
- The display form mirrors the backend's `displayVersion()` convention: `v` prefix for numeric versions, `dev` shown bare (no `vdev`).
- **On select**: copy the displayed version string to the clipboard via `lib/clipboard.ts` `copyToClipboard`, then confirmation toast (`addToast("Version copied", "info")`) on success, error toast on failure (useful for bug reports). To detect failure, `copyToClipboard` is extended to return `Promise<boolean>` (success signal) — a backwards-compatible change; existing callers (`terminal-client.tsx`) ignore the return value.
- **Gating**: shown whenever `daemonVersion` is non-null — *including* the `dev` sentinel. This change is pure DISPLAY, so showing `dev` as-is is acceptable and useful, unlike the update/restart actions which gate on it. (Explicit decision from the discussion.)
- **Dual-mounted** like the update actions: into the AppShell palette (app.tsx) and the board route's own palette (board-page.tsx `boardRouteActions`) — below `sm` the top-bar right cluster is hidden, so on a phone `/board/$name` the palette is the ONLY version surface.

### 2. Connection-dot tooltip (top-bar.tsx)

The connection status dot already represents "the daemon" — extend its hover `title` to include the version. Zero new chrome:

- Connected + version known: `title="Connected — run-kit v0.6.2"` (dev: `Connected — run-kit dev`)
- Connected, version not yet received: `title="Connected"` (omit the version fragment — never `vundefined`)
- Disconnected: `title="Disconnected"`
- The existing `aria-label` stays as-is (`Connected`/`Disconnected`) — the version is hover-discovery detail, not screen-reader-essential state on a `role="status"` live region.

The dot's TopBar receives `isConnected` as a prop today; `daemonVersion` is read via `useUpdateNotification()` (already imported in top-bar.tsx for UpdateChip).

### 3. Cockpit stamp (server-list-page.tsx)

A small, passive BIOS/boot-style `run-kit v0.6.2` line on the Cockpit page `/` (`ServerListPage`), on-brand with the project's CRT/terminal aesthetic (monospace everywhere; text-secondary tone):

- Placement: a passive footer line at the bottom of the page's scroll container, after the SERVICES zone — quiet, out of the zone hierarchy, like a BIOS POST footer. <!-- assumed: exact placement (bottom footer after SERVICES) — discussion specified "small, passive BIOS/boot-style line on the Cockpit page" without naming a position; footer best fits "passive" -->
- Content: `run-kit v0.6.2` (dev: `run-kit dev`), e.g. `text-xs text-text-secondary` — no border, no interaction, no hover treatment (passive means passive; the hover-vocabulary categories don't apply to inert text).
- Hidden entirely while `daemonVersion` is null (render nothing, not a placeholder).

### 4. UpdateChip hover (top-bar.tsx:1932-1959)

When an update IS pending, the chip's `title` and `aria-label` show the transition instead of only the target:

- Before: `Update run-kit to v${latest}`
- After: `Update run-kit: v${current} → v${latest}` (exact phrasing may be tuned at apply; the requirement is that BOTH versions appear as a transition)
- `current` comes from `updateAvailable.current` — always present whenever the chip renders (the chip's `qualifies` gate requires a received `update-available` event, whose payload carries both fields). Expose it through `useUpdateNotification()` (add a `current: string | null` field derived from `updateAvailable?.current ?? null`), keeping the chip's single-hook pattern. Degrade: if `current` is somehow null, fall back to the existing target-only wording.
- The `updating…` state's title/aria (`Updating run-kit` / `Updating…`) is unchanged. One-line-scale change.

### Rejected alternatives (record so they are not re-proposed)

- **A `?` help-menu icon in the top bar** — new chrome in an already-crowded uniform right cluster, violates Constitution IV (minimal surface) and is mouse-first against Constitution V (keyboard-first). Explicitly rejected by the user.
- **Logo-click → version popup with changelog** — conflicts with the mobile behavior where the logo is the sidebar drawer toggle; splitting the logo's glitch/rotation hover treatments subdivides the one-treatment-per-category hover vocabulary; a last-5-patches changelog would require a new GitHub list fetch (updatecheck only fetches `/releases/latest`) plus a new popup surface. Rejected; at most a future hover-only tooltip easter egg, NOT in this change's scope.
- **Bottom-bar version stamp** — the 375px single-row chip budget has no slack.
- **`X-RunKit-Version` HTTP response header** — SSE already carries the version; not needed.

### Constraints / edge cases

- **`daemonVersion` is null until the first SSE version event** — every surface must degrade gracefully: hide/omit rather than render a placeholder like `vundefined`. (Palette entry absent; dot title without the version fragment; Cockpit stamp not rendered; UpdateChip already can't render without the update-available event.)
- **The `dev` sentinel**: pure display — show `dev` as-is (e.g. `run-kit dev`), unlike the update/restart actions which gate on it. Stated decision.
- **Clipboard API may be unavailable** (non-secure context) — `lib/clipboard.ts` already falls back to `execCommand`; the palette action fails soft with an error toast on total failure (via the new boolean return).
- **Tests** per `fab/project/code-quality.md`: Vitest unit tests for the new pure builder (`palette-version.test.ts`) and touched components (top-bar / server-list-page / clipboard tests as applicable). No new Playwright spec is required for this chrome-level change; if any Playwright spec IS added or modified, its sibling `.spec.md` companion must be updated in the same commit (constitution Test Companion Docs rule).
- **No new routes, no new pages, no backend changes expected.** No new SSE events, no new endpoints, no polling.

## Affected Memory

- `run-kit/ui-patterns`: (modify) extend the update-notification / chrome bullets with the four steady-state version surfaces (palette version entry via pure `buildVersionAction` in `lib/palette-version.ts` dual-mounted like the update actions, connection-dot version title, Cockpit footer stamp, UpdateChip transition title) and the `copyToClipboard` success-boolean extension

## Impact

Frontend-only; five source files plus tests:

- `app/frontend/src/lib/palette-version.ts` — new pure builder (+ `palette-version.test.ts`)
- `app/frontend/src/lib/clipboard.ts` — return `Promise<boolean>` success signal (backwards-compatible)
- `app/frontend/src/contexts/session-context.tsx` — add `current` to `useUpdateNotification()` return
- `app/frontend/src/components/top-bar.tsx` — connection-dot `title`; UpdateChip `title`/`aria-label` transition
- `app/frontend/src/components/server-list-page.tsx` — Cockpit footer stamp
- `app/frontend/src/app.tsx` + `app/frontend/src/components/board/board-page.tsx` — mount the version palette entry in both palettes

No backend changes. No new routes (Constitution IV). No database/state (Constitution II). Keyboard-first discovery preserved (Constitution V — palette is the primary surface). Existing e2e specs unaffected in expectation; unit test suite grows by one module plus touched-component cases.

## Open Questions

None — the discussion session resolved the surface set, rejected alternatives, sentinel/null handling, and test obligations. Remaining micro-decisions (exact footer placement, exact title phrasing) are graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope is exactly the four agreed surfaces (palette entry, dot tooltip, Cockpit stamp, UpdateChip hover) — frontend-only, nothing more | Discussed — "all four, nothing more"; no backend/routes/pages | S:95 R:85 A:90 D:95 |
| 2 | Certain | Version data source is the existing SSE-fed `daemonVersion` in session context (via `useUpdateNotification`) — no new plumbing | Verified in code this session (session-context.tsx:119, serve.go:146) | S:90 R:90 A:95 D:95 |
| 3 | Certain | Null `daemonVersion` → every surface hides/omits (no `vundefined` placeholder) | Explicit constraint from discussion | S:90 R:90 A:95 D:90 |
| 4 | Certain | `dev` sentinel shown as-is (`run-kit dev`) — display-only, unlike dev-gated update/restart actions | Explicit decision from discussion ("state this decision") | S:90 R:90 A:95 D:90 |
| 5 | Certain | Rejected alternatives (help icon, logo popup, bottom-bar stamp, HTTP header) stay out of scope | Explicit user rejections recorded in discussion | S:95 R:90 A:95 D:95 |
| 6 | Certain | Palette entry implemented as pure builder `lib/palette-version.ts` following the `palette-update.ts` pattern, with colocated Vitest unit tests | Discussed — "implement as a pure builder module following the palette-update.ts pattern"; pattern verified (5 existing palette-*.ts + tests) | S:90 R:85 A:90 D:90 |
| 7 | Certain | UpdateChip transition sources `current` from `updateAvailable.current`, exposed via a new `current` field on `useUpdateNotification()` | Verified shape `{current, latest}` (session-context.tsx:122); chip already uses the hook; fallback to target-only wording if null | S:90 R:90 A:90 D:85 |
| 8 | Certain | Copy feedback uses the existing toast system (`useToast` — `"info"` confirmation, `"error"` failure) | Verified toast.tsx exists with exactly these two variants | S:80 R:90 A:95 D:90 |
| 9 | Certain | Version palette entry dual-mounted (AppShell palette + board route palette), mirroring the update actions | Discussed — phone board palette is the designated fallback surface (board-page.tsx:354-360,464-473) | S:85 R:85 A:90 D:90 |
| 10 | Certain | Palette label format `run-kit: Version — v0.6.2` per the discussed example; display form mirrors backend `displayVersion()` (v-prefix numeric, bare `dev`) | Discussion gave the example verbatim; backend convention verified (root.go:16-21) | S:80 R:90 A:85 D:80 |
| 11 | Confident | Copied string is the displayed form (`v0.6.2` / `dev`), matching the palette label | Discussion said "copy the version string" without specifying raw vs display; what-you-see-is-what-you-copy is the obvious default for bug reports | S:60 R:95 A:75 D:65 |
| 12 | Confident | Extend `copyToClipboard` to return `Promise<boolean>` so the palette action can toast error vs confirmation; existing callers unaffected | Current helper swallows failure (returns void) — a success signal is needed to honor "fail soft with an error toast"; backwards-compatible | S:70 R:90 A:80 D:70 |
| 13 | Confident | Connection-dot gets a `title` attribute (`Connected — run-kit v0.6.2` / `Connected` / `Disconnected`); `aria-label` unchanged | Discussion said "extend its hover title"; dot currently has aria-label only — title is the hover surface, aria stays concise on the live region | S:70 R:90 A:80 D:70 |
| 14 | Confident | Cockpit stamp placed as a passive footer line at the bottom of the page after the SERVICES zone, `text-xs text-text-secondary`, no interaction | Discussion specified style ("small, passive BIOS/boot-style") but not position; footer best fits "passive"; trivially movable | S:55 R:95 A:70 D:60 |
| 15 | Confident | No new Playwright spec required — Vitest unit/component tests cover the change; any spec added at apply carries its sibling `.spec.md` in the same commit | code-quality.md says e2e SHOULD accompany UI changes "where possible"; these are chrome-level details best unit-tested; constitution companion rule restated for the conditional case | S:65 R:90 A:80 D:70 |

15 assumptions (10 certain, 5 confident, 0 tentative, 0 unresolved).
