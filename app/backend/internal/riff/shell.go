package riff

import (
	"fmt"
	"strings"
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

// sessionTarget returns spec.Session (the `new-window -t` target — creates the
// window IN that session) or "" when Session is empty (CLI path — unscoped, so
// the ambient/attached session is used, byte-identical to pre-session behavior).
func sessionTarget(spec EffectiveSpec) string {
	return spec.Session
}

// windowTarget returns the tmux target for a NAMED window inside spec.Session:
// `<session>:<name>` on the daemon path (so split-window/select-layout operate
// on the correct session's window) or just `<name>` on the CLI path (empty
// Session → unscoped, byte-identical to pre-session behavior).
func windowTarget(spec EffectiveSpec, name string) string {
	if spec.Session == "" {
		return name
	}
	return spec.Session + ":" + name
}

// buildSpawnArgvs returns the ordered tmux argvs (server prefix NOT included —
// tmuxArgv adds it at exec time) for a (worktreePath, resolvedName, spec) triple:
//
//	[0]: new-window (creates the window with pane 0)
//	[1..N-1]: split-window (one per additional pane)
//	[-1]: select-layout (skipped when spec.Layout == "")
//
// On the daemon path (spec.Session != "") new-window carries `-t <session>` so
// the window lands in the requested session, and split-window/select-layout
// target `<session>:<name>`; on the CLI path (empty Session) all targets are
// unscoped (byte-identical to pre-session behavior).
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
// it carries `-t <session>` so the window is created in the requested session;
// on the CLI path (empty Session) the target is unscoped. Pure.
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
