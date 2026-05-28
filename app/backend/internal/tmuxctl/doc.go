// Package tmuxctl owns the long-running tmux control-mode subscription used by
// `rk serve` to push tmux state changes to SSE clients with sub-500ms latency.
//
// Unlike sibling subprocess work (which goes through internal/tmux/), this
// package opens a `tmux -CC` connection per tmux server via a PTY and parses
// the streamed notifications. It is the only sanctioned bypass of the
// internal/tmux/ boundary — analogous to how cmd/rk/riff.go bypasses tmux/
// for user-server reasons, tmuxctl/ bypasses for a different reason: a single
// long-lived subscription is the wrong shape for a request-response helper
// package built around exec.CommandContext + 10s timeouts.
//
// Core types:
//
//   - Client      — one PTY-backed `tmux -CC` subscription per tmux server.
//   - Supervisor  — fsnotify-driven map[socket]*Client; opens/closes Clients
//                   as tmux sockets appear/disappear under $TMUX_TMPDIR (or
//                   the default /tmp/tmux-<euid>/).
//   - EventSink   — the consumer interface (typically the SSE hub) that
//                   receives notification callbacks.
//   - ParseLine   — pure-function parser for control-mode lines.
//
// Constitution alignment:
//
//   - No persistent state. The Supervisor's map mirrors the live filesystem
//     view of tmux sockets; nothing is written to disk.
//   - No new network surface. The Client is a local subprocess.
//   - Process execution via exec.CommandContext with explicit argument slices.
//   - Anchor session named `_rk-ctl` is created and tagged with
//     `@rk_ctl_keepalive=1` when needed; filtered from user-facing UIs via
//     tmux.ControlAnchorSessionName.
package tmuxctl
