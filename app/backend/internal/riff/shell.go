package riff

import (
	"fmt"
	"path"
	"regexp"
	"strings"

	"rk/internal/tmux"
)

// buildSkillShellString composes the shell string for a skill-type pane in
// three layers:
//  1. launcher-with-cmd-arg: `<launcher> '<escaped-cmdArg>'` OR just `<launcher>`
//     when cmdArg is empty (bare launcher: no positional).
//  2. interactive wrap: `${SHELL:-/bin/sh} -i -c '<escaped-layer-1>'` so
//     .zshrc/.bashrc aliases reach the launcher.
//  3. shellWrap suffix: `; exec "${SHELL:-/bin/sh}"` so the pane stays interactive.
//
// This is the task-injection seam the HTTP endpoint reuses: the task text is
// cmdArg, single-quote-escaped into the documented launcher exception.
func buildSkillShellString(launcher, cmdArg string) string {
	var layer1 string
	if cmdArg == "" {
		layer1 = launcher
	} else {
		layer1 = fmt.Sprintf("%s '%s'", launcher, escapeSingleQuotes(cmdArg))
	}
	interactive := fmt.Sprintf(`${SHELL:-/bin/sh} -i -c '%s'`, escapeSingleQuotes(layer1))
	return shellWrap(interactive)
}

// sessionUUIDRe matches the strict Claude session-UUID shape — the SAME rule as
// internal/chat's uuidRe. Duplicated here (rather than imported) deliberately:
// this is a defense-in-depth gate at the seam where the ref enters the
// deliberately-unescaped launcher string, and internal/riff must not depend on
// internal/chat to hold the security property (constitution §I). The API layer
// validates the ref before the engine is ever called; this re-check is what
// makes the property local to the composition.
var sessionUUIDRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// forkLauncherCommand is the only launcher a conversation fork can attach to:
// `--resume <id> --fork-session` are Claude Code flags, so a resolved launcher
// running anything else must not receive them.
const forkLauncherCommand = "claude"

// resumeForkLauncher appends `--resume <ref> --fork-session` to launcher so the
// spawned agent forks the conversation named by ref instead of starting fresh
// (260806-s4av). The flags ride the LAUNCHER half of buildSkillShellString — the
// one deliberately-unescaped element (see § Single-Quote Escaping) — because
// they must reach the agent binary as flags, not as a quoted positional
// argument.
//
// An empty ref returns launcher unchanged (the ordinary-spawn path, byte-identical
// to pre-fork behavior). A ref failing the strict UUID shape ALSO returns
// launcher unchanged: the shape check is the guard that keeps shell-significant
// characters out of the unescaped launcher, so a malformed ref must degrade to a
// plain spawn rather than compose anything.
//
// A well-formed ref whose launcher is NOT a claude invocation is a
// ValidationErr (→ 400): ResolveLauncher returns whatever the repo's default fab
// tier resolves to, which in a mixed-provider repo can be codex/gemini, and the
// source window's claude gate says nothing about that. Failing loudly beats the
// two silent alternatives — handing claude-only flags to another binary, or
// dropping the suffix and spawning an unforked agent that looks like a fork.
// Pure apart from the error value.
func resumeForkLauncher(launcher, ref string) (string, error) {
	if ref == "" || !sessionUUIDRe.MatchString(ref) {
		return launcher, nil
	}
	if cmd := launcherCommandName(launcher); cmd != forkLauncherCommand {
		return "", ValidationErr("run-kit riff: cannot fork a conversation with launcher %q — --resume/--fork-session require %s", launcher, forkLauncherCommand)
	}
	return fmt.Sprintf("%s --resume %s --fork-session", launcher, ref), nil
}

// launcherCommandName returns the basename of a launcher string's first
// whitespace-separated word — `claude` for both `claude --foo` and
// `/opt/homebrew/bin/claude --foo`. An empty launcher yields "". Pure.
//
// A word-level split is deliberately naive about shell grammar (a launcher
// prefixed with `env FOO=1` reads as `env`): it is a gate, not a parser, so it
// errs toward rejecting a launcher it cannot positively identify as claude.
func launcherCommandName(launcher string) string {
	fields := strings.Fields(launcher)
	if len(fields) == 0 {
		return ""
	}
	return path.Base(fields[0])
}

// buildCmdShellString composes the shell string for a cmd-type pane. cmd panes
// get NO interactive `sh -i -c` wrap (the user's command is self-sufficient and
// wrapping would alter argv semantics). shellWrap appends the `; exec $SHELL`
// tail. Empty value → the bare-shell path (just `exec "${SHELL:-/bin/sh}"`).
func buildCmdShellString(value string) string {
	return shellWrap(value)
}

// paneShellString dispatches between skill and cmd composition by pane kind.
func paneShellString(launcher string, pane PaneSpec) string {
	if pane.Kind == PaneKindSkill {
		return buildSkillShellString(launcher, pane.Value)
	}
	return buildCmdShellString(pane.Value)
}

// sessionTarget returns the `new-window -t` target that creates the window IN
// spec.Session — the exact-match session form `=<session>:` (tmux.
// ExactSessionTarget) — or "" when Session is empty (CLI path — unscoped, so
// the ambient/attached session is used, byte-identical to pre-session
// behavior). The exact form is required because new-window's -t is a *window*
// target: a bare session name is matched against the attached session's window
// names first, so a window named like the target session would hijack the
// spawn into the wrong session (the same collision internal/tmux guards its
// own CreateWindow against).
func sessionTarget(spec EffectiveSpec) string {
	if spec.Session == "" {
		return ""
	}
	return tmux.ExactSessionTarget(spec.Session)
}

// windowTarget returns the tmux target for a NAMED window inside spec.Session:
// `=<session>:<name>` on the daemon path (exact-match session part, so
// split-window/select-layout operate on the correct session's window) or just
// `<name>` on the CLI path (empty Session → unscoped, byte-identical to
// pre-session behavior).
func windowTarget(spec EffectiveSpec, name string) string {
	if spec.Session == "" {
		return name
	}
	return tmux.ExactSessionTarget(spec.Session) + name
}

// buildSpawnArgvs returns the ordered tmux argvs (server prefix NOT included —
// tmuxArgv adds it at exec time) for a (worktreePath, resolvedName, spec) triple:
//
//	[0]: new-window (creates the window with pane 0)
//	[1..N-1]: split-window (one per additional pane)
//	[-1]: select-layout (skipped when spec.Layout == "")
//
// On the daemon path (spec.Session != "") new-window carries `-t =<session>:`
// (exact-match session form) so the window lands in the requested session, and
// split-window/select-layout target `=<session>:<name>`; on the CLI path
// (empty Session) all targets are unscoped (byte-identical to pre-session
// behavior).
//
// The trailing select-pane step is NOT in this slice — the pane id is a runtime
// value; the orchestrator constructs that argv from the captured pane id. Pure.
func buildSpawnArgvs(worktreePath, resolvedName string, spec EffectiveSpec) [][]string {
	argvs := make([][]string, 0, len(spec.Panes)+1)
	if len(spec.Panes) == 0 {
		return argvs
	}
	newWindow := []string{"new-window"}
	if t := sessionTarget(spec); t != "" {
		newWindow = append(newWindow, "-t", t)
	}
	newWindow = append(newWindow,
		"-n", resolvedName,
		"-c", worktreePath,
		paneShellString(spec.Launcher, spec.Panes[0]),
	)
	argvs = append(argvs, newWindow)
	for _, pane := range spec.Panes[1:] {
		argvs = append(argvs, []string{
			"split-window",
			"-h",
			"-t", windowTarget(spec, resolvedName),
			"-c", worktreePath,
			paneShellString(spec.Launcher, pane),
		})
	}
	if spec.Layout != "" {
		argvs = append(argvs, []string{"select-layout", "-t", windowTarget(spec, resolvedName), spec.Layout})
	}
	return argvs
}

// buildNewWindowCaptureArgs returns the argv for
// `tmux new-window -P -F '#{pane_id}' …` for the first pane. The `-P -F` capture
// prints the new pane id (e.g. `%87`) so the orchestrator can target the final
// select-pane by pane id rather than a hardcoded `.0` index. On the daemon path
// it carries `-t =<session>:` (exact-match session form) so the window is
// created in the requested session; on the CLI path (empty Session) the target
// is unscoped. Pure.
func buildNewWindowCaptureArgs(worktreePath, resolvedName string, spec EffectiveSpec) []string {
	argv := []string{
		"new-window",
		"-P",
		"-F", "#{pane_id}",
	}
	if t := sessionTarget(spec); t != "" {
		argv = append(argv, "-t", t)
	}
	argv = append(argv,
		"-n", resolvedName,
		"-c", worktreePath,
		paneShellString(spec.Launcher, spec.Panes[0]),
	)
	return argv
}

// parsePaneID parses the stdout of `tmux new-window -P -F '#{pane_id}'` (a single
// line with the new pane id). Returns the trimmed id or an error on
// empty/whitespace-only input. Pure.
func parsePaneID(stdout string) (string, error) {
	id := strings.TrimSpace(stdout)
	if id == "" {
		return "", fmt.Errorf("empty pane id from tmux new-window -P")
	}
	return id, nil
}

// shellWrap appends `; exec "${SHELL:-/bin/sh}"` to cmd so the pane drops into an
// interactive shell rather than closing when cmd exits. Empty/whitespace-only
// input yields just the bare `exec "${SHELL:-/bin/sh}"` (never a leading `;`).
// Pure.
func shellWrap(cmd string) string {
	if strings.TrimSpace(cmd) == "" {
		return `exec "${SHELL:-/bin/sh}"`
	}
	return fmt.Sprintf(`%s; exec "${SHELL:-/bin/sh}"`, cmd)
}

// escapeSingleQuotes returns s with every literal ' replaced by the 4-character
// sequence '\'' (close the quote, emit a backslash-escaped literal quote, reopen
// the quote) so the result can be embedded inside a single-quoted shell string
// (canonical POSIX shell-safe encoding). Pure.
func escapeSingleQuotes(s string) string {
	return strings.ReplaceAll(s, "'", `'\''`)
}
