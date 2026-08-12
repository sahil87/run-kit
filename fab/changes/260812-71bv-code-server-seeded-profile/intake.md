# Intake: Code-Server Seeded Profile

**Change**: 260812-71bv-code-server-seeded-profile
**Created**: 2026-08-12

## Origin

One-shot `/fab-new 71bv` from the backlog:

> [71bv] 2026-08-12: code-server lens: rk-owned --user-data-dir seeded with settings.json (only if absent) + shared --extensions-dir at the default location. Why: chat.disableAIFeatures (Build with Agent panel) and workbench.startupEditor are settings-only — no CLI flags exist (verified code-server 4.112.0/Code 1.112.0) — so per-machine manual settings drift; an rk-owned profile makes the /code lens baseline reproducible on new boxes while keeping the user's extensions visible. Deferred from 260812: manual one-time setting suffices until it bites on a second machine.

This is the planned follow-up to `260812-6rxw-code-server-launch-flags` (PR #564), whose design decision explicitly rejected-and-deferred this mechanism: *"Rejected: an rk-owned `--user-data-dir` with a seeded settings.json (needed only for settings-gated behavior like the 'Build with Agent' chat panel, which has no CLI flag — deferred to backlog idea 71bv); mutating the user's default-profile settings.json from rk (clobbers the personal code-server profile)."*

One clarifying question was asked during intake: the user chose **`~/.rk/code-server`** as the rk-owned user-data-dir location (over `$XDG_DATA_HOME/rk/code-server` and `$XDG_STATE_HOME/rk/code-server`).

## Why

1. **The pain point**: two settings that curate the embedded `/code` lens — `chat.disableAIFeatures` (hides the "Build with Agent" chat panel) and `workbench.startupEditor` (suppresses the welcome tab) — are settings-only. No CLI flags exist for them (verified against code-server 4.112.0 / Code 1.112.0), so PR #564's flags-only curation cannot reach them.
2. **The consequence of not fixing**: the baseline requires manually editing code-server's personal-profile `User/settings.json` on every machine. That drifts per-box (a new machine gets the un-curated lens until someone remembers), and rk writing into the user's *personal* code-server profile was already rejected in #564 as clobbering.
3. **Why this approach**: an rk-owned `--user-data-dir` gives rk a profile it legitimately owns — the seed applies rk's baseline exactly once (never overwriting user edits), making the lens reproducible on new boxes; pinning `--extensions-dir` back to code-server's default location keeps the user's installed extensions visible, since code-server defaults the extensions dir to `<user-data-dir>/extensions` and moving the data dir alone would hide them.

## What Changes

All changes live in `ensureCodeServer` (`app/backend/internal/daemon/codeserver.go`) and its test file. No frontend, API, or route changes.

### Launch argv: two new flags

The spawn argv (after the existing five curation flags) gains:

- `--user-data-dir {home}/.rk/code-server` — the rk-owned profile. The user chose `~/.rk/code-server` (the `~/.rk/tmux.conf` config-namespace precedent; the seeded settings.json is the user-editable artifact here).
- `--extensions-dir {XDG_DATA_HOME or {home}/.local/share}/code-server/extensions` — pinned to **code-server's default** extensions location. Required because code-server computes its default extensions dir as `<user-data-dir>/extensions`; without the pin, overriding the user-data-dir would silently hide every extension the user already installed.

Both paths MUST be absolute, computed in Go (`os.UserHomeDir()`, `os.Getenv("XDG_DATA_HOME")` with the `~/.local/share` fallback — the `internal/snapshot.DefaultDir` style). Tilde expansion is unavailable: the argv is exec'd by tmux `new-session` via `env`, not a shell (Constitution I — argv slices, no shell strings).

Edge case: if `os.UserHomeDir()` fails, warn and spawn with the **pre-change argv** (no profile flags, no seed) — an editor must never block the dashboard, and a relative or empty path flag would be worse than the status quo.

### Settings seed: write-once, before spawn

Immediately before the spawn (on the spawn branch only — after all idempotency-ladder rungs pass), seed the profile:

1. If `{home}/.rk/code-server/User/settings.json` **does not exist**: `MkdirAll` the `User/` directory and write:

   ```json
   {
       "chat.disableAIFeatures": true,
       "workbench.startupEditor": "none"
   }
   ```

2. If the file **exists** (any content): touch nothing — user edits persist byte-for-byte. The seed is a baseline, not enforcement.

The seed is best-effort: a mkdir/write failure logs `slog.Warn` and continues to the spawn **with the profile flags still applied** — code-server creates its own user-data-dir, so the only degradation is an unseeded (default-behaving) profile, matching the file's every-failure-degrades posture.

`User/settings.json` (not the dir root) is where code-server reads user-scope settings from a `--user-data-dir`.

### Unchanged behavior (explicit)

- The idempotency ladder is untouched: existing `rk-code-server` session ⇒ silent skip (keeps its old argv until next fresh spawn); port already serving ⇒ the externally managed instance is respected and gets **no flags and no seed**; binary absent ⇒ warn-and-continue.
- The user's personal code-server profile (`~/.local/share/code-server`) is never read or written.
- Constitution II posture: the seed is a one-time **write-only** artifact from rk's perspective — rk never reads it at request time; the user-data-dir is code-server-owned state that rk merely names. No new derive path, no state store.

### Tests

Extend `codeserver_test.go` via the existing seam style:

- Exact-argv assertion updated for the two new flags (the `codeServerSpawn` capture seam), including the XDG_DATA_HOME-set and fallback variants.
- Seed behavior: absent file ⇒ written with the exact JSON; existing file ⇒ preserved byte-for-byte; write failure ⇒ spawn still invoked with flags. Paths need a test seam (package `var` for the home/profile-dir resolution, matching the file's `codeServerLookPath` seam style) so tests run against temp dirs.

## Affected Memory

- `run-kit/architecture`: (modify) § Daemon Lifecycle's `rk-code-server` paragraph gains the profile flags + seed semantics; the "curated through launch flags only" design decision gets its follow-up (the deferred 71bv mechanism now exists — the flags-only claim is superseded).

## Impact

- `app/backend/internal/daemon/codeserver.go` — argv extension + seed helper (+ path resolution).
- `app/backend/internal/daemon/codeserver_test.go` — argv + seed coverage.
- No frontend, no API surface, no routes, no doctor changes (the doctor code-server row keeps reporting binary/port/reachability only).
- Runtime effect lands on the next fresh `rk-code-server` spawn (existing sessions keep their argv — same rollout semantics as PR #564).

## Open Questions

- None — the one genuine fork (profile-dir location) was asked and resolved during intake.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | User-data-dir is `~/.rk/code-server` | Asked — user chose it over XDG data/state homes | S:95 R:70 A:95 D:95 |
| 2 | Certain | Seed writes settings.json only if absent; existing content preserved byte-for-byte | Explicit in the backlog ("only if absent"); the #564 DD rejected clobbering user settings | S:90 R:85 A:90 D:95 |
| 3 | Certain | `--extensions-dir` pinned to code-server's default location (`${XDG_DATA_HOME:-~/.local/share}/code-server/extensions`) | Explicit in the backlog ("shared --extensions-dir at the default location"); keeps installed extensions visible | S:85 R:80 A:85 D:85 |
| 4 | Certain | Settings file path is `<user-data-dir>/User/settings.json` | code-server reads user-scope settings from the `User/` subdir, not the dir root — verifiable tool convention | S:60 R:85 A:90 D:90 |
| 5 | Certain | Flags + seed apply only to rk-spawned instances; idempotency ladder unchanged | Explicit in backlog and the #564 DD ("flags apply only to instances rk spawns") | S:85 R:90 A:95 D:90 |
| 6 | Confident | Seeded values: `"chat.disableAIFeatures": true`, `"workbench.startupEditor": "none"` | Backlog names both keys; `true` is the stated point of the first; `"none"` is the clean-embed choice for the second and trivially user-editable after seeding | S:65 R:90 A:75 D:75 |
| 7 | Confident | Seed is best-effort: mkdir/write failure warns and continues with flags still applied | Matches `ensureCodeServer`'s every-failure-degrades posture; code-server creates its own dir | S:55 R:85 A:85 D:75 |
| 8 | Confident | Constitution II is satisfied: the seed is a write-only artifact, never read by rk at request time | Same class as the snapshot/prstatus write-only carve-outs, and the dir itself is code-server's state, not rk's | S:60 R:75 A:80 D:75 |

8 assumptions (5 certain, 3 confident, 0 tentative, 0 unresolved).
