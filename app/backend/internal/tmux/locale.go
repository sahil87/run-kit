package tmux

import (
	"context"
	"os"
	"strings"
	"sync"
)

// localeVars is tmux's precedence order for its client UTF-8 decision: the
// FIRST of these with a NON-EMPTY value is the only one consulted (an empty
// value is skipped exactly like an unset one), and that value must contain
// "UTF-8" or "UTF8" (case-insensitive). tmux string-matches the variable
// rather than probing setlocale, so LC_ALL=C defeats a UTF-8 LANG while
// LC_ALL= (empty) beside a UTF-8 LANG is healthy, and C.UTF-8 satisfies the
// rule whether or not the host has that locale installed. A client that fails
// the rule receives sanitized output: tmux ≥ 3.7 rewrites C0 characters,
// including the tab listDelim, to '_'.
var localeVars = [3]string{"LC_ALL", "LC_CTYPE", "LANG"}

// utf8Locale is the only value rk ever writes into the environment. It is the
// one UTF-8 locale name present on macOS, glibc ≥ 2.35, and Debian/Ubuntu; a
// name derived from the existing value (en_US → en_US.UTF-8) may not exist on
// the host, which tmux would not notice but Python and other children would.
const utf8Locale = "C.UTF-8"

// LocaleStatus applies tmux's client rule to an environment read through
// lookup (the os.LookupEnv shape): name and value are the first variable of
// localeVars with a non-empty value ("" when there is none) and utf8 reports
// whether that value names a UTF-8 codeset.
func LocaleStatus(lookup func(string) (string, bool)) (name, value string, utf8 bool) {
	for _, n := range localeVars {
		if v, ok := lookup(n); ok && v != "" {
			return n, v, isUTF8Locale(v)
		}
	}
	return "", "", false
}

func isUTF8Locale(v string) bool {
	u := strings.ToUpper(v)
	return strings.Contains(u, "UTF-8") || strings.Contains(u, "UTF8")
}

// utf8LocaleFix returns the single assignment that makes tmux treat this
// process as a UTF-8 client, or ok=false when the environment already does.
// A non-UTF-8, non-empty LC_ALL or LC_CTYPE is overridden in place: LC_ALL
// outranks the other two, so no other variable can satisfy the rule while it
// carries a value. A non-UTF-8 LANG is left as is and LC_CTYPE set beside it —
// LANG is the lowest rung, so the new LC_CTYPE wins the precedence with the
// narrowest edit; the same holds when no variable carries a value at all.
func utf8LocaleFix(lookup func(string) (string, bool)) (name, value string, ok bool) {
	first, _, utf8 := LocaleStatus(lookup)
	if utf8 {
		return "", "", false
	}
	switch first {
	case "LC_ALL", "LC_CTYPE":
		return first, utf8Locale, true
	default:
		return "LC_CTYPE", utf8Locale, true
	}
}

var (
	forcedMu    sync.Mutex
	forcedName  string
	forcedValue string
	forcedOK    bool
)

// EnsureUTF8Locale repairs the process environment so that every tmux client
// rk spawns — and every tmux server rk births, whose global environment is a
// copy of rk's — passes tmux's UTF-8 rule. It runs once at startup, before any
// subcommand can fork; a GUI- or service-launched rk (Electron, launchd,
// systemd, cron, an MCP host) commonly has no LANG at all. Idempotent: a later
// call sees the repaired value and changes nothing, so the record of what was
// forced survives for ForcedLocale.
func EnsureUTF8Locale() {
	name, value, ok := utf8LocaleFix(os.LookupEnv)
	if !ok {
		return
	}
	if err := os.Setenv(name, value); err != nil {
		return
	}
	forcedMu.Lock()
	forcedName, forcedValue, forcedOK = name, value, true
	forcedMu.Unlock()
}

// applyUTF8Locale is the slice form of EnsureUTF8Locale, for an environment rk
// hands a child explicitly rather than inheriting — a born server's global
// env after sanitizeEnv, whose direnv-diff reversal can remove a locale
// variable direnv had set or restore a non-UTF-8 one. Returns env unchanged
// when it already passes tmux's rule; otherwise replaces the chosen variable's
// entry (or appends one) with the C.UTF-8 assignment.
func applyUTF8Locale(env []string) []string {
	lookup := func(key string) (string, bool) {
		for _, entry := range env {
			if name, value, ok := strings.Cut(entry, "="); ok && name == key {
				return value, true
			}
		}
		return "", false
	}
	name, value, ok := utf8LocaleFix(lookup)
	if !ok {
		return env
	}
	out := make([]string, 0, len(env)+1)
	for _, entry := range env {
		if n, _, _ := strings.Cut(entry, "="); n == name {
			continue
		}
		out = append(out, entry)
	}
	return append(out, name+"="+value)
}

// ForcedLocale reports the assignment EnsureUTF8Locale made in this process,
// or ok=false when the environment already carried a UTF-8 locale. After the
// repair the environment itself no longer shows that the host lacked one, so
// this record is the only evidence doctor can report.
func ForcedLocale() (name, value string, ok bool) {
	forcedMu.Lock()
	defer forcedMu.Unlock()
	return forcedName, forcedValue, forcedOK
}

// ServerGlobalEnv returns a tmux server's global environment
// (`show-environment -g`) as NAME→value. tmux prints an unset marker as
// `-NAME`; those lines are skipped. Returns nil, nil when the server is not
// running — show-environment never births a server, so probing a dead socket
// is safe. Self-bounded by TmuxTimeout like the package's other read paths.
func ServerGlobalEnv(ctx context.Context, server string) (map[string]string, error) {
	ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()

	lines, err := tmuxExecServer(ctx, server, "show-environment", "-g")
	if err != nil {
		if containsServerGoneText(err.Error()) {
			return nil, nil
		}
		return nil, err
	}
	return parseShowEnvironment(lines), nil
}

func parseShowEnvironment(lines []string) map[string]string {
	env := make(map[string]string, len(lines))
	for _, line := range lines {
		if strings.HasPrefix(line, "-") {
			continue
		}
		name, value, ok := strings.Cut(line, "=")
		if !ok || name == "" {
			continue
		}
		env[name] = value
	}
	return env
}
