# Intake: Toolkit Manifest Update Notifications

**Change**: 260718-d15e-toolkit-manifest-update-notifications
**Created**: 2026-07-19

## Origin

Conversational — a `/fab-discuss` session on update notifications, then `/fab-draft`. The user's raw asks, in sequence:

> Lets discuss the update notifications built into run-kit. I am thinking - instead of running "run-kit update", should those updates run "shll update"? but then where does the version come from? shll or run-kit? … right now there is no way to remind the user to update the whole of the shll kit.

> moving to "shll update" is a good idea. (fallback - run-kit update). Then the question is how to check if "shll update" notification should be shown - whats the composite key, and where is it checked from? I don't want an answer that's not reversible easily. … Should this then be a page on shll.ai meant for this? That lists the latest version of each tool, which then goes through the above logic, to decide if it's worth it to show an update notification. Checked every 6 or 12 hrs or when run-kit daemon restarts.

> for 3 - the mechanism that pulls the latest help json files, can be mechanism to update the manifest. 4 - agreed. 1, 2 - agreed. Now regarding what gets updated when there's a match - lets start with updating only those tools which do get a match.

Decisions reached in discussion: remediation is a **scoped** `shll update <matched tools…>` (fallback `rk update` when shll is absent); detection reads a **version manifest on shll.ai** (produced by shll.ai's existing help-dump puller, which brew-installs every tool daily and captures envelopes that already carry `version`); per-tool **notify policy lives in the manifest**, not in rk code (reversibility — tuning policy must never require shipping a binary through the channel being tuned); the **composite dismissal key** is the sorted set of matched `tool@latest` pairs; checker **cadence is unchanged** (30s-after-boot initial check + 6h ticker — the "on daemon restart" ask is already satisfied by the existing `initialCheckDelay`).

A **sibling change in the shll.ai repo** (drafted in the same session) adds the manifest generator + policy file. The manifest schema below is the cross-repo contract between the two changes.

## Why

1. **The gap**: run-kit's update checker (`internal/updatecheck`) notifies only about run-kit itself. The rest of the shll toolkit (shll, wt, idea, tu, hop, fab-kit) has no reminder surface anywhere — run-kit is the only roster tool with a daemon and a UI, so it is the only place a passive reminder can live. Without this, toolkit installs silently drift stale.
2. **Skew risk**: updating run-kit alone can skew cross-repo contracts (run-kit ↔ fab-kit share the `@rk_agent_state` convention). `shll update` keeps matched tools moving together.
3. **Why a manifest instead of per-repo GitHub polling**: one static CDN fetch instead of 7 unauthenticated GitHub API calls from a GCP box (datacenter IPs get throttled more aggressively than the nominal 60/hr); shll.ai owns the roster (run-kit never hardcodes the tool list); and brew is the *correct* version source — remediation installs from the tap, so sourcing versions from what the puller actually brew-installed means the chip never advertises an update the remediation can't deliver (a GitHub release exists for a window before its formula bumps).
4. **Why policy-in-manifest**: the classic update-checker trap is policy compiled into the binary — fixing a bad threshold requires shipping an update through the very mechanism being tuned, to every deployed daemon. Manifest-carried policy is edited centrally and picked up within one poll cycle.

## What Changes

### 1. Checker source: GitHub Releases API → shll.ai manifest

`internal/updatecheck/updatecheck.go` swaps its fetch from `https://api.github.com/repos/sahil87/run-kit/releases/latest` to the manifest:

```
https://shll.ai/versions.json
```

Expected schema (cross-repo contract with the shll.ai sibling change — additive evolution under `"schema": 1`):

```json
{
  "schema": 1,
  "generated_at": "2026-07-19T07:13:00Z",
  "tools": {
    "shll":    { "latest": "0.1.6",  "notify": "patch", "formula": "shll" },
    "wt":      { "latest": "0.1.4",  "notify": "never", "formula": "wt" },
    "idea":    { "latest": "0.1.1",  "notify": "never", "formula": "idea" },
    "tu":      { "latest": "0.9.2",  "notify": "patch", "formula": "tu" },
    "run-kit": { "latest": "3.9.0",  "notify": "minor", "formula": "run-kit" },
    "hop":     { "latest": "0.2.1",  "notify": "never", "formula": "hop" },
    "fab-kit": { "latest": "2.17.0", "notify": "minor", "formula": "fab-kit" }
  }
}
```

(Values illustrative; the authoritative per-tool `notify` values are owned by the shll.ai repo's policy file, NOT by this change. rk applies whatever the manifest says, verbatim.)

Unchanged checker behavior: cadence (`initialCheckDelay` 30s + `checkInterval` 6h), the 10s context-bound fetch (Constitution I), stale-while-revalidate on fetch/parse failure (retain previous verdict, warn, never crash), and **whole-checker suppression for dev/unparseable running versions** (a dev build never polls — same as today, which also keeps e2e runs off the network). There is deliberately **no GitHub-releases fallback** when the manifest is unreachable — stale-while-revalidate covers transient failures, and full revert to today's fetcher is the escape hatch if shll.ai goes away.

### 2. Match computation (new)

For each manifest tool, compute `matched = crossesThreshold(installed, latest, notify)`:

- `notify: "never"` → never matches.
- `notify: "patch"` → matches on any version increase.
- `notify: "minor"` → matches on a minor-or-major increase; patch differences never match (exactly today's `qualifies()` semantics for run-kit).

Installed versions:

- **run-kit's own row** compares against the *running* ldflags version (as today) — that is the restart-relevant truth, and brew's on-disk version can legitimately be ahead between upgrade and daemon restart.
- **Every other tool** reads installed versions from one timeout-bound `brew list --versions <formula…>` exec (formula names from the manifest's `formula` field; output format `<formula> <version>` per line, a missing formula simply produces no line). A tool that is not brew-installed has no installed version and **can never match** — deliberate, because the brew-based remediation cannot update it, and it mirrors the existing `IsBrewInstalled` gate philosophy. This also makes the match set inherently safe as `shll update` argv (a *named* not-installed tool is a hard error there; a roster *sweep* skips silently).
- **run-kit's own row additionally requires** `selfpath.IsBrewInstalled` — a go-install/dev rk must not self-match for the same reason.

**When `shll` is absent from PATH** (`exec.LookPath("shll")` fails), matching scopes to the run-kit row only — the chip must never advertise updates the degraded remediation (`rk update`, self only) can't deliver. The lookup is fail-silent per the toolkit rule.

### 3. Verdict, composite key, and SSE payload

`updatecheck.Result` generalizes from `{Current, Latest, Qualifies}` to a matched list plus key:

- `Matched []ToolUpdate` — each `{Tool, Installed, Latest}`, manifest/roster order.
- `Key string` — the composite dismissal key: sorted `tool@latest` pairs comma-joined, e.g. `fab-kit@2.17.0,run-kit@3.9.0`. Empty when nothing matches.
- `OnQualify` fires whenever a check **changes the Key** to a non-empty value (first match, re-match after clearing, any newer latest or newly-matching tool). An unchanged non-empty key never re-fires. This generalizes the existing "still-qualifying but newer latest" re-fire rule.

`api/sse.go` `broadcastUpdateAvailable` and its cached replay slot (`cachedUpdateAvailableJSON`) carry the new payload: `{ tools: [{tool, current, latest}, …], key, current, latest }` — where the legacy top-level `current`/`latest` stay populated from the run-kit row when run-kit is in the match set (else empty). A not-yet-reloaded frontend keys off non-empty `latest`, so it degrades to showing run-kit-only updates and hides otherwise — acceptable transitional behavior.

### 4. Frontend: chip, dismissal, palette

- `useUpdateNotification()` consumes the new payload; `qualifies` = non-empty `tools` (still `&& !dev`).
- **Dismissal**: `runkit-update-dismissed` localStorage stores the composite `key` instead of a single version. Any key change re-shows the chip.
- **UpdateChip**: single-tool match keeps today's `⬆ v{latest}` form when that tool is run-kit; otherwise/multi-tool shows a count form (e.g. `⬆ updates (2)`) with the per-tool `tool v{a} → v{b}` transitions in the title/aria and the overflow-menu version row. Exact presentation is apply's call — the contract is: the chip must communicate *which tools* will be updated, because the button now runs a scoped update.
- `lib/palette-update.ts` action labels follow the same single/multi split; `Dismiss Update Notice` writes the composite key.
- The maintenance palette entries (`run-kit: Update Now` force path, `run-kit: Restart Daemon`) keep their gates; see §5 for what force now means.

### 5. Remediation: POST /api/update spawns a scoped `shll update`

`api/update.go` `handleUpdate`:

- **shll present** (`exec.LookPath("shll")` succeeds): 202 then spawn detached `shll update <matched tools…>` — argv from the checker's snapshot at request time (match set is never empty here because the qualify gate 409s first). `shll update` itself normalizes subset order to roster order and preserves rk's daemon-restart side effect via delegation to `rk update --skip-brew-update`, so the existing detached `Setsid` + `~/.rk/update.log` redirection carries over; the spawn seam generalizes from "spawn self" to "spawn binary at path" (`spawnSelfFn(binPath, logName, args…)` already has the shape — the shll path replaces `selfPath` on this branch).
- **`force: true`**: spawns the full-roster `shll update` sweep (no tool args) — "update everything, I know better". Skips the qualify 409 as today.
- **shll absent**: today's behavior verbatim — brew-409 gate on rk's own install, qualify/force logic unchanged, spawn detached `rk update` (self).
- The brew-409 ("run-kit was not installed via Homebrew") applies only on the shll-absent fallback path — with shll present, rk-not-brew-installed merely means the run-kit row never matches (§2); other tools remain updatable.
- No in-flight lock, 202-before-spawn ordering, and second-click idempotence (brew resolves "already up to date") all unchanged.

### 6. Sequencing with the shll.ai sibling change

Safe to merge in either order: until `versions.json` exists, the manifest fetch 404s → stale-while-revalidate retains the empty verdict → chip stays hidden, exactly like a no-update steady state. The shll.ai change shipping first simply activates this one.

## Affected Memory

- `run-kit/architecture`: (modify) — internal/updatecheck source + verdict shape, SSE `update-available` payload, POST /api/update scoped-shll remediation + fallback
- `run-kit/ui-patterns`: (modify) — UpdateChip single/multi form, composite dismissal key, palette action label changes

## Impact

- **Backend**: `internal/updatecheck/updatecheck.go` + `_test.go` (fetch/parse/match/key), `api/update.go` + `_test.go` (shll lookup, scoped argv, force sweep, fallback), `api/sse.go` (broadcast signature + cached slot payload), `cmd/rk/serve.go` (wiring — likely signature-only), possibly a small `internal/` seam for `brew list --versions` (timeout-bound exec per Constitution I).
- **Frontend**: `hooks/use-update-click.ts` (or wherever `useUpdateNotification` lives — `contexts/session-context.tsx` holds the SSE slot), `components/update-chip` + test, `lib/palette-update.ts`, `components/top-bar-overflow-menu.tsx` version row.
- **Cross-repo**: manifest schema contract with the shll.ai sibling change; `shll update` subset semantics (already shipped in shll v0.1.5 — no shll change needed for remediation).
- **Tests**: existing updatecheck/update handler tests rewritten around the manifest fixture; chip test gains multi-tool + composite-dismissal cases.

## Open Questions

- None blocking. (Chip presentation detail for the multi-tool form is decided at apply — the behavioral contract is stated in §4.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Remediation = scoped `shll update <matched…>`; fallback `rk update` when shll absent | Discussed — user decided both, verbatim | S:95 R:80 A:90 D:95 |
| 2 | Certain | Detection source = `versions.json` manifest on shll.ai, produced by the existing help-dump puller | Discussed — user proposed the page + puller piggyback | S:95 R:85 A:90 D:90 |
| 3 | Certain | Composite dismissal key = sorted `tool@latest` pairs | Discussed — user agreed ("1, 2 - agreed") | S:90 R:90 A:90 D:90 |
| 4 | Certain | Cadence unchanged: 30s initial check + 6h ticker (restart-time check already exists) | Discussed — user agreed; matches existing constants | S:90 R:95 A:95 D:95 |
| 5 | Certain | Per-tool notify policy rides in the manifest (`never`/`patch`/`minor`); values owned by shll.ai repo, rk applies verbatim | Discussed — reversibility requirement drove it; user built on the proposal | S:85 R:90 A:85 D:85 |
| 6 | Confident | `force: true` = full-roster `shll update` sweep (no args) | Proposed in discussion, not explicitly confirmed; trivially adjustable | S:60 R:85 A:80 D:75 |
| 7 | Confident | Installed versions: run-kit row = running ldflags version (+ IsBrewInstalled gate); other tools = one `brew list --versions` exec joined on manifest `formula`; not-brew-installed never matches | Not discussed; brew-grounded matching mirrors existing brew-409 philosophy and keeps argv safe for `shll update` | S:50 R:85 A:80 D:70 |
| 8 | Confident | shll absent from PATH → matching scopes to run-kit row only | Follows the agreed principle: never advertise what remediation can't deliver | S:55 R:85 A:85 D:80 |
| 9 | Confident | SSE payload keeps legacy `current`/`latest` populated from the run-kit row for transitional frontend compat | Proposed in discussion ("worth keeping"), low cost, removable later | S:55 R:90 A:85 D:75 |
| 10 | Certain | Dev-build whole-checker suppression unchanged (dev daemons never poll the manifest) | Preserves today's behavior + keeps e2e off the network | S:60 R:90 A:90 D:85 |
| 11 | Confident | No GitHub-releases fallback fetch; stale-while-revalidate is the only failure handling | Simplicity; full revert of the fetch constant is the documented escape hatch | S:60 R:85 A:85 D:80 |
| 12 | Confident | Chip: run-kit-only match keeps `⬆ v{latest}`; otherwise a count form with per-tool detail in title/menu row | Presentational, apply decides within the stated contract | S:40 R:95 A:75 D:55 |

12 assumptions (6 certain, 6 confident, 0 tentative, 0 unresolved).
