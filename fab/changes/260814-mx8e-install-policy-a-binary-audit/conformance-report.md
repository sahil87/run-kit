# Conformance Report: install-composition Policy A (binary half)

**Change**: 260814-mx8e-install-policy-a-binary-audit
**Audited**: 2026-08-15
**Standard**: `shll standards install-composition`, enumerated at audit time @ **shll v0.1.18** (`shll version`)
**Binary under audit**: `bin/rk` built at HEAD (`go build -o ../../bin/rk ./cmd/rk` from `app/backend/`; reports `run-kit version dev`) — per the audit-against-HEAD-build rule. The installed brew `rk` (v3.16.19) was not used for any behavioral evidence.

## Verdict

**Policy A (binary half): PASS**, with **one deferred should-fix finding** on hint wording (backlog `[gq7f]`) and two recorded nuances. No crash-capable sibling path exists; the standard's named failure mode ("one tool's absence becomes another tool's crash") occurs nowhere.

| Checklist item (standard § Verifying conformance) | Verdict |
|---|---|
| Tap formula declares no sibling `depends_on` | **PASS** |
| Every runtime sibling invocation behind a probe | **PASS** (substance — see Nuance 1) |
| Missing-sibling paths skip with an actionable hint, never crash | **PASS with one finding** — never-crash holds everywhere; one hint below the standard's actionable shape (→ `[gq7f]`) |

## 1. Formula check — PASS

`brew info --json=v2 run-kit` (tap `sahil87/tap`, v3.16.19, matching the local tap clone's `Formula/run-kit.rb`): `dependencies`, `build_dependencies`, `recommended_dependencies`, `optional_dependencies`, and `uses_from_macos` are all empty. The formula's only `depends_on` text is a comment explaining two **deliberate non-declarations**: code-server (rk manages its own digest-verified install under `~/.rk/code-server-bin`; Homebrew's formula is deprecated/pinned) and tmux (host-provided) — neither is a toolkit sibling. No edge to any of the seven roster formulas (shll, wt, idea, hop, tu, fab-kit, run-kit).

## 2. Sibling-invocation inventory

Reproducible sweep commands (run from `app/backend/`; all shipped Go code, `_test.go` excluded):

```sh
grep -rnE 'exec\.Command(Context)?\(' --include="*.go" .            # every exec target, eyeballed
grep -rnE 'LookPath\("(wt|fab|shll|idea|hop|tu)"\)' --include="*.go" .
grep -rnwE 'wt|fab|shll|idea|hop|tu' ../../scripts/*.sh              # shell: zero hits
grep -rnE 'command -v' ../../docs/site/skill.md ../../docs/site/skill/  # skill pages: rk self-gating only
```

The exhaustive exec-target sweep confirms the only non-sibling subprocess targets are tmux, git, gh, brew, ssh, curl-less in-process HTTP, and platform utilities (ps, sysctl, vm_stat, lsof, ss). Siblings invoked: **`wt`, `fab`, `shll`**. `idea`/`hop`/`tu` are never invoked. `scripts/*.sh` and the shipped skill pages invoke no sibling (skill pages carry only the standard `command -v rk` self-gate for consumers).

### Call-site classification

| # | Site | Sibling | Class | Evidence |
|---|------|---------|-------|----------|
| 1 | `cmd/rk/riff.go:288` (`checkPreconditions`) | wt | **Probed** (`exec.LookPath`) | CLI `rk riff` fast-fails pre-spawn; live-verified below |
| 2 | `internal/riff/riff.go:346` (`ResolveLauncher`) | fab | Unprobed, **graceful by contract** | Documented best-effort: ANY failure incl. fab absent → silent fallback to `DefaultLauncher`; `Output()` error swallowed by `parseFabAgentOutput` |
| 3 | `internal/riff/riff.go:411` (`runWtCreate`) | wt | Unprobed, **graceful** | Exec error → `SubprocessErr("run-kit riff: wt create failed: %v…")` returned; CLI path additionally guarded by #1; web `POST /api/riff` path reaches it unguarded but the error surfaces as an HTTP error, no crash |
| 4 | `internal/riff/riff.go:751` (`runWtDelete`, rollback) | wt | Unprobed, **graceful** | Error returned; caller logs and continues (best-effort rollback) |
| 5 | `internal/wt/wt.go:52` (`ListApps`) | wt | Unprobed, **graceful** | Error returned as-is; `api/open.go:40` degrades fail-silent to `[]` (200) with a debug log — "an absent or pre---list wt is an expected deployment state, not a server error" |
| 6 | `internal/wt/wt.go:90` (`Open`) | wt | Unprobed, **graceful + gated** | `api/open.go:84` validates the app id against the live registry first — wt absent ⇒ empty registry ⇒ 400 "unknown app" *before* exec; the exec error path is handled regardless (502) |
| 7 | `internal/sessions/sessions.go:130` (`fetchPaneMap`) | fab | Unprobed, **graceful** | Error deliberately discarded at the join (`sessions.go:739` `paneMap, _ :=`) — fab absent ⇒ pane-map enrichment silently skipped, sessions still serve |
| 8 | `internal/updatecheck/updatecheck.go:497` (`defaultCheck`) | shll | **Probed** (`exec.LookPath`) | Absent → `"shll not found on PATH"` error → check pass skips (banner absent); manual check surfaces `update check unavailable — shll not found on PATH` |
| 9 | `api/update.go:41,159` (`lookShllFn`) | shll | **Probed** (`exec.LookPath`) | Absent → documented fail-silent fallback to the run-kit-self update path (behavior continues, no hint needed) |

Class (c) — unprobed and crash-capable — is **empty**.

## 3. Hint audit (missing-sibling / degrade messages)

Live probes against `bin/rk`, isolated via scratch `PATH`/`HOME` (no operator-environment mutation):

**Probe 1 — wt absent** (`TMUX=/tmp/fake,1,0 PATH=/usr/bin:/bin ./bin/rk riff echo hi`):

```
run-kit riff: wt not found on PATH (required companion tool — see https://github.com/sahil87/wt)
exit=1
```

Graceful precondition fail (operational exit 1, correct per P4). **Finding**: the hint names the tool and a repo URL but carries **no install command** — the standard's example shape is `wt is not installed. Install it: brew install sahil87/tap/wt`. The URL also lands on a README that (correctly, per Policy B) carries no install instructions, adding a hop. → deferred as backlog `[gq7f]`.

**Probe 2 — non-brew install** (`HOME=<scratch> PATH=/usr/bin:/bin ./bin/rk update`, the backlog's illustrative case `cmd/rk/upgrade.go:240-242`):

```
run-kit vdev was not installed via Homebrew.
Update manually (git pull && just build), or reinstall with:
  brew install sahil87/tap/run-kit
exit=0
```

**Conforms** — the mandated actionable per-formula hint pattern in binary output (Policy A mandates it there; Policy B prohibits it only in docs). The HTTP twin (`api/update.go:300`, 409 body ``"…update manually with `rk update` in a shell, or `brew install sahil87/tap/run-kit`"``) carries the same conformant shape.

Remaining degrade messages, by code reading: #3's `run-kit riff: wt create failed: exec: "wt": executable file not found in $PATH` (web-only reach; raw but graceful); #5/#6's silent `[]` / 400 (a skip — the web dashboard simply lacks the Open feature); #2/#7's silent fallbacks (feature-preserving, hint not applicable); #8's `shll not found on PATH` (names the tool, no install command — folded into `[gq7f]`).

## 4. Nuances (recorded, not findings)

1. **Probe mechanism at internal sites.** Six exec sites (#2–#7) carry no `exec.LookPath`, relying instead on the handled `exec.CommandContext` error. In Go the handled exec error is an equivalent-or-stronger mechanism (LookPath is TOCTOU-racy; the exec error is authoritative), and none of these sites *assume* presence — the standard's substance ("presence is never a package guarantee", №8's skip-don't-crash) holds at every one. User-facing entry seams (CLI riff, both shll consumers) carry literal probes.
2. **No sibling checks in `rk doctor`.** Doctor checks tmux, the guard shim, and code-server — not wt/fab/shll. Nothing in Policy A requires doctor coverage; noted as the natural home if the web surfaces' silent wt-absent skip ever needs discoverability.

## 5. Appendix — standard text as enumerated at audit time

Verbatim from `shll standards install-composition` @ shll v0.1.18 (the Policy A clauses the audit measures against; Policy B's docs-half prose omitted — out of this audit's scope):

> ## No inter-tool formula dependencies (Policy A)
>
> - **Toolkit formulas MUST NOT declare `depends_on` on sibling toolkit formulas.**
> - `shll install` is the composition point: it installs the full roster and accepts a subset. A formula edge duplicates that roster knowledge in the tap, forces lockstep installs (installing one tool drags in others the user didn't ask for), and complicates uninstalls (brew refuses to remove a dependency of an installed formula).
>
> **Precedent.** `fab-kit` and `hop` previously declared `depends_on` on `wt`/`idea`; those edges are removed, and the `all` meta-formula is retired in favor of `shll install`.
>
> ## Probe siblings at runtime, degrade gracefully (Policy A, binary half)
>
> A tool MAY invoke a sibling tool at runtime — composition is the toolkit's idiom (№7) — but with no formula edge, presence is never a package guarantee:
>
> - **MUST probe before invoking**: `command -v <tool>` in shell and skill code, `exec.LookPath` in Go. Never assume a sibling is installed.
> - **MUST degrade gracefully when the sibling is missing**: skip the sibling-dependent behavior and emit an actionable install hint — never crash. Example message, verbatim:
>
> ```
> wt is not installed. Install it: brew install sahil87/tap/wt
> ```
>
> **Failure mode.** An unprobed sibling call turns one tool's absence into another tool's crash — the whole toolkit becomes only as reliable as its least-installed member (№8's exact failure mode, at the inter-tool seam).
>
> ## Verifying conformance
>
> Before shipping a change that touches your tap formula, a sibling invocation, or a README install section:
>
> - The tool's tap formula declares no `depends_on` on a sibling toolkit formula.
> - Every runtime sibling invocation sits behind a probe (`command -v` in shell/skill code, `exec.LookPath` in Go).
> - Every missing-sibling path skips with an actionable install hint (`<tool> is not installed. Install it: brew install sahil87/tap/<tool>`), never a crash.
> - The README's install section (and, for the tap, the tap README) links to https://shll.ai instead of carrying per-formula `brew install` lines.

## 6. Deferral

- **`[gq7f]`** (new, fab/backlog.md): align the two weak hint strings to the standard's actionable shape — `cmd/rk/riff.go:290` (`wt is not installed. Install it: brew install sahil87/tap/wt`) and `internal/updatecheck/updatecheck.go:498` (name the install command in the shll-absent message). Should-fix; no crash risk; conformance otherwise holds.
