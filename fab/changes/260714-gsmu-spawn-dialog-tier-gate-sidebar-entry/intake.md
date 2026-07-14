# Intake: Spawn Dialog Follow-up — Fab-Gated Tier Field + Sidebar Spawn Entry

**Change**: 260714-gsmu-spawn-dialog-tier-gate-sidebar-entry
**Created**: 2026-07-14

## Origin

Conversational. Follow-up from the `260714-q9cg-spawn-agent-dialog-mockup` session (2026-07-14,
PR #349) — after the v2 dialog shipped, the user raised two UX items and agreed on the approach
for both:

> 3) What does the agent list show if we aren't in a fab-kit project? Should it list down the
> agent available on the user's system - like claude / codex / gemini? Also - should it
> understand their effort / model options? Or maybe don't show this list without a folder
> containing fab-kit?
>
> 4) This Dialog should be accessible from the left panel also - Maybe a button to the left of
> + and x next to the session name? What icon? Or at some other place? Or maybe make + a drop
> down - one option for instantly opening window, the other for this dialog.

Decisions from the discussion (user confirmed both):

- **(3)** Hide the Agent Tier field when the target repo is not a fab project (the user's own
  third option, recommended and accepted). Do NOT enumerate system agents (claude/codex/gemini)
  or their model/effort options in rk — that rebuilds fab's tier abstraction (a tier already
  binds provider + model + effort) and couples rk to every CLI's flag grammar (Constitution III).
- **(4)** A dedicated icon button in the sidebar session row, placed LEFT of `+` (the user's own
  suggested placement), with a robot/bot icon. Rejected alternative: making `+` a dropdown —
  `+` is the instant fast path (creates a window immediately, no dialog); a menu taxes the most
  common action, and the top-bar window switcher already establishes the separate-items pattern
  (`+ New Window` / `+ New Agent`).

> **PREREQUISITE — read before creating the branch.** This change extends the spawn-dialog v2
> code from PR #349 (branch `260714-q9cg-spawn-agent-dialog-mockup`): the `tiers` field in the
> presets response, `spawn-agent-dialog.tsx` v2 fields, and `internal/riff` exist ONLY on that
> branch until #349 merges. Cut this change's branch from post-#349 `main`, or from
> `260714-q9cg-spawn-agent-dialog-mockup` directly if #349 has not merged yet. A branch cut from
> pre-#349 `main` will hard-block at apply (this exact blocker stalled q9cg against the unmerged
> PR #341 — verify `app/frontend/src/components/spawn-agent-dialog.tsx` exists before starting).

## Why

1. **The tier dropdown lies in non-fab repos.** `fabconfig.ReadTiers` never returns empty — a
   repo with no `fab/project/config.yaml` still shows the five built-ins (`default`, `doing`,
   `fast`, `operator`, `review`), and on spawn `fab agent <tier> --print` fails and silently
   falls back to `riff.DefaultLauncher` (`claude --dangerously-skip-permissions`). Every option
   produces the identical launcher; the choice is noise. If we don't gate it, users in non-fab
   repos reasonably conclude tiers do something there and mis-trust the control everywhere.
2. **The dialog is only reachable from Terminal routes.** Both shipped entry points (Cmd+K
   `Agent: Spawn`, window-switcher `+ New Agent`) are gated on a resolvable current session — on
   Cockpit, Server Cabin, or Board routes the action is absent. Spawning into any other session
   means first opening some window in it. A session-row button in the sidebar closes the gap and
   makes the spawn target explicit (any listed session, not just the current one).
3. **Why these shapes**: the fab gate derives from the filesystem at request time (Constitution
   II/VII — honest, no config); the sidebar button follows the existing row-cluster affordance
   pattern instead of adding chrome (Constitution IV) and keeps `+` instant.

## What Changes

### Backend: fab-project gate for `tiers` (`internal/fabconfig`, `api/riff.go`)

- New seam `fabconfig.IsFabProject(repoRoot string) bool` — true iff
  `{repoRoot}/fab/project/config.yaml` exists (an `os.Stat`; no YAML parse, no subprocess). Lives
  beside `ReadTiers` (it answers a question about the same file).
- `handleRiffPresets` gates the tiers read: `tiers = ReadTiers(repoRoot)` only when
  `IsFabProject(repoRoot)`; otherwise `tiers` is an **empty array** (`"tiers": []` — the key
  stays present, response shape unchanged/additive).
- `ReadTiers`'s own contract is UNCHANGED (built-ins fallback on malformed-but-present config —
  that is a fab project with a broken file, which still resolves tiers via fab-kit defaults).
  The absent-vs-malformed split is deliberate: absent config = not a fab project = `[]`;
  malformed config in a fab project = built-ins.
- `POST /api/riff` stays **permissive**: a non-empty `tier` against a non-fab repo is still
  accepted and resolves via the engine's existing silent `DefaultLauncher` fallback (the dialog
  never sends `tier` when the field is hidden; CLI parity and the documented fallback posture
  hold). No new 400.

### Frontend: conditional Agent Tier field (`spawn-agent-dialog.tsx`)

- The Agent Tier field (label `Agent Tier:`, aria-label `Agent tier`) renders only when the
  fetched `tiers` array is non-empty. `tiers.length === 0` → field absent entirely (no hint
  text, no disabled control) and `tier` is never sent in the POST body.
- The preflight-failure fallback is unchanged: when `getRiffPresets` rejects, the dialog keeps
  `[DEFAULT_TIER]` (`["default"]`) and the field shows — on failure we don't know whether the
  repo is a fab project, and showing the inert default is the conservative status quo.

### Frontend: sidebar session-row spawn entry (`sidebar/`, `app.tsx`)

- `session-row.tsx`: the trailing icon cluster `[🎨 palette] [+] [✕]` becomes
  `[🎨 palette] [🤖 bot] [+] [✕]` — the new button sits immediately LEFT of `+`, so `+`/`✕` keep
  their muscle-memory edge positions. Same affordance classes as siblings (hover-revealed
  `opacity-0 group-hover:opacity-100 coarse:opacity-100`, `min-h-[24px] coarse:min-h-[36px]`),
  `aria-label={`Spawn agent in ${session.name}`}`, `e.stopPropagation()` like the palette button.
- New `BotIcon` in `sidebar/icons.tsx` — a lucide-style `bot` (robot head) stroke SVG matching
  the existing `PaletteIcon` idiom (`stroke="currentColor"`, aria-hidden, same box size).
- Prop threading (mirror `onColorChange`'s optional pattern): Sidebar gains
  `onSpawnAgent?: (server: string, session: string) => void`, threaded index.tsx → SessionRow;
  the button renders only when the handler is present.
- `app.tsx`: the spawn target becomes explicit state — `spawnAgentTarget: {server, session} |
  null` replaces the boolean `showSpawnAgentDialog`. All three entry points set it: the palette
  action and window-switcher `+ New Agent` pass the CURRENT `{server, sessionName}` (behavior
  unchanged); the sidebar button passes the ROW's `{server, session}`. `SpawnAgentDialog` gains a
  `server` prop and issues `spawnRiff`/`getRiffPresets` against the TARGET server (the client
  fns already take `server` per-call via `withServer`), so cross-server spawn works. Title stays
  `Spawn agent in {session}`. On success, navigation to `/$server/$window` uses the target
  server (the existing falsy-windowId nav guard is preserved).
- Board-route sidebar (`/board/$name`) passes NO handler in v1 — the button is simply hidden
  there (see Non-Goals).

### Tests

- Go: `fabconfig` unit tests for `IsFabProject` (present/absent); `api/riff_test.go` — presets
  response has `tiers: []` for a non-fab repo root and populated tiers for a fab repo.
- Frontend unit: dialog hides the Agent Tier field when `tiers: []` (and omits `tier` from the
  submit body); sidebar SessionRow renders the bot button only with a handler and calls it with
  `(server, session)`; dialog uses the passed target server.
- e2e (`spawn-agent.spec.ts` + `.spec.md` companion, same commit — Constitution Test Companion
  Docs): a `tiers: []` presets mock renders the dialog WITHOUT the Agent Tier field; the sidebar
  bot button opens the dialog titled with the row's session. Playwright notes: the row icon
  cluster is hover-gated — `.hover()` the row before clicking (pointer-events memory); keep
  trailing-`*` route globs (`withServer` appends `?server=`); run via `just test-e2e` /
  `just pw` only.

### Non-Goals

- No system-agent enumeration (claude/codex/gemini) and no model/effort pickers in rk — tiers
  remain fab's abstraction; configure `agent.tiers`/`providers` in fab for new options.
- No hint text in place of the hidden tier field.
- No board-route (`/board/$name`) spawn button in v1 — the optional-handler threading makes it a
  cheap later addition.
- No change to `+` (stays instant window creation) and no dropdown on it.

## Affected Memory

- `run-kit/architecture`: (modify) presets endpoint row — `tiers` gated on fab-project detection
  (`fabconfig.IsFabProject`), `tiers: []` for non-fab repos
- `run-kit/ui-patterns`: (modify) spawn dialog v2 section — conditional Agent Tier field, the
  third entry point (sidebar session-row bot button, cluster order palette→bot→+→✕), explicit
  `{server, session}` spawn target enabling cross-server spawn
- `run-kit/rk-riff`: (modify) fabconfig package section — `IsFabProject` beside
  `ReadTiers`/`ReadPresets`

## Impact

- `app/backend/internal/fabconfig/fabconfig.go` (+ `fabconfig_test.go`) — `IsFabProject`
- `app/backend/api/riff.go` (+ `riff_test.go`) — gate `tiers` in `handleRiffPresets`
- `app/frontend/src/components/spawn-agent-dialog.tsx` (+ `.test.tsx`) — conditional field,
  `server` prop
- `app/frontend/src/components/sidebar/session-row.tsx` (+ `.test.tsx`), `sidebar/icons.tsx`,
  `sidebar/index.tsx` — BotIcon, button, prop threading
- `app/frontend/src/app.tsx` — `spawnAgentTarget` state, handler wiring for all three entry
  points
- `app/frontend/tests/e2e/spawn-agent.spec.ts` + `.spec.md` — new cases (same commit)
- Constitution: I (no new subprocess inputs — the gate is an `os.Stat`), II/VII (state derived
  from filesystem at request time), III (no launcher/tier reinvention), IV (no new chrome beyond
  a row icon), V (palette action unchanged; button follows existing row-button keyboard
  semantics), IX (GET response additive — `tiers` key present, possibly empty)
- **Branch base**: post-#349 `main`, or `260714-q9cg-spawn-agent-dialog-mockup` while #349 is
  open (see the PREREQUISITE note in Origin)

## Open Questions

- None — both decisions were made explicitly in the originating discussion.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Tier field gated on `IsFabProject` (config.yaml `os.Stat` at session repo root); endpoint returns `tiers: []` for non-fab repos; dialog hides field on empty tiers | Discussed — user agreed with this exact recommendation over system-agent enumeration | S:90 R:85 A:90 D:90 |
| 2 | Certain | Sidebar entry = dedicated button LEFT of `+` in the session-row cluster; `+` stays instant (no dropdown) | Discussed — user's suggested placement, confirmed; dropdown-on-+ explicitly rejected (taxes fast path, top-bar precedent) | S:90 R:85 A:90 D:85 |
| 3 | Certain | Prerequisite branch base: post-#349 main or `260714-q9cg-spawn-agent-dialog-mockup` — target files exist only there | Verified this session (q9cg hit the identical blocker against unmerged #341) | S:95 R:80 A:95 D:95 |
| 4 | Confident | Icon = lucide-style `bot` stroke SVG (`BotIcon` in sidebar/icons.tsx, PaletteIcon idiom); aria `Spawn agent in {session}` | Proposed in discussion (vs ✦/⚡), user proceeded; trivially swappable asset | S:70 R:85 A:80 D:70 |
| 5 | Confident | Spawn target becomes explicit `{server, session}`; dialog gains `server` prop; cross-server spawn supported | Falls out of sidebar threading; client fns already server-scoped per call via `withServer` | S:65 R:75 A:80 D:75 |
| 6 | Confident | `POST /api/riff` stays permissive for `tier` in non-fab repos (silent `DefaultLauncher` fallback, no new 400) | Hidden field never sends tier; rejecting would diverge from the engine's documented fallback posture | S:60 R:85 A:80 D:75 |
| 7 | Confident | No hint text when the tier field is hidden; preflight-FAILURE fallback keeps `[DEFAULT_TIER]` (field shows) | Minimal surface; on fetch failure fab-ness is unknown — status quo is conservative | S:60 R:90 A:80 D:70 |
| 8 | Confident | Board-route sidebar gets no `onSpawnAgent` handler in v1 (button hidden there) | Optional-prop pattern makes later wiring cheap; board spawn demand unproven | S:55 R:90 A:75 D:70 |

8 assumptions (3 certain, 5 confident, 0 tentative, 0 unresolved).
