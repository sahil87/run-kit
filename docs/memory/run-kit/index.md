# run-kit Memory Domain

| File | Description |
|------|-------------|
| [architecture.md](architecture.md) | System architecture, component responsibilities, data flow |
| [tmux-sessions.md](tmux-sessions.md) | Session enumeration, group filtering, direct-attach relay + move-based board pin-sessions (`_rk-pin-*`), window addressing, SSE poll-set reap on dead-server fetch error (shared `tmux.IsServerGone` sentinel), unified test-socket naming + `rk reaper`, env-gated `RK_SERVER_ALLOWLIST` test-scoping |
| [ui-patterns.md](ui-patterns.md) | URL structure, three-way server route guard (view/waiting/not-found) + create-server pending lifecycle + `server-gone` reap-to-not-found flip, keyboard shortcuts, component conventions |
| [rk-riff.md](rk-riff.md) | `rk riff` subcommand — worktree + tmux window + Claude launcher |
