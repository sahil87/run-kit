package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"

	"rk/internal/tmux"

	"github.com/spf13/cobra"
)

// rk agent-hook — the stable interface that agent-harness hooks invoke to report
// generic agent-lifecycle state into the @rk_agent_state pane option (see
// docs/specs/agent-state.md). It replaces the former self-contained shell
// one-liner: the harness config now carries only a thin
//
//	sh -c '[ -n "$TMUX_PANE" ] || exit 0; "<abs-rk>" agent-hook --agent claude <state> 2>/dev/null || true'
//
// wrapper (installed by `run-kit agent-setup`), and ALL logic — the comm-validated
// ancestor walk, the value formatting — lives here in Go where it is testable and
// tracks the binary on `brew upgrade run-kit`, with no settings churn and no agent
// session restarts. The @rk_agent_state VALUE SCHEMA is unchanged, so every
// reader (internal/tmux, internal/sessions, the frontend) is untouched.
//
// NEVER-FAIL CONTRACT: every path exits 0. Claude Code treats hook exit code 2 as
// blocking and other non-zero exits as warnings, so a broken hook must never
// produce either. main's execute() os.Exit(1)s on ANY error rootCmd.Execute()
// returns, so this command must swallow every error class ITSELF, before it can
// propagate: RunE always returns nil (runtime path), ArbitraryArgs disables
// arg-count validation, FParseErrWhitelist.UnknownFlags absorbs unknown flags,
// and SetFlagErrorFunc (in init) swallows KNOWN-flag parse errors (e.g. `--agent`
// with its value missing) — the one class the other three don't cover.
// SilenceErrors/SilenceUsage keep cobra from printing on any of these paths.

// agentHookCmdTimeout bounds every ps/tmux subprocess the hook spawns, per
// Constitution §I (Process Execution: 5-10s for short-lived helpers). A hung
// tmux or ps must never stall the agent's turn.
const agentHookCmdTimeout = 5 * time.Second

// agentHookAncestorHops is the ancestor-walk bound. Raised from the shell hook's
// 3 to 5: delegating through the binary adds a wrapper layer
// (claude → hook shell → sh -c → rk, and sh may or may not exec the final rk),
// so a few extra bounded hops are cheap and cover the deeper chain.
const agentHookAncestorHops = 5

// agentHookStampToken is the distinguished positional token that writes ONLY the
// @rk_chat pane option (the pane→session mapping) and NOT @rk_agent_state. It is
// used by the SessionStart registry row: SessionStart fires on startup/resume/
// clear/compact, and source=compact fires MID-TURN — an idle agent-state write
// there would clobber a live `active` state, so SessionStart stamps chat only.
// The three canonical agent states plus this token are the only tokens that
// write anything; any other is a silent no-op.
const agentHookStampToken = "stamp"

// hookStdinReadLimit bounds the stdin JSON read (~1 MiB). The hook payload is a
// small JSON object; the bound guards against a pathological/hung producer
// blocking the agent's turn while we read.
const hookStdinReadLimit = 1 << 20

// chatOption is the @rk_chat pane-option name, aliased from internal/tmux so the
// cross-repo convention has ONE source of truth per binary (A-021) — the writer
// and the reader (internal/tmux) never drift.
const chatOption = tmux.ChatOption

var agentHookAgent string

var agentHookCmd = &cobra.Command{
	Use:   "agent-hook <state>",
	Short: "Report an agent's lifecycle state to run-kit (invoked by installed hooks)",
	Long: "Write the @rk_agent_state tmux pane option for the current pane so " +
		"run-kit can show this agent's active/waiting/idle state. This is the " +
		"stable interface installed by `run-kit agent-setup` — the harness config " +
		"carries only a thin wrapper and all logic lives in the binary, so hook " +
		"behavior tracks `brew upgrade run-kit` with no settings changes or session " +
		"restarts. It no-ops outside tmux and always exits 0 (a hook must never " +
		"fail or block the agent).",
	// Args is deliberately ArbitraryArgs (not ExactArgs(1)): cobra's arg-count
	// validators run BEFORE RunE and return a non-zero error, which would exit the
	// process non-zero — Claude Code reads a non-zero hook exit as a warning (and 2
	// as blocking). The never-fail contract must hold for EVERY invocation, so arg
	// validation moves into RunE, which always returns nil. SilenceErrors/Usage
	// keep cobra from printing anything on the hot path.
	Args:          cobra.ArbitraryArgs,
	SilenceErrors: true,
	SilenceUsage:  true,
	// FParseErrWhitelist.UnknownFlags: an unknown flag on the hook-fire path must
	// not error out before RunE (cobra's flag-parse error exits non-zero, which the
	// harness reads as a warning). Whitelisting unknown flags lets them fall
	// through as (ignored) args so the never-fail contract holds for EVERY
	// invocation. The installed wrapper only ever passes known flags anyway.
	FParseErrWhitelist: cobra.FParseErrWhitelist{UnknownFlags: true},
	RunE: func(cmd *cobra.Command, args []string) error {
		if len(args) != 1 {
			// Malformed invocation — no state to write. Silent no-op, exit 0.
			return nil
		}
		runAgentHook(cmd.Context(), agentHookAgent, args[0])
		return nil
	},
}

func init() {
	agentHookCmd.Flags().StringVar(&agentHookAgent, "agent", "claude", "Agent harness whose comm literal drives pid resolution (v1: claude)")
	// KNOWN-flag parse errors (e.g. `--agent` present but its value missing) are
	// returned by pflag BEFORE RunE and are NOT covered by ArbitraryArgs (arg-count
	// only) or FParseErrWhitelist (unknown flags only). Swallowing them here is the
	// only seam that keeps such an invocation at exit 0 (never-fail contract) —
	// main's execute() os.Exit(1)s on any error Execute() returns. RunE then sees
	// an empty/partial args slice and no-ops without writing.
	agentHookCmd.SetFlagErrorFunc(func(*cobra.Command, error) error { return nil })
}

// runAgentHook is the testable core: guard on $TMUX_PANE, validate the agent and
// token, and — depending on the token — write @rk_agent_state (with a
// comm-validated ancestor-walk pid) and/or stamp @rk_chat from the hook stdin
// session id. Every failure is silent — it returns without error on every path
// so the caller always exits 0.
//
// Token dispatch:
//   - active|waiting|idle → write @rk_agent_state, AND stamp @rk_chat if the
//     hook stdin carries a session id (every-fire refresh: session ids rotate on
//     /clear + /compact, and this also stamps already-running agents on
//     `brew upgrade rk` with zero settings churn).
//   - stamp → stamp @rk_chat ONLY (no agent-state write). Used by the SessionStart
//     registry row, whose source=compact fires mid-turn where an idle write would
//     clobber a live active state.
//   - anything else → silent no-op.
func runAgentHook(parent context.Context, agent, token string) {
	if parent == nil {
		parent = context.Background()
	}

	// $TMUX_PANE guard (defense in depth — the shell wrapper also short-circuits
	// on this). No pane → not inside a tmux pane → nothing to write.
	pane := os.Getenv("TMUX_PANE")
	if pane == "" {
		return
	}

	// Validate the token: the three canonical agent states (aliased from
	// internal/tmux, A-021) write agent-state; the stamp token writes chat only.
	// Any other token writes nothing.
	writeState := isAgentState(token)
	if !writeState && token != agentHookStampToken {
		return
	}

	// Resolve the agent's comm literal from the per-agent registry. An unknown
	// --agent writes nothing. os.UserHomeDir failure is tolerated — the registry
	// comm/state mapping does not depend on the home dir, so fall back to "".
	home, _ := os.UserHomeDir()
	comm := agentCommForName(home, agent)
	if comm == "" {
		return
	}

	ctx, cancel := context.WithTimeout(parent, agentHookCmdTimeout)
	defer cancel()

	if writeState {
		// Resolve the agent pid via the bounded, comm-validated ancestor walk. 0
		// means "could not validate an ancestor" → the pid segment is omitted (a
		// two-segment value that degrades to the reader's legacy shell-name
		// fallback), never a wrong pid.
		pid := resolveAgentPID(ctx, os.Getppid(), comm)
		writeAgentState(ctx, pane, token, pid)
	}

	// Stamp @rk_chat from the hook stdin session id, on EVERY fire that yields
	// one (states and the stamp token alike). Absent/malformed/oversized stdin →
	// no stamp; the agent-state write above still proceeded.
	if sessionID := readHookSessionID(hookStdin()); sessionID != "" {
		writeChat(ctx, pane, comm, sessionID)
	}
}

// hookInput is the subset of the agent-harness hook stdin JSON the writer reads.
// All hook events carry session_id (docs re-verified 2026-07-13); every other
// field is ignored. Unknown JSON keys are tolerated by encoding/json.
type hookInput struct {
	SessionID string `json:"session_id"`
}

// hookStdinFn is a package-level seam so runAgentHook can be tested with an
// injected reader instead of the process's real stdin.
var hookStdinFn = func() io.Reader { return os.Stdin }

func hookStdin() io.Reader { return hookStdinFn() }

// readHookSessionID reads the hook payload from r and returns a validated
// session id, or "" on any failure. It is deliberately conservative:
//
//   - TTY guard: if r is os.Stdin attached to a terminal (os.ModeCharDevice), it
//     is NOT read — a manual `rk agent-hook` invocation in a terminal must never
//     block waiting for stdin.
//   - Bounded: reads through an io.LimitReader (~1 MiB) so a hung/pathological
//     producer can't stall the agent's turn.
//   - Single object: json.Decoder.Decode returns after ONE complete JSON object,
//     so it does not depend on stdin EOF (which the harness docs don't guarantee).
//   - Validated: the session id is checked with the SAME rule the reader applies
//     to a chat ref (non-empty, no whitespace/control), so a value the reader
//     would reject is never stamped.
//
// Every failure path returns "" (no stamp) — never an error, preserving the
// never-fail contract.
func readHookSessionID(r io.Reader) string {
	if r == nil {
		return ""
	}
	// TTY guard: skip a terminal stdin outright (manual invocation).
	if f, ok := r.(*os.File); ok {
		info, err := f.Stat()
		if err != nil {
			return ""
		}
		if info.Mode()&os.ModeCharDevice != 0 {
			return ""
		}
	}
	dec := json.NewDecoder(io.LimitReader(r, hookStdinReadLimit))
	var in hookInput
	if err := dec.Decode(&in); err != nil {
		return ""
	}
	if !isValidSessionID(in.SessionID) {
		return ""
	}
	return in.SessionID
}

// isValidSessionID mirrors internal/tmux's chat-ref validation (non-empty, no
// whitespace or control chars) so the writer never stamps a value the reader
// would reject. Kept in this binary (the reader's isChatRef is unexported); the
// rule is small and stable.
func isValidSessionID(s string) bool {
	if s == "" {
		return false
	}
	for _, c := range s {
		if c <= ' ' || c == 0x7f {
			return false
		}
	}
	return true
}

// isAgentState reports whether s is one of the three canonical agent states.
// Mirrors internal/tmux's own (unexported) validator against the same aliased
// constants — the reader and writer share one convention (A-021).
func isAgentState(s string) bool {
	return s == agentStateActive || s == agentStateWaiting || s == agentStateIdle
}

// agentCommForName returns the registry comm literal for the named agent, or ""
// if the agent is not registered. It reuses the same agentRegistry as the
// installer so the writer's --agent set and the installed hooks never diverge.
func agentCommForName(home, name string) string {
	for _, ac := range agentRegistry(home) {
		if ac.name == name || ac.comm == name {
			return ac.comm
		}
	}
	return ""
}

// resolveAgentPID walks up the process ancestry from startPPID, comparing each
// ancestor's comm against the agent literal, bounded to agentHookAncestorHops.
// It returns the pid of the first ancestor (including startPPID itself) whose
// comm equals comm, or 0 if none matches within the bound.
//
// Harnesses spawn hook commands through an EPHEMERAL intermediate shell that
// exits the moment the hook finishes, so a raw $PPID records that dead wrapper
// (the reader's PID-liveness check would then suppress every value). The walk
// climbs to the real agent pid instead; returning 0 (→ omit the pid segment) is
// always preferred over recording a wrong pid.
func resolveAgentPID(ctx context.Context, startPPID int, comm string) int {
	p := startPPID
	for i := 0; i < agentHookAncestorHops; i++ {
		if p <= 0 {
			return 0
		}
		if processComm(ctx, p) == comm {
			return p
		}
		p = processPPID(ctx, p)
	}
	return 0
}

// processCommFn / processPPIDFn are package-level seams so the walk is unit
// testable without spawning a real ancestor chain (mirrors agentProcessAlive /
// findPortOwner elsewhere in this package).
var (
	processCommFn = processCommImpl
	processPPIDFn = processPPIDImpl
)

// processComm returns the comm (executable basename) of the given pid, or "" on
// failure. Indirects through the test seam.
func processComm(ctx context.Context, pid int) string { return processCommFn(ctx, pid) }

// processPPID returns the parent pid of the given pid, or 0 on failure. Indirects
// through the test seam.
func processPPID(ctx context.Context, pid int) int { return processPPIDFn(ctx, pid) }

// processCommImpl reads a pid's comm (executable basename) by delegating to
// resolveCommand — the existing helper in daemon_portowner.go (same package):
// Linux reads /proc/<pid>/comm with no subprocess; elsewhere it shells out to
// `ps -o comm=` via exec.CommandContext with a timeout. Reused rather than
// re-implemented so the two comm-resolution sites cannot drift.
func processCommImpl(ctx context.Context, pid int) string {
	if pid <= 0 {
		return ""
	}
	return resolveCommand(ctx, pid)
}

// processPPIDImpl returns a pid's parent pid, or 0 on failure. On Linux it reads
// the "PPid:" line of /proc/<pid>/status with no subprocess — unlike
// /proc/<pid>/stat, the status file is line-keyed, so the stat file's
// comm-with-spaces/parens field-indexing hazard does not apply. Elsewhere it
// shells out to `ps -o ppid= -p` via exec.CommandContext with a timeout. The
// fast path matters: the walk makes up to ~4 ppid lookups per hook fire, and
// hooks fire on every agent lifecycle event.
func processPPIDImpl(ctx context.Context, pid int) int {
	if pid <= 0 {
		return 0
	}
	if runtime.GOOS == "linux" {
		data, err := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
		if err != nil {
			return 0
		}
		return parseProcStatusPPID(string(data))
	}
	cctx, cancel := context.WithTimeout(ctx, agentHookCmdTimeout)
	defer cancel()
	out, err := exec.CommandContext(cctx, "ps", "-o", "ppid=", "-p", strconv.Itoa(pid)).Output()
	if err != nil {
		return 0
	}
	ppid, err := strconv.Atoi(strings.TrimSpace(string(out)))
	if err != nil || ppid <= 0 {
		return 0
	}
	return ppid
}

// parseProcStatusPPID extracts the PPid value from /proc/<pid>/status content
// (a line of the form "PPid:\t<pid>"). Returns 0 when the line is absent or
// malformed, and for the kernel's own PPid 0 (pid 1 / kernel threads) — which
// correctly terminates the ancestor walk.
func parseProcStatusPPID(content string) int {
	for _, line := range strings.Split(content, "\n") {
		if !strings.HasPrefix(line, "PPid:") {
			continue
		}
		ppid, err := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(line, "PPid:")))
		if err != nil || ppid <= 0 {
			return 0
		}
		return ppid
	}
	return 0
}

// writeAgentStateFn is a package-level seam so runAgentHook can be tested without
// spawning tmux; the default writes via exec.CommandContext.
var writeAgentStateFn = writeAgentStateImpl

// writeAgentState writes the pane option with the UNCHANGED value schema
// "<state>:<epoch>[:<pid>]" — the pid segment is included only when pid > 0.
// Indirects through the test seam.
func writeAgentState(ctx context.Context, pane, state string, pid int) {
	writeAgentStateFn(ctx, pane, state, pid)
}

// writeAgentStateImpl runs `tmux [-S <socket>] set-option -pt <pane>
// @rk_agent_state <value>` via exec.CommandContext with a timeout
// (Constitution §I). Nothing user-provided is interpolated into a shell: state
// is a fixed registry literal, pane and socket are passed as discrete argv
// elements, and pid is an integer. Any error is swallowed — the hook must never
// fail the agent.
//
// The server is targeted via `-S <socket>` derived from the ORIGINAL $TMUX
// (tmux.OriginalTMUX), NOT os.Getenv("TMUX"): internal/tmux's init() strips
// $TMUX from the process so the daemon's bare tmux calls hit the default socket,
// and importing that package here triggers that strip. OriginalTMUX captures the
// value in a package-level var initializer that runs before init(), so it holds
// the caller's real socket — the pane's own server. Deriving -S from it (rather
// than relying on the child re-exporting $TMUX) also survives hook contexts like
// `tmux run-shell` that set $TMUX_PANE but not $TMUX. When it is empty we fall
// back to a bare invocation (best effort — the wrapper's `|| true` still holds).
func writeAgentStateImpl(ctx context.Context, pane, state string, pid int) {
	value := formatAgentStateValue(state, time.Now().Unix(), pid)
	args := tmuxSocketArgs(tmux.OriginalTMUX)
	args = append(args, "set-option", "-pt", pane, tmux.AgentStateOption, value)
	cctx, cancel := context.WithTimeout(ctx, agentHookCmdTimeout)
	defer cancel()
	// Errors are intentionally ignored (never-fail contract).
	_ = exec.CommandContext(cctx, "tmux", args...).Run()
}

// writeChatFn is a package-level seam so runAgentHook can be tested without
// spawning tmux; the default writes via exec.CommandContext.
var writeChatFn = writeChatImpl

// writeChat writes the @rk_chat pane option with value "<provider>:<sessionID>".
// Indirects through the test seam.
func writeChat(ctx context.Context, pane, provider, sessionID string) {
	writeChatFn(ctx, pane, provider, sessionID)
}

// writeChatImpl runs `tmux [-S <socket>] set-option -pt <pane> @rk_chat
// <provider>:<sessionID>` via exec.CommandContext with a timeout
// (Constitution §I). Nothing user-provided is interpolated into a shell: provider
// is a fixed registry comm literal, sessionID is a pre-validated argv element
// (isValidSessionID rejects whitespace/control), and pane/socket are discrete
// argv elements. The server is targeted the same way writeAgentStateImpl targets
// it — via `-S <socket>` derived from tmux.OriginalTMUX (see that function for
// why OriginalTMUX, not os.Getenv("TMUX")). Any error is swallowed (never-fail).
func writeChatImpl(ctx context.Context, pane, provider, sessionID string) {
	value := fmt.Sprintf("%s:%s", provider, sessionID)
	args := tmuxSocketArgs(tmux.OriginalTMUX)
	args = append(args, "set-option", "-pt", pane, chatOption, value)
	cctx, cancel := context.WithTimeout(ctx, agentHookCmdTimeout)
	defer cancel()
	// Errors are intentionally ignored (never-fail contract).
	_ = exec.CommandContext(cctx, "tmux", args...).Run()
}

// formatAgentStateValue formats the cross-repo @rk_agent_state value
// (docs/specs/agent-state.md § The Option): "<state>:<epoch_seconds>" when no
// pid was resolved (pid <= 0 — the two-segment legacy form readers fall back
// on), "<state>:<epoch_seconds>:<pid>" when one was. Pure — epoch is a
// parameter — so the byte-level contract is a testable unit; the schema is
// UNCHANGED by the agent-hook indirection and readers (parseAgentState, the
// reconciler) are untouched.
func formatAgentStateValue(state string, epoch int64, pid int) string {
	if pid > 0 {
		return fmt.Sprintf("%s:%d:%d", state, epoch, pid)
	}
	return fmt.Sprintf("%s:%d", state, epoch)
}

// tmuxSocketArgs derives the `-S <socket>` server-targeting prefix from a $TMUX
// value, whose format is "<socket_path>,<server_pid>,<session_id>". The socket
// path is the first comma-separated field. Returns an empty slice when the value
// is unset or malformed (bare-tmux fallback to the default socket).
func tmuxSocketArgs(tmuxEnv string) []string {
	if tmuxEnv == "" {
		return nil
	}
	socket := tmuxEnv
	if i := strings.IndexByte(socket, ','); i >= 0 {
		socket = socket[:i]
	}
	if socket == "" {
		return nil
	}
	return []string{"-S", socket}
}
