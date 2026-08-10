# Plan: CSI-u Extended-Keys Format in tmux Configs

**Change**: 260810-j93s-tmux-csi-u-extended-keys
**Intake**: `intake.md`

> Adopted change — code authored off-pipeline. Apply was skipped; this plan is reverse-engineered from the branch diff to feed hydrate.

## Requirements

### configs/tmux — CSI-u extended-keys format

run-kit's tmux configs that enable extended keys (`default.conf`, `byobu.conf`, `poweruser.conf`) also set `extended-keys-format` to `csi-u`, so tmux reports modified keys to inner applications in the kitty CSI-u form (`ESC[k;mu`) instead of the legacy xterm/modifyOtherKeys form (`ESC[27;m;k~`). This fixes modifier decoding (e.g. Shift+Enter) for kitty-keyboard-protocol TUIs — Kimi Code, crossterm-based tools, neovim, helix, fish 4 — which otherwise mis-decode or warn on startup.

The option is set with `set -gq`: the `-q` flag makes it a silent no-op on tmux < 3.5 (where the option does not exist), matching the config's existing `allow-passthrough -gq` degradation pattern. The format only applies to applications that opt into extended keys; shells and TUIs that never request them are unaffected, and the relay/xterm.js client side is untouched (the option is inner-app-facing). `simple.conf` does not enable extended keys and stays unchanged.

`default.conf` remains the canonical embedded source (copied to `app/backend/build/tmux.conf` at build time, written to `~/.rk/tmux.conf` on first run). Existing installs keep their on-disk config until `rk init-conf --force` or a fresh install; running tmux servers pick the option up on restart, `source-file`, or a live `set -g`.

## Tasks

- [x] Adopted: implementation authored outside the pipeline (see https://github.com/sahil87/run-kit/pull/547).

## Acceptance

- [x] Adopted: code already authored and verified (scratch-server parse checks + `internal/tmux` tests); a diff-only review runs in this pipeline.

## Assumptions

0 assumptions.
