# Intake: CSI-u Extended-Keys Format in tmux Configs

**Change**: 260810-j93s-tmux-csi-u-extended-keys
**Created**: 2026-08-10

## Origin

Adopted from https://github.com/sahil87/run-kit/pull/547 — code authored off-pipeline in a conversational session, brought into the pipeline via `/fab-adopt`.

The session was conversational: the user shared a Kimi Code startup-warning screenshot and asked whether run-kit's tmux config should change and whether it would help agents beyond Kimi. The agent assessed the tradeoff, the user approved the edit, and the code PR was shipped first with adoption to follow.

> Check this message from Kimi: Should we change something in runkit's tmux config? Will this help other agents also? Or is this setting too kimi specific?
>
> [screenshot: "tmux extended-keys-format is xterm. Kimi Code works best with csi-u. Add `set -g extended-keys-format csi-u` to ~/.tmux.conf and restart tmux."]

Follow-ups: "yes go ahead" (apply the edit), then "First send a PR for the code change. Then make it a fab change, plus a follow on PR after that."

## Why

run-kit's embedded tmux configs enable extended keys (`extended-keys on` + the `extkeys` terminal feature) but leave `extended-keys-format` at tmux's default `xterm`, so tmux reports modified keys to inner applications in the legacy modifyOtherKeys form (`ESC[27;m;k~`). TUIs that request the kitty keyboard protocol — Kimi Code, crossterm-based tools, neovim, helix, fish 4 — expect the CSI-u form (`ESC[k;mu`); the mismatch breaks their modifier decoding (e.g. Shift+Enter), and Kimi Code warns about it on every startup inside a run-kit-managed server.

Without the fix, every kitty-protocol agent run inside run-kit's tmux servers degrades silently or nags the user. The fix is a one-line option per config; the format only applies to applications that opt into extended keys, so shells and TUIs that never request them see zero change, and the relay/xterm.js side is unaffected (the option is inner-app-facing).

`set -gq` (rather than a version-gated `%if`) was chosen for pre-3.5 tmux compatibility — the `-q` flag silently no-ops where the option doesn't exist, matching the config's existing `allow-passthrough` pattern.

## What Changes

### configs/tmux — CSI-u extended-keys format

`set -gq extended-keys-format csi-u` added next to the existing `extended-keys on` block in all three configs that carry it:

- `configs/tmux/default.conf` (the canonical embedded config) — with an explanatory comment:

  ```tmux
  # Report extended keys in kitty CSI-u form — what crossterm/kitty-protocol
  # TUIs (Kimi Code, neovim, helix, fish 4) expect; tmux's default xterm form
  # breaks their modifier decoding. -q: no-op on tmux < 3.5.
  set -gq extended-keys-format csi-u
  ```

- `configs/tmux/byobu.conf` — the bare option line in its TUI-compatibility block
- `configs/tmux/poweruser.conf` — the option line with a one-line comment

`configs/tmux/simple.conf` does not enable extended keys and is untouched.

## Affected Memory

- `run-kit/architecture`: (modify) note the CSI-u `extended-keys-format` default in the embedded tmux config description (TUI-compatibility posture: extended keys reported in kitty CSI-u form, `-q`-guarded for tmux < 3.5)

## Impact

- 3 config files, +7 lines, no code changes.
- `default.conf` is the canonical source copied to `app/backend/build/tmux.conf` at build time (gitignored), embedded via `go:embed`, and written to `~/.rk/tmux.conf` on first run (`EnsureConfig`). Existing installs keep their on-disk config until `rk init-conf --force` or a fresh install; already-running tmux servers pick the option up on restart, `source-file`, or a live `tmux set -g extended-keys-format csi-u`.
- Verified: all three configs boot a scratch tmux 3.6a server with no parse errors and report `extended-keys-format csi-u`; `internal/tmux` Go tests pass against the restaged embed copy.

## Open Questions

- (none)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | CSI-u benefits all kitty-protocol TUIs, not only Kimi — adopt it as the default format | User-confirmed in conversation; tmux 3.6a man page verified locally; option is scoped to apps that opt into extended keys | S:85 R:90 A:85 D:85 |
| 2 | Confident | `-q` guard over a version-gated `%if` for tmux < 3.5 compatibility | Matches the config's existing `allow-passthrough -gq` pattern; silent no-op is the desired degradation | S:65 R:90 A:80 D:70 |
| 3 | Confident | Rollout to existing installs (config rewrite / live `set`) is out of scope — config-default change only | Conversation surfaced the caveat and the user shipped the config change alone; operational cleanup stays operational | S:60 R:85 A:75 D:65 |
| 4 | Confident | Change type pinned `chore` to match PR #547's title prefix | /git-pr's diff ladder resolved `chore` (config files); consistency with the open PR beats relabeling | S:60 R:90 A:70 D:60 |

4 assumptions (1 certain, 3 confident, 0 tentative, 0 unresolved).
