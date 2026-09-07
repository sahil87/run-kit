# Intake: Show Code Server Even When Not In A Git Root

**Change**: 260907-a482-code-server-outside-git-root
**Created**: 2026-09-07

## Origin

> Operator dispatch, user's exact words: **"Show the code server even when not in a git root."**

One-shot bug report, investigated before intake creation (no prior `/fab-discuss` — this is the
first artifact for this change). Root cause was traced by direct code search rather than assumed:

- The frontend availability gate `hasCode()` (`app/frontend/src/lib/window-view.ts:87-89`) returns
  `((win?.codeRoot || win?.gitRoot) ?? "").length > 0` — the code-server lens/rail-button/switcher
  segment is offered **only** when either the latched `codeRoot` or the live-derived `gitRoot` is
  non-empty.
- `gitRoot` is populated backend-side by `deriveGitRoot` (`app/backend/internal/sessions/sessions.go:664-683`),
  which walks the active pane's cwd via `config.FindGitRoot` (`app/backend/internal/config/gitroot.go:8-22`)
  looking for a `.git` ancestor, and returns `""` when none is found. It is wired onto the window at
  `sessions.go:904` and shipped to the frontend as `Window.GitRoot`
  (`app/backend/internal/tmux/tmux.go:799-807`, `json:"gitRoot,omitempty"`).
- `codeRoot` (the "latch", `app/frontend/src/lib/code-folder-latch.ts:28,41-42`) is a one-time seed
  that makes a tab that has ever shown the code surface keep offering it even after the active pane
  `cd`s elsewhere — but it can only ever seed **from** a non-empty `gitRoot` in the first place
  (`code-folder-latch.ts:41-42`: `!win?.codeRoot && win?.gitRoot ? win.gitRoot : ...`). It cannot
  rescue a window whose cwd was never inside a repo.
- This is confirmed **deliberate, documented design**, not an accidental reuse of an unrelated
  field: `docs/specs/right-panel.md` Surface Registry (`code` row, line 92) states availability is
  "the window's code folder is LATCHED, or **a git root is derivable from the active pane's
  cwd**" — i.e., the spec explicitly requires a git root today.
- By contrast, the CLI path already treats "not in a git repo" as a supported, graceful case, not
  an error: `codeTargetFolder` (`app/backend/cmd/rk/code.go:201-212`) resolves `rk code`'s default
  `--folder` via `git rev-parse --show-toplevel`, **"falling back to the cwd itself when not inside
  a repo (or when git is unavailable)"** (comment at code.go:202-203). The UI gate is stricter than
  the CLI it's supposed to front — that asymmetry is the bug.

## Why

**Problem**: a user (or an agent) working in a tmux window whose cwd is not inside any git
repository — e.g. `/tmp`, a scratch directory, a non-git project — gets no code-server
affordance at all: no rail button, no switcher segment, `?view=code` and `?layout=` deep links
resolve as if the lens didn't exist. This is a real, common case (scratch work, ephemeral
directories, non-git tooling), and it contradicts the CLI (`rk code`), which already opens
code-server against the raw cwd in exactly this situation without complaint.

**Consequence of not fixing**: users must either open code-server from a *different* window that
happens to be inside a repo, or drop to the CLI (`rk code`) manually, even though the UI ostensibly
offers an equivalent, discoverable surface for every other window. The gap is invisible until you
hit it — there's no explanatory empty state, the code segment simply never appears.

**Why this approach (relax the gate + folder derivation, don't touch `config.FindGitRoot`
itself)**: `config.FindGitRoot` is a shared low-level primitive consumed by several *other*,
unrelated features that correctly need "is this inside a repo at all" semantics — e.g.
`app/backend/api/fork.go:182` and `app/backend/api/closed.go:263` both gate on
`config.FindGitRoot(cwd) == ""` to mean exactly that, and `cmd/rk/operator.go:237`,
`cmd/rk/riff.go:243,302,316`, `cmd/rk/tutorial.go:176` all call it directly for their own,
independent purposes. Changing `FindGitRoot`'s return semantics would silently change behavior for
all of those call sites. The window's frontend-facing `GitRoot` field
(`sessions.go:664` `deriveGitRoot` → `tmux.go:807` `Window.GitRoot`), however, has exactly one
consumer today — the code lens (`sessions.go:655-656`: "deriveGitRoot resolves the window's git
toplevel for the code lens/surface") — confirmed by a repo-wide grep turning up no other reader of
`sd.windows[j].GitRoot` / the frontend `win.gitRoot`. So the fix is scoped to that one path: widen
what the code lens accepts as its target folder, mirroring the CLI's existing cwd fallback,
without touching the shared primitive or its other callers.

## What Changes

### Backend: `deriveGitRoot` gets the same cwd fallback the CLI already has

`app/backend/internal/sessions/sessions.go:664-683` (`deriveGitRoot`) currently:

```go
func deriveGitRoot(w *tmux.WindowInfo) string {
    // ... resolves cwd from active pane (else first pane, else worktree path) ...
    return config.FindGitRoot(cwd)   // "" when cwd is not inside a git repo
}
```

Change it to fall back to the resolved `cwd` itself when `config.FindGitRoot` returns `""` —
the exact pattern `codeTargetFolder` already uses in `cmd/rk/code.go:205-212`:

```go
func deriveGitRoot(w *tmux.WindowInfo) string {
    cwd := /* same resolution as today: active pane, else first pane, else worktree path */
    if cwd == "" {
        return ""
    }
    if root := config.FindGitRoot(cwd); root != "" {
        return root
    }
    return cwd
}
```

This means `Window.GitRoot` (`tmux.go:807`, JSON `gitRoot`) is non-empty for every window that has
a resolvable cwd at all — it degrades from "the git toplevel" to "the git toplevel, or the raw cwd
when there isn't one" (still empty only in the genuine edge case where no cwd can be resolved at
all, e.g. a window with no panes). Field name, JSON key, and `omitempty` semantics are unchanged —
only the derivation's fallback branch is new. This keeps the change to one function and avoids a
field rename across the ~10 e2e spec files and unit tests that reference `gitRoot` by name (see
Affected Memory/Impact below for the doc/test text that *does* need updating to describe the new
fallback, as opposed to renaming).

### Frontend: no code change required for `hasCode` itself

Because `hasCode()` (`window-view.ts:88`) already treats *any* non-empty `gitRoot` as
code-capable, and the backend now always supplies one when a cwd is resolvable, `hasCode` starts
returning `true` for non-git windows automatically — no frontend logic change needed there. The
existing latch (`code-folder-latch.ts`) also needs no change: it already seeds from whatever
`gitRoot` carries, so it will now seed from the raw cwd for non-git windows, exactly as it does for
a git toplevel today.

### `codeServerSrc` / editor keying for non-git windows (explicit tradeoff, not a defect)

`docs/specs/right-panel.md` (`code` lens section, ~line 104) currently documents editor state as
"**Keyed by git root, not window id and not raw cwd** — ... two windows on one worktree
deliberately share one editor state." Outside a git repo there is no natural shared toplevel to key
on — two windows both outside any repo, each `cd`'d to a different scratch directory, will now get
**distinct** code-server folders (keyed on their own raw cwd), one per window, same as the CLI's
`codeTargetFolder` already does per-invocation. Two windows that happen to share the exact same
non-git cwd will share editor state, same as two windows sharing a git toplevel do today. This is
the correct, minimal-surprise behavior — not a new inconsistency — but the spec text should be
updated to describe it explicitly rather than leaving "keyed by git root" as the literal, now-wrong
claim.

### Spec update

`docs/specs/right-panel.md` Surface Registry `code` row (line 92) and the `code` lens keying note
(~line 104) both currently assert a hard git-root requirement / git-root keying. Both need
rewording to describe the cwd-fallback behavior above (availability triggers off "a derivable
folder" — git toplevel when found, else the active pane's raw cwd — rather than requiring a git
root specifically).

## Affected Memory

> **Correction (post-review-cycle-1)**: the original claim below — "no memory entries reference
> this behavior" — was wrong. Review's Step 4 memory-drift check (rework cycle 1) found three
> memory files describing the superseded hard git-root contract:

- `run-kit/api-and-sockets`: (modify) `docs/memory/run-kit/api-and-sockets.md:28` — "Empty when the
  cwd is not inside a git repo" (describes the old `gitRoot` semantics; needs the cwd-fallback
  update)
- `run-kit/architecture`: (modify) `docs/memory/run-kit/architecture.md:291,669` — "absent on
  non-repo windows" (same superseded contract)
- `run-kit/ui/lenses-and-layout`: (modify) `docs/memory/run-kit/ui/lenses-and-layout.md:65` — "a
  window that has never been inside a repo simply offers no code surface" (the exact behavior this
  change reverses)

- `docs/specs/right-panel.md`: (modify) Surface Registry `code` row (line 92: availability
  condition) and the `code` lens keying note (~line 104: "keyed by git root, not raw cwd") — both
  need to describe the new cwd-fallback derivation instead of a hard git-root requirement.

## Impact

**Backend** (one function, no new field):
- `app/backend/internal/sessions/sessions.go:664-683` (`deriveGitRoot`) — add the cwd fallback.
- Doc comments referring to `GitRoot` as strictly "the git toplevel" should be updated for
  accuracy: `app/backend/internal/tmux/tmux.go:802-807`, `sessions.go:655-663`.

**Frontend**: no functional code change expected in `hasCode` (`window-view.ts:87-89`),
`code-folder-latch.ts`, `right-panel.ts`, `surface-layout.tsx`, or `code-surface.tsx` — they all
already key off whatever `gitRoot`/`codeRoot` carries. Doc comments describing `gitRoot` as
"git toplevel" (`window-view.ts:34,79`, `code-folder-latch.ts:6,23`, `types.ts:185`,
`right-panel.ts:13`, `code-surface.tsx:14,35`) should be updated for accuracy, since they'll now be
read by someone debugging the non-git case.

**Docs**: `docs/specs/right-panel.md` (see Affected Memory).

**Tests requiring updates** (currently assert the *old*, git-required behavior — these are the
contract this change is intentionally flipping, not incidental breakage):
- `app/frontend/src/lib/window-view.test.ts:58-71,89-101` — `hasCode`/`availableViews` currently
  assert `gitRoot: ""` → `false`/code excluded; must be updated to reflect that a window with a
  resolvable cwd is now always code-capable (only an unresolvable-cwd window — no panes at all —
  stays `false`).
- `app/frontend/src/lib/right-panel.test.ts:29-38` — "gates code off without a gitRoot" needs
  updating to the new contract.
- `app/frontend/src/lib/surface-layout.test.ts:109,118,138,155,163,177` — "No gitRoot → code
  unavailable" cases need updating.
- `app/frontend/src/lib/code-folder-latch.test.ts:13-20,27-41` — latch seeding tests assumed a
  non-git case exists where `gitRoot` is empty; these need a case with a genuinely unresolvable
  cwd instead, or removal if that case is no longer reachable in test fixtures.
- `app/frontend/src/app.test.tsx:593-594` — `hasCode({ gitRoot: "" })` expecting `false`.
- e2e specs asserting the git-required contract with `cwd: "/tmp"` as the "non-repo → code
  unavailable" case: `app/frontend/tests/e2e/code-surface.spec.ts:198-243,406`,
  `app/frontend/tests/e2e/web-view-lens.spec.ts:26,85-88,194`,
  `app/frontend/tests/e2e/right-panel.spec.ts:227` — the `/tmp` cwd fixture no longer represents
  "code unavailable"; it now represents "code available, folder = /tmp". Backend test mocks that
  stamp `gitRoot` directly on fixture payloads (e.g. `shortcut-registry.spec.ts:115`) are
  unaffected since they stamp the field explicitly rather than deriving it.
- No changes expected for `app/backend/cmd/rk/code.go`, `operator.go`, `riff.go`, `tutorial.go`,
  `api/fork.go`, `api/closed.go` — all call `config.FindGitRoot` directly for their own,
  independent "is this inside a repo" checks, untouched by this change.

## Open Questions

None — root cause, scope, and the field-vs-rename tradeoff were resolved during investigation (see
Assumptions below for the graded design decision).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Do not change `config.FindGitRoot`'s return semantics | Repo-wide grep confirms 6+ independent call sites (`fork.go`, `closed.go`, `operator.go`, `riff.go`×3, `tutorial.go`) rely on `""` meaning "not in a repo" for unrelated features; changing the shared primitive would silently break them | S:90 R:20 A:95 D:90 |
| 2 | Confident | Fix scope = `deriveGitRoot`'s fallback only (keep `GitRoot`/`gitRoot` field name, no rename) | The frontend `Window.GitRoot` field has exactly one consumer (the code lens, confirmed by grep — no other reader of `sd.windows[j].GitRoot`/`win.gitRoot`); a same-name fallback mirrors the CLI's already-shipped `codeTargetFolder` pattern (code.go:205-212) and avoids a rename ripple across ~10 e2e spec files + unit tests that reference `gitRoot` by name for other reasons (mocking, assertions) | S:70 R:55 A:75 D:65 |
| 3 | Confident | Two non-git windows on different cwds get distinct (not shared) code-server folders — accept this, don't add a synthetic shared root | Matches the CLI's existing per-invocation behavior (`codeTargetFolder` resolves per-cwd, no shared-root concept outside git); the current "keyed by git root, not raw cwd" spec language is only about *git* worktrees sharing one root, which doesn't generalize to arbitrary non-git directories — there is no natural shared identity to invent | S:65 R:60 A:70 D:60 |
| 4 | Certain | `hasCode()` and the latch (`code-folder-latch.ts`) need no code changes, only doc-comment updates | Both already treat any non-empty `gitRoot` as code-capable / seedable; the fix is entirely upstream in what `gitRoot` contains | S:85 R:85 A:90 D:85 |

4 assumptions (2 certain, 2 confident, 0 tentative, 0 unresolved). Run /fab-clarify to review.
