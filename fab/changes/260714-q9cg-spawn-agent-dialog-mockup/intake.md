# Intake: Spawn-Agent Dialog v2 — Match the Original UI Mockup

**Change**: 260714-q9cg-spawn-agent-dialog-mockup
**Created**: 2026-07-14

## Origin

Conversational. During a `/fab-discuss` DX session (2026-07-13) a UI mockup for the web
spawn-agent dialog was designed and agreed on. The backlog entry distilled from that session
(`[sbk1]`, implemented as PR #341 `260713-sbk1-web-spawn-agent`) deliberately scoped the dialog
down to two fields (Task + Preset) and cut the rest of the mockup as out-of-scope. The user then
asked for a follow-up:

> When 4 [Spawn agent] got implemented, the UI mockup you created got missed out. Maybe it wasn't
> there in the backlog. Can you create a new intake for the "Spawn agent" task — with the UI
> mockup. Do it in the main worktree.

Key context from the discussion session: the spawn engine is `internal/riff` (extracted from the
`rk riff` CLI in PR #341); task injection rides the launcher positional arg (auto-submits — the
paste-unsubmitted variant remains deferred, no boot-complete hook event exists); the sbk1
out-of-scope cuts (tier picker, spawn-into-checkout) were feasibility-driven at the time and have
now been re-verified as feasible (see What Changes).

## Why

PR #341 made spawning work from the web UI, but the shipped dialog hides three spawn-shaping
decisions the mockup deliberately surfaced:

1. **Isolation** — you cannot do a quick non-isolated run ("this checkout") from the UI; every
   spawn creates a worktree even when you just want an agent in the existing checkout with a task.
2. **Worktree identity** — the worktree (and therefore the `riff-<basename>` window name) is
   always a random adjective-noun pair; you cannot name it, so sidebar rows for parallel agents
   stay semantically opaque (`riff-swift-fox` tells you nothing about which task it runs).
3. **What will launch** — the dialog gives no indication of which agent/tier (and therefore which
   model and token budget) a spawn will consume; the launcher is silently the `default` tier.

If we don't close the gap, the dialog stays a thin trigger rather than the one-action spawn
surface the mockup designed — users fall back to the CLI for any spawn that needs a name, a tier,
or no isolation, which defeats the point of web/mobile spawning (the strategic "multi-agent
density" lane from `docs/wiki/competitive-landscape.md`).

Why now: both cut features were blocked on unverified CLI seams at sbk1 time. Both seams are now
verified to exist: `wt create --worktree-name <name>` (name override, skips the name prompt) and
`fab agent [tier] --print` (tier is a positional; prints the fully-resolved session command).
No new fab-kit or wt work is required.

## What Changes

### The target UI (the mockup — authoritative for this change)

```
Spawn agent in runKit                        ← title carries the target session name
┌──────────────────────────────────────────────┐
│ Task      [ fix the sidebar flicker on nav ] │  ← optional (unchanged: blank = empty session)
│ Preset    [ (none) ▾ ]                       │  ← shipped in PR #341, stays
│ Where     (•) new worktree  ( ) this checkout│  ← NEW: isolation choice
│ Worktree  [ swift-fox ✎ ]      (auto-named)  │  ← NEW: editable name; hidden for "this checkout"
│ Agent     [ doing ▾ ]                        │  ← NEW: tier dropdown, default = "default"
└──────────────────────────────────────────────┘
          [ Spawn ⏎ ]                            ← Enter submits from any field (unchanged)
```

Field order: Task → Preset → Where → Worktree → Agent. The Preset field postdates the mockup
(shipped in PR #341) and is kept. Dialog title becomes `Spawn agent in {session}` (currently the
static "Spawn agent"). All shipped behavior is preserved: task optional, Enter-submits, busy state
with double-submit guard, in-dialog error rendering, close-and-navigate on success, best-effort
preset fetch.

### Dialog field: Where (radio)

- Two options: **new worktree** (default — today's behavior, unchanged) and **this checkout**.
- "This checkout" skips `wt create` entirely: the engine opens the tmux window rooted at the
  session's derived repo root (the same `active-pane cwd → FindGitRoot` derivation the endpoint
  already performs) and launches the agent + task there. Window naming keeps the `riff-` prefix
  and `resolveWindowName` collision suffixing (base = `riff-<repo-basename>`), so agent windows
  stay recognizable in the sidebar.
- When "this checkout" is selected the Worktree field is hidden (or disabled) — it has no meaning.
- Engine: worktree creation becomes conditional in `internal/riff`; the CLI path always passes
  "worktree" so `rk riff` behavior is byte-identical.

### Dialog field: Worktree (editable name, auto-named default)

- An optional text input, blank by default with placeholder `auto-named (e.g. swift-fox)`. Blank
  = today's behavior (`wt create` generates the name). A typed name is passed through to
  `wt create --worktree-name <name>` (verified flag; skips wt's name prompt).
- If `wt` exposes a name-suggestion seam (check during apply), pre-fill the input with a suggested
  name per the mockup; if not, the placeholder form ships — do NOT reimplement wt's generator in
  rk (Constitution III).
- Validation: the name is user input crossing into a subprocess — validate charset/length via
  `internal/validate` before it reaches any argv (Constitution I); reject with in-dialog 400
  message on failure. Collision with an existing worktree surfaces `wt create`'s own error
  in-dialog (nothing created).

### Dialog field: Agent (tier dropdown)

- A dropdown of fab agent tiers. Default selection: `default` (today's implicit behavior —
  selecting it must produce a byte-identical launcher to the shipped path).
- Options: the tier names defined under `agent.tiers` in `fab/project/config.yaml` (best-effort
  read in the `internal/fabconfig` silent-fallback style) unioned with fab-kit's built-in tier
  names (`default`, `doing`, `fast`, `operator`, `review`). Display the tier name; optionally show
  the resolved command as a tooltip/subtitle if cheaply available — do not parse model IDs out of
  command strings (brittle).
- Backend: the engine's launcher resolution gains a tier parameter — `fab agent <tier> --print`
  (tier positional verified) with the existing `parseFabAgentOutput` single-line contract and
  `defaultLauncher` silent fallback unchanged. Empty/absent tier = no positional = today's path.

### Endpoint changes

- `POST /api/riff` body gains three optional fields (additive; Constitution IX unchanged):

  ```json
  { "task": "...", "preset": "...", "session": "...",
    "where": "worktree" | "checkout",   // default "worktree"
    "worktreeName": "my-name",           // optional; only valid with where=worktree
    "tier": "doing" }                    // optional; default "" = default tier
  ```

  Validation: unknown `where` value → 400; `worktreeName` with `where=checkout` → 400;
  `worktreeName`/`tier` charset-validated before subprocess use.
- `GET /api/riff/presets` response gains an additive `tiers` array (names, `default` first) so the
  dialog populates both dropdowns from the single existing preflight fetch — no new endpoint.
  (If the shipped response shape is a bare array rather than an object, wrap additively —
  `{"presets": [...], "tiers": [...]}` — and update the one shipped caller in the same change.)

### Out of scope (carried forward from sbk1, still deferred)

- Fan-out `count > 1` in the UI (engine supports it; expose later).
- Unsubmitted-paste task injection (still no boot-ready signal in the `@rk_agent_state` registry).
- Per-pane composition UI (multiple skills/cmds per spawn) and preset editing.
- Provider selection beyond tiers (a tier already binds provider + model + effort).

## Affected Memory

- `run-kit/rk-riff`: (modify) engine gains tier-parameterized launcher resolution, conditional
  worktree creation (checkout mode), and `--worktree-name` passthrough; CLI unchanged
- `run-kit/architecture`: (modify) `POST /api/riff` body extension (`where`/`worktreeName`/`tier`)
  and the presets-response `tiers` addition
- `run-kit/ui-patterns`: (modify) spawn dialog v2 field set, conditional Worktree field, tier
  dropdown, session-named title

## Impact

- `app/backend/internal/riff/` — spec + launcher resolution + conditional worktree creation
  (riff.go, spec.go + tests)
- `app/backend/api/riff.go` (+ `riff_test.go`) — body fields, validation, tiers in preset response
- `app/backend/cmd/rk/riff.go` — call-site updates only; CLI flags and behavior byte-identical
  (existing `riff_test.go` coverage must stay green)
- `app/frontend/src/components/spawn-agent-dialog.tsx` (+ test) — three new fields, conditional
  visibility, title
- `app/frontend/src/api/client.ts` — `spawnRiff` params, presets/tiers response type
- `app/frontend/tests/e2e/spawn-agent.spec.ts` + `.spec.md` — extend the existing e2e (mocked
  routes keep the trailing `*` — `withServer` appends `?server=`); companion doc updated in the
  same commit (constitution Test Companion Docs); run via `just test-e2e` / `just pw` only
- Constitution: I (validate `worktreeName`/`tier` before argv), III (wt + fab wrapped — no name
  generator or tier resolver reimplemented in rk), V (all new fields keyboard-reachable; the
  palette entry point is unchanged), IX (POST-only, additive body)

## Open Questions

- None — the mockup fixes the field set, and both previously-blocking CLI seams are verified.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Tier resolution via `fab agent <tier> --print` (positional tier) | Verified against `fab agent --help` during intake; existing parse/fallback contract reused | S:90 R:85 A:95 D:90 |
| 2 | Certain | Worktree name override via `wt create --worktree-name` passthrough | Verified against `wt create --help` during intake; flag skips the name prompt | S:90 R:85 A:95 D:90 |
| 3 | Certain | Task injection unchanged — launcher positional arg, auto-submits | Decided in sbk1 (intake + memory record); explicitly carried forward | S:95 R:90 A:95 D:95 |
| 4 | Confident | "This checkout" = skip `wt create`, window at session repo root, keep `riff-` prefix + collision suffixing | Mockup names the option; naming keeps agent windows recognizable — prefix choice is easily reversible | S:75 R:75 A:80 D:70 |
| 5 | Confident | Worktree field ships blank-with-placeholder; pre-filled suggestion only if wt exposes a name-suggest seam (checked during apply, never reimplemented in rk) | Mockup shows a pre-filled name but Constitution III forbids duplicating wt's generator; placeholder is the honest fallback | S:60 R:80 A:70 D:65 |
| 6 | Confident | Tier dropdown = best-effort `agent.tiers` keys ∪ fab built-ins, default-first; name-only display | Enumeration source isn't user-specified; fabconfig silent-fallback style is the established pattern | S:60 R:75 A:70 D:65 |
| 7 | Confident | Extend `GET /api/riff/presets` with additive `tiers` field rather than a new endpoint | One preflight fetch already exists; additive JSON is backward-compatible; Constitution IV minimal-surface | S:60 R:85 A:80 D:75 |
| 8 | Confident | Field order Task → Preset → Where → Worktree → Agent; title `Spawn agent in {session}`; Worktree hidden when checkout selected | Mockup is authoritative for new fields; Preset placement (postdates mockup) is the only inferred slot | S:70 R:90 A:80 D:75 |

8 assumptions (3 certain, 5 confident, 0 tentative, 0 unresolved).
