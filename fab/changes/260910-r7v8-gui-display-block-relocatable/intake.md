# Intake: GUI display block — relocatable body, per-machine pointer

**Change**: 260910-r7v8-gui-display-block-relocatable
**Created**: 2026-09-10

## Origin

Conversational, out of a `/fab-discuss` session. The user's raw input (with two screenshots of a
`shll update` run on their Mac):

> Need small quick fix for this. My linux guard and MacOS guard keep overwriting each other.
> Should we have a different macOS and Linux card? Or another approach to solve the problem?
> (My dotfiles are synced across the two systems)

The screenshots showed `rk agent setup` (invoked by `shll update`'s terminal agent-setup refresh)
proposing, on macOS:

```
gui display: will add the rk gui display block in /Users/sahil/.zshenv (replaced in position):
  # >>> rk gui display >>>
  [ -n "$TMUX_PANE" ] && [ -z "${DISPLAY-}" ] && eval "$("/opt/homebrew/bin/run-kit" gui env 2>/dev/null)"
  # <<< rk gui display <<<

Write these changes? [y/N] N
gui display: skipped /Users/sahil/.zshenv (no changes written).
gui display: will add the rk gui display block in /Users/sahil/.bashrc (appended at end):
  ...
Write these changes? [y/N] N
```

The `tmux guard` PATH block in the same run reported `PATH block already present in
/Users/sahil/.bashrc — nothing to do.`

**Key decisions from the discussion** (see § Assumptions for grades):

- Root cause confirmed in `app/backend/cmd/rk/agent_setup.go`: `guiDisplayBlock(rkPath)` embeds
  the `resolveRkPath()`-resolved absolute binary path, which differs per host
  (`/opt/homebrew/bin/run-kit` on macOS, `/home/linuxbrew/.linuxbrew/bin/run-kit` on Linux).
  `~/.zshenv` and `~/.bashrc` are synced between the two hosts, so each host's
  `upsertMarkerBlock` sees foreign content and re-proposes a write; the "replaced in position"
  wording is that disagreement. The tmux guard PATH block never fights because its body is
  `$HOME`-relative; the tmux shim also embeds the absolute path but lives in
  `~/.local/share/rk/shims/`, which the dotfiles do not sync, so it is naturally per-machine.
- Three options were laid out; the user accepted the recommendation ("Go go ahead"):
  1. Per-OS marker blocks (the user's own suggestion) — rejected: keeps a per-machine fact in a
     synced file, needs a `uname` gate in shell, doubles the marker surface, and two Linux hosts
     with different prefixes would still fight.
  2. Resolve at read time via `command -v run-kit` — rejected: reintroduces the PATH dependency
     `resolveRkPath`'s doc comment deliberately removed (`.zshenv` runs before Homebrew's
     `shellenv` on macOS, so it would silently no-op there).
  3. **Chosen**: keep the synced block relocatable (`$HOME`-relative, byte-identical on every
     host) and move the per-machine absolute path into an unsynced per-machine pointer under
     `~/.local/share/rk/` — the same split the tmux shim already uses.
- The pointer is a **symlink** at `~/.local/share/rk/bin/run-kit` → the validated rk path. The
  `bin` directory MUST stay off `PATH` (unlike `shims/`): `resolveRkPath` uses
  `exec.LookPath("run-kit")`, and a pointer on PATH would resolve to itself on the next re-run.
- The prompt recurs on every `shll update` on both machines (not only manual `rk agent setup`
  runs), which is why the extra artifact is worth it.
- Flagged for the user, out of scope: the per-agent hooks in `~/.claude/settings.json` etc.
  embed the same absolute path; if any of those files are dotfile-synced they fight the same way.

## Why

**Problem.** `rk agent setup` writes the gui display block into shell startup files that many
users sync across machines. Because the block body carries the install host's absolute rk path,
two hosts with different Homebrew prefixes can never agree on the file content: each run on
host A rewrites host B's block and vice versa, and every `shll update` (which runs the
agent-setup refresh) re-raises the `Write these changes? [y/N]` prompt on both hosts forever.

**Consequence if unfixed.** The user has to decline the prompt on every update on every machine
(or accept and flip the fight to the other host). Declining leaves the block pointing at a path
that does not exist on this host, so the block is inert here: `DISPLAY` never lands in new pane
shells on the host that lost, and `rk gui exec`/`shot` guidance in `rk skill gui` about
"new shells land on the display automatically" is false there. Accepting on autopilot
(`shll update --yes` from the dashboard's one-click update passes `--yes`) means the block
silently flips between hosts with each update.

**Why this approach.** A synced file may carry only relocatable content — the rule the tmux
guard PATH block already follows (`export PATH="$HOME/.local/share/rk/shims:$PATH"`). The
per-machine fact (where rk lives) belongs in an unsynced per-machine location, which is exactly
what `~/.local/share/rk/` already is for the tmux shim. Splitting the gui block the same way
makes both hosts write byte-identical blocks (so syncing becomes a no-op and re-runs report
"already present"), keeps the block PATH-independent at read time (the pointer is an absolute
`$HOME`-rooted path, not a PATH lookup), and needs no OS detection in shell. It fixes the class
of bug, not just the macOS/Linux pair.

## What Changes

All Go changes live in `app/backend/cmd/rk/agent_setup.go` (plus a constant beside
`rkShimsRelDir` in `tmux_guard.go` if that placement reads better) and their tests in
`app/backend/cmd/rk/agent_setup_test.go`.

### 1. The block body becomes a `$HOME`-relative constant

`guiDisplayBlock(rkPath string) string` becomes a constant `guiDisplayBlock` with no
interpolation, mirroring `tmuxGuardPathBlock`:

```sh
# >>> rk gui display >>>
[ -n "$TMUX_PANE" ] && [ -z "${DISPLAY-}" ] && [ -x "$HOME/.local/share/rk/bin/run-kit" ] && eval "$("$HOME/.local/share/rk/bin/run-kit" gui env 2>/dev/null)"
# <<< rk gui display <<<
```

- The marker lines (`# >>> rk gui display >>>` / `# <<< rk gui display <<<`) are **unchanged** —
  the frozen ownership contract, so existing installs on both hosts are found by
  `markerBlockBounds` and replaced in position (a one-time write per host; after that every
  re-run is the "block already present" no-op on both).
- `$HOME` is expanded by the shell at source time, like the PATH block's `$HOME` — the block
  is home-relocatable and byte-identical on every host.
- The new `[ -x "$HOME/.local/share/rk/bin/run-kit" ]` guard keeps a missing or dangling
  pointer silent by construction (one `stat` per shell start; a dangling symlink fails `-x`),
  rather than relying on `2>/dev/null` to swallow the shell's exec-failure message. The three
  existing guards (`$TMUX_PANE`, unset `DISPLAY`, `2>/dev/null`) stay as documented in
  `docs/memory/run-kit/gui.md`.
- The pointer path is composed from one new constant, `rkBinRelDir = ".local/share/rk/bin"`
  (sibling of `rkShimsRelDir = ".local/share/rk/shims"`), with a helper `rkBinDir(home)` /
  `guiRkPointerPath(home)` for the Go side, and the shell literal in the block spelled from the
  same constant (via `fmt.Sprintf` at init or a `const` composed with `+`) so the Go path and the
  shell path can never disagree.

### 2. A per-machine pointer symlink, installed and removed by `rk agent setup`

New step inside `applyGuiDisplayBlocks` (or a sibling `applyGuiDisplayPointer` it calls first),
running on install **before** the block upsert and on uninstall **after** the block removal:

**Install** (`rkPath` is the `resolveRkPath`/`validateHookPath`-validated absolute path, resolved
once in `runAgentSetup`, exactly as today):

- `linkPath := filepath.Join(home, ".local/share/rk/bin", "run-kit")`.
- `os.Lstat(linkPath)`:
  - **absent** → propose `gui display: will link <linkPath> -> <rkPath>.` on the data channel
    and ask consent through `cons.authorizeWrite` (same seam as every other artifact; the
    dry-run note is `gui display: dry run — <linkPath> not created.`). On consent:
    `os.MkdirAll(filepath.Dir(linkPath), 0o755)` **after** consent (dry-run and declined prompts
    leave the filesystem untouched, like the `$ZDOTDIR` MkdirAll), then create the symlink
    atomically: `os.Symlink(rkPath, tmp)` in the same directory + `os.Rename(tmp, linkPath)`,
    so a shell starting mid-update never sees a missing pointer. Report
    `gui display: linked <linkPath> -> <rkPath>.` (chatter).
  - **a symlink** → `os.Readlink`; if the target equals `rkPath` it is a reported no-op
    (`gui display: pointer already links <linkPath> -> <rkPath> — nothing to do.`, chatter);
    otherwise propose `gui display: will relink <linkPath> -> <rkPath> (currently -> <old>).`,
    consent, then the same atomic replace. This is the brew-rename / dangling case and the
    "moved install" case — rk owns any **symlink** at this path (rk never writes a regular file
    there).
  - **anything else** (regular file, directory — the foreign case) → note
    `gui display: <linkPath> exists and is not a symlink — leaving it untouched (rk only
    replaces pointers it owns).` and report the pointer as **not in place**.
- The install returns `pointerInPlace bool`: true when freshly linked, already current, or a
  dry-run previewing the link; false on a declined write or a foreign file.
- **Gating (mirrors the PATH block ↔ shim rule, for the same reason):** the block upsert runs
  only when `pointerInPlace` is true. Writing a block that execs `$HOME/.local/share/rk/bin/run-kit`
  in front of a foreign file at that path would run a non-rk executable from every pane shell's
  startup; in front of nothing it would be silently inert. On skip: `gui display: skipping the
  startup-file block (the pointer is not in place).` (chatter). This replaces today's
  "independent of the shim" posture — the block is still independent of the **tmux shim**, but
  now depends on its **own** pointer.

**Uninstall** (`rkPath == ""`, as today):

- Strip the blocks from the startup files first (unchanged flow, `removeMarkerBlock`), then
  handle the pointer: `Lstat` absent → silent; a symlink → propose
  `Remove <linkPath>? [y/N]` through `authorizeWrite` (dry-run note `gui display: dry run —
  pointer left in place (nothing removed).`), `os.Remove(linkPath)` on consent, then a
  best-effort `os.Remove(filepath.Dir(linkPath))` to prune the now-empty `bin` dir (refuses
  non-empty dirs, so it can never delete anything else — the `removeTmuxShimFile` idiom);
  not a symlink → note `gui display: <linkPath> is not a symlink — leaving it untouched (rk only
  removes pointers it owns).`
- Uninstall keeps the pieces independent, like the shim: a declined pointer removal never skips
  the block strip and vice versa.

**Consent shape.** One prompt for the pointer (install: link/relink; uninstall: remove) plus the
existing one prompt per startup file for the block. Under `--yes` (what `shll update --yes`
passes) everything applies silently; under `--dry-run` nothing is written and each step prints
its dry-run note; a non-TTY stdin without `--yes` hits the existing refusal before any of this
runs.

### 3. `runAgentSetup` wiring and comments

- The call site stays `applyGuiDisplayBlocks(sink, reader, home, zdotdir, rkPath, uninstall,
  cons)`; the function grows the pointer step internally so `runAgentSetup` changes only in its
  comment: the block no longer "embeds the validated rk path directly" — it "reaches rk through
  the per-machine pointer `~/.local/share/rk/bin/run-kit`, which embeds the validated path".
- `guiDisplayBlock`'s doc comment is rewritten: the guards, the `$HOME` relocatability rule
  ("a synced startup file may carry only relocatable content — the per-machine path lives in
  the pointer, exactly as the tmux shim carries it under `~/.local/share/rk/`"), and why `bin/`
  must stay off PATH (`resolveRkPath` self-resolution).
- No change to `resolveRkPath`, `validateHookPath`, `tmuxGuardStartupFiles`,
  `upsertMarkerBlock`/`removeMarkerBlock`, or anything in the tmux guard family.

### 4. Tests (`agent_setup_test.go`)

- Existing gui display tests are updated for the constant block and the pointer: helper
  `installGuiDisplayBlock(t, home, rkPath)` now also creates the pointer; assertions that
  compared against `guiDisplayBlock("/opt/homebrew/bin/rk")` compare against the constant;
  `TestGuiDisplayBlockIndependentOfShim` keeps its meaning (a foreign tmux shim does not skip
  the gui block) and additionally asserts the pointer was created.
- New tests, each pure over a `t.TempDir()` home and an injected rk path (never the host PATH):
  - **Regression for this bug**: install with `rkPath=/opt/homebrew/bin/run-kit` into one home
    and `rkPath=/home/linuxbrew/.linuxbrew/bin/run-kit` into another → the `.zshenv` contents
    are byte-identical, and a second install on either home reports
    `gui display: block already present` with no write.
  - Fresh install creates `~/.local/share/rk/bin/run-kit` as a symlink to `rkPath` (Lstat mode
    is symlink, Readlink equals `rkPath`) and the block contains
    `"$HOME/.local/share/rk/bin/run-kit"` and no absolute rk path.
  - Relink: an existing symlink to a different target is replaced (consent prompt wording
    includes `relink`), the block is untouched ("already present").
  - Foreign regular file at the pointer path: left untouched, block **not** written, skip note
    present; uninstall also leaves it.
  - Uninstall removes the symlink and the block, prunes the empty `bin` dir, leaves user
    content byte-identical; a second uninstall is silent.
  - `--dry-run` creates neither the `bin` dir nor the link and prints both dry-run notes.
  - Declined pointer consent (`n`) skips the block with the skip note.
- Existing `TestTmuxShim*` tests are unaffected (they do not run the gui step).

### 5. Docs

- `docs/memory/run-kit/gui.md` § Agent verbs — the "`rk gui display` shell block" paragraph:
  the exact body is replaced by the constant above, the "`<abs-rk>` embedded double-quoted"
  sentence becomes the pointer description (path, symlink, ownership = "any symlink at that
  path", atomic replace, `bin/` off PATH), the gating sentence flips from "does not gate on the
  shim" to "gates on its own pointer being in place, not on the tmux shim". The Design Decision
  "DISPLAY reaches panes through a shell-startup block that evals `rk gui env`" gets its body
  updated and a new Design Decision entry records the relocatability rule with the two rejected
  alternatives (per-OS blocks; `command -v` at read time).
- `docs/memory/run-kit/agent-state.md` § `rk agent setup` — item 3 (`applyGuiDisplayBlocks`)
  and the "three artifact families" sentence: the gui family is now "a per-machine pointer
  symlink plus the marker-owned block", independent of the shim's outcome but gated on its own
  pointer; the Design Decision "Explicit `rk agent setup` opt-in" list gains the pointer as an
  artifact with its own consent.
- `docs/site/skill/gui.md` line 26 already describes the block without a path — no change
  (the embedded copy `cmd/rk/skill/gui.md` is drift-guarded, so leaving both alone is the safe
  choice).

## Affected Memory

- `run-kit/gui`: (modify) the `rk gui display` block body, the pointer artifact, the gating
  rule, and a new Design Decision on synced-file relocatability
- `run-kit/agent-state`: (modify) the `rk agent setup` third artifact family (pointer + block),
  install/uninstall ordering and consent

## Impact

- **Code**: `app/backend/cmd/rk/agent_setup.go` (gui display section + `runAgentSetup` comment;
  ~60–90 lines net), one constant next to `rkShimsRelDir` in `tmux_guard.go`,
  `app/backend/cmd/rk/agent_setup_test.go` (updated + ~7 new tests). No frontend, no API, no
  tmux, no `internal/` changes.
- **User-visible**: `rk agent setup` gains one consent prompt (the pointer) and the block body
  changes; the first re-run on each host rewrites the block once, then both hosts are silent.
  `rk agent setup --uninstall` removes the pointer. Existing installs migrate through the
  unchanged marker lines — no manual cleanup.
- **Filesystem**: new `~/.local/share/rk/bin/run-kit` symlink (and `bin/` dir) per machine.
  Constitution II is untouched — this is an installed artifact under the user's data dir, not
  state; nothing is read from it at request time by the server.
- **Constitution X**: preserved — the block still derives `DISPLAY` by evaluating `rk gui env`
  at shell start; only *where the binary is found* moves.
- **Not touched**: the tmux guard shim/PATH block, `resolveRkPath`, `rk doctor` (no pointer
  check added — see Open Questions), the per-agent hook installers.

## Open Questions

- Should `rk doctor` gain a `gui display pointer` row (dangling/missing/foreign), mirroring the
  `tmux-guard shim` check? Left out to keep the fix small; the failure mode is a silent
  no-`DISPLAY`, not the shim's every-tmux-call stall. Backlog candidate.
- The per-agent hook files (`~/.claude/settings.json`, codex/opencode/copilot configs) embed the
  same absolute path. If a user syncs those, they fight identically. Out of scope here; the user
  was told to check.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix the block by making it `$HOME`-relative and moving the per-machine rk path into an unsynced pointer under `~/.local/share/rk/`, not per-OS marker blocks or a `command -v` lookup | Discussed — three options presented with tradeoffs, user chose this one ("Go go ahead"); it mirrors the tmux shim's existing per-machine split | S:95 R:70 A:95 D:90 |
| 2 | Certain | The pointer is a symlink at `~/.local/share/rk/bin/run-kit` (new `rkBinRelDir` beside `rkShimsRelDir`), and `bin/` stays off PATH | Discussed — the off-PATH constraint was named explicitly (`resolveRkPath` would otherwise self-resolve); symlink over wrapper script because there is nothing to embed beyond the path | S:90 R:80 A:90 D:80 |
| 3 | Confident | The block upsert gates on the pointer being in place (fresh/current/dry-run) and is skipped with a note on a declined write or a foreign non-symlink file | Same safety rule the PATH block applies to the shim — never point a startup file at a non-rk executable; `code-review.md` counts exec/injection as must-fix | S:70 R:85 A:90 D:80 |
| 4 | Confident | rk owns any **symlink** at the pointer path (relinks a stale one without further ownership checks); a regular file or directory there is foreign and untouched | rk only ever writes a symlink there; a user symlink named `run-kit` in `~/.local/share/rk/bin/` is implausible; mirrors "rk only overwrites files it owns" | S:60 R:85 A:80 D:75 |
| 5 | Confident | Add `[ -x "$HOME/.local/share/rk/bin/run-kit" ]` as a fourth guard in the block | One stat per shell start; makes a missing/dangling pointer silent by construction instead of relying on `2>/dev/null` covering the shell's exec-failure message | S:65 R:90 A:85 D:70 |
| 6 | Confident | Pointer creation and relink are consented through `authorizeWrite` (one prompt), created atomically via temp symlink + rename, with `MkdirAll` after consent | Every other artifact in `rk agent setup` is diff-and-consent (the "explicit, not silent sync" decision); `--yes` from `shll update` keeps it non-interactive | S:70 R:90 A:90 D:80 |
| 7 | Confident | Marker lines are unchanged so existing blocks on both hosts migrate by in-position replacement; no legacy-cleanup path needed | `markerBlockBounds` matches on the marker lines only; the body is what changed | S:80 R:90 A:95 D:90 |
| 8 | Tentative | No `rk doctor` row for the pointer in this change | Kept small per the user's "small quick fix"; recorded as an Open Question / backlog candidate rather than decided forever | S:55 R:95 A:70 D:60 |
| 9 | Confident | `~/.local/share/rk/` is not synced by the user's dotfiles | The tmux shim already lives there and works on both hosts without fighting; if it were synced the shim's embedded path would have surfaced the same way | S:60 R:80 A:70 D:80 |

9 assumptions (2 certain, 6 confident, 1 tentative, 0 unresolved).
