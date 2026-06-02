# Intake: Build-time help-dump — emit rk CLI help tree as help/run-kit.json

**Change**: 260602-a36m-help-dump-shll-ai
**Created**: 2026-06-02
**Status**: Draft

## Origin

This change originates from **backlog item a36m** (2026-06-02). It is rk's slice of a
7-tool rollout. The shll.ai landing site renders an expandable "Command reference" on each
tool's page from a per-tool JSON file; rk currently emits nothing, so the run-kit tool page
has no command reference. The site-side consumer (Astro loader + reference UI) lives in the
shll.ai repo and is tracked separately — **out of scope here**.

Interaction mode: one-shot, fully synthesized intake. The three scoping decisions below were
explicitly confirmed by the user and are settled (not open for re-litigation):

1. A **hidden** `rk help-dump` Cobra subcommand is the producer (programmatic command-tree
   walk, not regex parsing of `-h` text).
2. The CI step runs in `.github/workflows/release.yml` after the existing cross-compile step,
   against the versioned binary, and opens a **PR** (not a direct push) into `sahil87/shll.ai`
   using the existing `SHLLAI_TOKEN` secret with auto-merge enabled.
3. The output JSON contract is **frozen** — it mirrors the reference sample at `sahil87/shll.ai`
   path `help/wt.json`. Do not deviate from the shape.

## Why

**Problem.** The shll.ai landing site builds a per-tool "Command reference" panel from a JSON
file committed at `help/<tool-slug>.json` in the shll.ai repo. Six other tools in the rollout
emit this artifact; rk does not, so the run-kit tool page shows no command reference.

**Consequence if not fixed.** The run-kit page stays incomplete relative to its sibling tools.
Maintaining a hand-written command reference would drift from the real Cobra command tree every
time a subcommand, flag, or help string changes — exactly the staleness this build-time dump
exists to eliminate.

**Why this approach.**
- *Programmatic tree walk over regex.* Walking `rootCmd.Commands()` recursively reuses the
  single source of truth (the real Cobra tree and the ldflags-set `version`). Regex-parsing
  `-h` output is brittle, depends on terminal width / Cobra's template, and cannot reliably
  recover structure (parent/child, hidden flags). The walker is also pure in-process
  introspection — no subprocess, satisfying the constitution's Security First principle with
  zero shell-string construction.
- *Hidden subcommand over a separate tool / Makefile target.* `rk help-dump` ships inside the
  binary, so the dump always reflects the exact build it ran against (version + tree are
  guaranteed consistent). `cmd.Hidden = true` keeps it out of the user-facing help tree (and it
  self-excludes from its own dump, since the walker drops hidden nodes).
- *Run at release, against the versioned binary.* `release.yml` already cross-compiles with
  `-ldflags "-X main.version=<v>"`, so running the dump there yields a real, non-`dev` version.
  Triggers are `v*` tags / `workflow_dispatch`.
- *PR, not direct push.* Opening a PR into shll.ai with auto-merge avoids the multi-repo
  push race (concurrent releases pushing to shll.ai `main` simultaneously) and gives shll.ai's
  own branch protection / CI a chance to run.

## What Changes

### 1. Producer — hidden `rk help-dump` subcommand (`app/backend/cmd/rk/`)

Add a new file `app/backend/cmd/rk/help_dump.go` (package `main`) defining a hidden Cobra
subcommand, registered in `root.go`'s `init()` alongside the other `rootCmd.AddCommand(...)`
calls.

```go
var helpDumpCmd = &cobra.Command{
    Use:    "help-dump [output-path]",
    Short:  "Emit the CLI help tree as JSON (build tooling)",
    Hidden: true,
    Args:   cobra.MaximumNArgs(1),
    RunE:   runHelpDump,
}
```

Behavior:
- **Output target.** Accepts an optional output-path argument. If a path is given, write the
  JSON there; otherwise write to stdout. (`cobra.MaximumNArgs(1)`.)
- **Tree walk.** Walk `rootCmd.Commands()` **recursively** to full depth. rk has genuine nested
  subcommands (e.g. `rk riff ...`, the `daemon` family), so recursion must capture children of
  children, not just one level.
- **Filtering.** Exclude:
  - Cobra's auto-generated `completion` subcommand (by name).
  - Cobra's auto-generated `help` subcommand (by name).
  - Any node with `cmd.Hidden == true` (this also self-excludes `help-dump`, and excludes any
    serve/internal-ish hidden commands rk carries).
  - Filtering applies at every level of the recursion (a hidden parent's subtree is dropped
    entirely; hidden children of a visible parent are individually dropped).
- **Per-node capture** (struct → JSON, field names per the frozen contract below):
  - `name` ← `cmd.Name()`
  - `path` ← `cmd.CommandPath()` (full invocation, e.g. `"rk riff"`)
  - `short` ← `cmd.Short`
  - `usage` ← `cmd.UseLine()`
  - `text` ← `cmd.UsageString()` — **raw, byte-for-byte, newlines preserved** (no trimming, no
    reflow)
  - `commands` ← recurse into visible children; **empty array (`[]`) for a leaf**, never `null`
- **Root node.** The `root` field is the Node built from `rootCmd` itself (name `"rk"`, path
  `"rk"`, etc.), with its visible children under `commands`.
- **Version.** Read from the built binary via the existing `version` package var / `rootCmd.Version`
  (`displayVersion()` in `root.go`). **Do NOT hardcode.** Under `-ldflags -X main.version=…` this
  is the real release version; in a plain `go test` / `go build` it is the `"dev"` sentinel.
- **`captured_at`.** ISO-8601 UTC timestamp at dump time. **Non-deterministic by design** —
  the walker SHOULD take an injected clock (or the timestamp generation SHOULD be separable) so
  tests can avoid asserting an exact value; tests MUST NOT assert an exact `captured_at`.

Security note (constitution Principle I): the walker performs **pure in-process Cobra
introspection** — no `exec`, no subprocess, no shell-string construction. Writing the output
file uses standard library file I/O with an explicit path argument.

### 2. Frozen JSON contract

Copy the shape from the reference sample at `sahil87/shll.ai` path `help/wt.json` — the shape is
**FROZEN**. Do not add, rename, or reorder fields beyond what is specified.

Top-level object:

```json
{
  "tool": "rk",
  "version": "v1.5.3",
  "captured_at": "2026-06-02T12:34:56Z",
  "schema_version": 1,
  "root": { /* Node */ }
}
```

- `tool` (string) = `"rk"` — the **invoked binary name**, even though the output file is named
  `run-kit.json` to match the tool's repo/site slug.
- `version` (string) — read from the built binary (see above); not hardcoded.
- `captured_at` (string) — ISO-8601 UTC timestamp.
- `schema_version` (integer) = `1`.
- `root` (Node).

Node (recursive):

```json
{
  "name": "riff",
  "path": "rk riff",
  "short": "…one-line description…",
  "usage": "rk riff [flags]",
  "text": "…raw UsageString, newlines preserved…",
  "commands": [ /* child Node[]; [] = leaf */ ]
}
```

The output file is named `help/run-kit.json` (matches the tool's repo/site slug) — even though
the binary is `rk` and the `tool` field is `"rk"`.

### 3. CI placement (`.github/workflows/release.yml`)

Add a step **after** the existing `Cross-compile` step (which builds the versioned binaries into
`dist/rk-<os>-<arch>/rk` with `-X main.version=<version>`). The new step:

1. Runs the dump against the **versioned** linux/amd64 binary (the runner is `ubuntu-latest`),
   e.g. `dist/rk-linux-amd64/rk help-dump help/run-kit.json` — so the emitted `version` is the
   real release version, not `dev`.
2. Validates that `help/run-kit.json` **parses as JSON** (fail the job if it does not).
3. Opens a **PR** into `sahil87/shll.ai` (committing `help/run-kit.json`) using the existing repo
   secret `SHLLAI_TOKEN` (scopes: contents + pull-request write), with **auto-merge enabled**.
   Use the `gh` CLI / `git` with **explicit arguments** (no shell-string interpolation of
   untrusted data) — clone shll.ai with `https://x-access-token:${SHLLAI_TOKEN}@…` (mirroring the
   existing Homebrew-tap step's pattern), commit on a fresh branch, push, `gh pr create`, then
   `gh pr merge --auto`.
4. Runs only on tagged releases (`release.yml` triggers on `v*` tags / `workflow_dispatch`), so
   the version is always real.

This is intentionally a PR (not a direct push to `main`) to avoid the multi-repo push race across
the 7-tool rollout.

### 4. Tests (`app/backend/cmd/rk/help_dump_test.go`, package `main`)

Per the repo's Go convention (`code-quality.md`: tests live alongside code in the same package),
add unit tests for the walker. Assert:
- **Shape** — top-level fields (`tool`="rk", `schema_version`=1, presence of `version`, `root`)
  and Node fields (`name`/`path`/`short`/`usage`/`text`/`commands`).
- **Filtering** — `completion`, `help`, and any `Hidden` node are excluded (including
  `help-dump` self-excluding); a hidden subtree is dropped entirely.
- **Recursion** — a known nested command (e.g. `rk riff`'s subtree, or `daemon`'s) is captured to
  full depth; leaves have `commands == []` (not `null`).
- **Version source** — `version` is read from the binary's `version` var, not a hardcoded
  literal (e.g. assert it equals `displayVersion()` / the package var, so an ldflags override
  would flow through).
- **`captured_at`** — do NOT assert an exact timestamp; assert format/parseability only (or
  inject a fixed clock).

## Affected Memory

- `run-kit/architecture`: (modify) The architecture spec/memory covers build & deploy. A new
  reference for the build-time help-dump producer + release.yml CI step may be warranted. Defer
  the precise wording to hydrate.

## Impact

- **Code (new):** `app/backend/cmd/rk/help_dump.go`, `app/backend/cmd/rk/help_dump_test.go`.
- **Code (modify):** `app/backend/cmd/rk/root.go` (`init()` — register `helpDumpCmd`).
- **CI (modify):** `.github/workflows/release.yml` (new step after Cross-compile; consumes new
  secret usage `SHLLAI_TOKEN`).
- **Cross-repo:** opens PRs into `sahil87/shll.ai` (writes `help/run-kit.json` there). The
  shll.ai-side Astro loader / reference UI is OUT OF SCOPE (separate repo, separately tracked).
- **Dependencies:** none new — uses existing `spf13/cobra` and Go stdlib (`encoding/json`,
  `time`, `os`). CI uses already-available `gh` / `git` on `ubuntu-latest`.
- **Secrets:** relies on the existing `SHLLAI_TOKEN` repo secret (assumed already provisioned
  with contents + pull-request write — see Open Questions).
- **Constitution:** Security First — pure in-process introspection, no shell-string subprocess.
  Thin Justfile — no new justfile logic required (CI-only step).

## Open Questions

- Does the `SHLLAI_TOKEN` repo secret already exist with the required scopes (contents +
  pull-request write) on the run-kit repo? The intake assumes yes (stated as the "existing repo
  secret"); if absent, the CI step would fail at PR-open time. Verifiable at implementation /
  CI-run time, not blocking.
- Exact path/branch conventions on the shll.ai side (target branch, PR base) — assumed `main`
  with a fresh head branch; confirmable against the shll.ai repo but not blocking the producer.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Producer is a hidden `rk help-dump` Cobra subcommand registered in `root.go init()`, walking `rootCmd.Commands()` programmatically | User-confirmed scoping decision; matches existing `cmd/rk/` structure and constitution's no-shell-string rule | S:98 R:80 A:95 D:95 |
| 2 | Certain | Filter out `completion`, `help`, and any `Hidden` node (incl. `help-dump` self-excluding) at every recursion level | Explicitly specified and confirmed; deterministic rule | S:98 R:85 A:95 D:98 |
| 3 | Certain | Per-node capture: name/path/short/usage/text(raw UsageString)/commands(recursive, `[]`=leaf); root from `rootCmd` | Frozen contract, field-by-field source mapping given verbatim | S:98 R:75 A:95 D:95 |
| 4 | Certain | Top-level JSON contract `{tool:"rk", version, captured_at, schema_version:1, root}` is frozen, mirroring `help/wt.json` | Contract declared frozen and confirmed; copied from reference sample | S:98 R:70 A:95 D:98 |
| 5 | Certain | Output file named `help/run-kit.json` (repo/site slug) though `tool`="rk" (binary name) | Stated explicitly and confirmed | S:98 R:85 A:98 D:98 |
| 6 | Certain | `version` read from the built binary (`version` var / `displayVersion()` / ldflags), never hardcoded | Confirmed; `root.go` already exposes `version` + `displayVersion()` | S:98 R:85 A:98 D:95 |
| 7 | Certain | CI step in `release.yml` runs after Cross-compile, against the versioned binary, validates JSON, opens auto-merge PR to `sahil87/shll.ai` via `SHLLAI_TOKEN` (not direct push) | User-confirmed placement + PR-not-push decision; release.yml triggers on `v*`/dispatch | S:95 R:65 A:90 D:92 |
| 8 | Certain | Go unit tests in `help_dump_test.go` (package main) asserting shape, filtering, recursion, version-from-binary; not asserting exact `captured_at` | Confirmed; matches repo Go test convention (colocated `*_test.go`) | S:95 R:88 A:95 D:92 |
| 9 | Certain | `captured_at` non-determinism handled via injectable clock (or tests ignore it) rather than freezing time globally | Explicitly called out by the confirmed input; clock injection is the deterministic, idiomatic Go answer with one obvious interpretation | S:90 R:85 A:90 D:85 |
| 10 | Certain | Dump runs the linux/amd64 versioned artifact (`dist/rk-linux-amd64/rk`) on the `ubuntu-latest` runner | Runner is `ubuntu-latest` (already in release.yml); that artifact is already built by the existing Cross-compile step — config-determined, single obvious choice | S:88 R:85 A:92 D:88 |
| 11 | Confident | shll.ai PR targets `main` with a fresh head branch; commit message/branch mirror the Homebrew-tap step's token-clone pattern | Existing tap step is the in-repo precedent; reversible CI detail, front-runner clear | S:75 R:78 A:82 D:78 |
| 12 | Confident | Affected memory domain is run-kit/architecture (build & deploy); precise wording deferred to hydrate | architecture spec/memory owns build & deploy per docs/specs/index.md; deferred-to-hydrate is the standard pattern | S:82 R:90 A:85 D:82 |
| 13 | Certain | shll.ai site-side Astro loader / reference UI is out of scope (separate repo, separately tracked) | Explicitly excluded and confirmed by the user as a settled scope boundary | S:96 R:85 A:92 D:95 |
| 14 | Confident | `SHLLAI_TOKEN` repo secret already exists with contents + pull-request write scopes | Stated by the confirmed input as the "existing repo secret" — one obvious interpretation (it exists as stated); surfaced as a verifiable Open Question, recoverable at CI-run time | S:85 R:70 A:72 D:80 |

14 assumptions (10 certain, 4 confident, 0 tentative, 0 unresolved).
