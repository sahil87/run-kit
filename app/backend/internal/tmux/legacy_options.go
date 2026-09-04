package tmux

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
)

// optionScope selects the set-option flag and the carrier enumeration for a
// user option. tmux format expansion resolves #{@foo} by walking
// pane → window → session → global, so a name is legitimate at exactly ONE
// scope (fab/project/context.md § Conventions).
type optionScope int

const (
	scopeServer  optionScope = iota // set-option -s        ; one carrier: the server
	scopeSession                    // set-option -t <ses>: ; carriers: list-sessions
	scopeWindow                     // set-option -w -t @N  ; carriers: list-windows -a
	scopePane                       // set-option -p -t %N  ; carriers: list-panes -a
)

func (s optionScope) String() string {
	switch s {
	case scopeServer:
		return "server"
	case scopeSession:
		return "session"
	case scopeWindow:
		return "window"
	case scopePane:
		return "pane"
	}
	return "unknown"
}

// legacyOption is one migration-table row: a retired option name, its
// scope-named successor ("" = unset-only row), and the ONE scope the name is
// legitimate at. CopyOnly marks a row whose Old must NEVER be unset at its
// right scope during the deprecation window — the copy to New still runs, but
// Old stays: the daemon cannot see which rk version writes hooks on other
// machines, and fab-kit still reads the retired name, so the dual state is
// sanctioned (writers dual-write both). Wrong-scope holds are still purged.
//
// Transform, when non-nil, maps the raw Old value onto the value copied to
// New; ok=false means the value has no representation in the new scheme — no
// copy, but Old is still unset.
type legacyOption struct {
	Old       string
	New       string
	Scope     optionScope
	CopyOnly  bool
	Transform func(string) (string, bool)
}

// legacyOptions is the migration table. A rename or retirement appends a row
// here rather than relying on new writes (fab/project/context.md § Conventions).
var legacyOptions = []legacyOption{
	{Old: "@color", New: ColorOption, Scope: scopeWindow},
	{Old: "@session_color", New: SessionColorOption, Scope: scopeSession},
	// Scope-prefix rename (260828-3o5d): retired unscoped rk names → their
	// win/ses/srv successors. Window rows:
	{Old: legacyTypeOption, New: legacyWinLensOption, Scope: scopeWindow},
	{Old: legacyURLOption, New: legacyWinURLOption, Scope: scopeWindow},
	{Old: "@rk_present_root", New: LegacyWinPresentRootOption, Scope: scopeWindow},
	// Retired web names with no live reader: the lens and present-root migrate
	// forward in one sweep (nothing reads them mid-session). legacyWinURLOption
	// (@rk_win_url) has NO sweep row — the web-tab family dual-READs it as the
	// slot-1 fallback (see parseWindows / ReadWebTabFamily) and it is never
	// unset: unsetting would drop a window's only web state, and the value
	// cannot both hold @rk_win_url (legacy-scope-sweep) and converge to web_1.
	{Old: LegacyWinPresentRootOption, New: WebTabRootOption(1), Scope: scopeWindow},
	{Old: legacyWinLensOption, New: LayoutOption, Scope: scopeWindow, Transform: legacyLensToLayout},
	{Old: "@rk_marker", New: MarkerOption, Scope: scopeWindow},
	{Old: "@rk_flair", New: FlairOption, Scope: scopeWindow},
	{Old: legacyNoteOption, New: NoteOption, Scope: scopeWindow},
	{Old: "@rk_role", New: RoleOption, Scope: scopeWindow},
	// Session rows:
	{Old: "@rk_session_flair", New: SessionFlairOption, Scope: scopeSession},
	{Old: "@rk_board", New: BoardOption, Scope: scopeSession},
	{Old: "@rk_home", New: HomeOption, Scope: scopeSession},
	{Old: "@rk_board_order", New: BoardOrderOption, Scope: scopeSession},
	// Retired with no successor (unset-only): the control anchor is identified
	// by ControlAnchorSessionName instead.
	{Old: "@rk_ctl_keepalive", New: "", Scope: scopeSession},
	// Server rows:
	{Old: "@rk_session_order", New: SessionOrderOption, Scope: scopeServer},
	{Old: "@rk_server_rank", New: ServerRankOption, Scope: scopeServer},
	{Old: "@rk_origin", New: OriginOption, Scope: scopeServer},
	{Old: "@rk_managed", New: ManagedOption, Scope: scopeServer},
	{Old: LegacyEphemeralOption, New: EphemeralOption, Scope: scopeServer},
	{Old: LegacyProtectedOption, New: ProtectedOption, Scope: scopeServer},
	// Pane rows are CopyOnly: `rk agent hook` dual-writes both names and
	// fab-kit still reads the retired one, so the sweep copies forward but
	// never unsets Old at pane scope (wrong-scope strays are still purged).
	{Old: LegacyAgentStateOption, New: AgentStateOption, Scope: scopePane, CopyOnly: true},
	// The agent-session key's retired generations chain forward in table
	// order: a pane holding only "@rk_chat" gains @rk_pane_chat and then
	// @rk_pane_agent_session in one sweep pass (each row re-reads the carrier).
	{Old: "@rk_chat", New: LegacyAgentSessionOption, Scope: scopePane, CopyOnly: true},
	{Old: LegacyAgentSessionOption, New: AgentSessionOption, Scope: scopePane, CopyOnly: true},
}

// scopeTarget is one carrier to inspect: a scope plus the -t argument naming
// the holding entity ("" for the server itself and the global table).
type scopeTarget struct {
	scope  optionScope
	target string // window @N / pane %N / session name / "" (server, global)
	global bool   // the global session-options table (set -g)
}

// MigrateLegacyOptions moves every legacy user option on server to its
// scope-named successor and removes legacy names found at any scope.
// Idempotent — a second run issues zero set-option calls. Per-step logged;
// per-carrier failures log and continue (Constitution II — a failed or
// skipped sweep leaves the server exactly as cold-start would). Returns the
// first error encountered; daemon-path callers ignore it after logging.
func MigrateLegacyOptions(ctx context.Context, server string) error {
	_, err := sweepLegacyOptions(ctx, server)
	return err
}

// MigrateLegacyOptionsReport runs the sweep and reports whether anything
// moved — the CLI adopt path prints only on change.
func MigrateLegacyOptionsReport(ctx context.Context, server string) (bool, error) {
	return sweepLegacyOptions(ctx, server)
}

// sweepLegacyOptions is the shared walk behind MigrateLegacyOptions and the
// once-guard: it reports whether any set/unset was issued.
func sweepLegacyOptions(ctx context.Context, server string) (bool, error) {
	targets, err := enumerateScopeTargets(ctx, server)
	if err != nil {
		return false, err
	}
	return sweepLegacyTargets(ctx, server, targets)
}

// execLegacyTmux runs one tmux command in the sweep under its own TmuxTimeout
// budget: one sweep issues O(carriers) calls, so the budget is per call (a
// large server's legitimate sweep must not share one deadline), never absent
// (a hung socket must not block the caller — several seams pass
// context.Background()).
func execLegacyTmux(ctx context.Context, server string, args ...string) ([]string, error) {
	callCtx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()
	return tmuxExecServer(callCtx, server, args...)
}

// execLegacyTmuxRaw is execLegacyTmux for the raw-output runner.
func execLegacyTmuxRaw(ctx context.Context, server string, args ...string) (string, error) {
	callCtx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()
	return tmuxExecRawServer(callCtx, server, args...)
}

// sweepLegacyTargets runs the migration table over an explicit carrier set —
// split from enumeration so tests can inject a failing carrier and prove the
// remaining carriers are still processed.
func sweepLegacyTargets(ctx context.Context, server string, targets []scopeTarget) (bool, error) {
	changed := false
	var firstErr error
	for _, row := range legacyOptions {
		for _, st := range targets {
			if st.global {
				// The global table is a wrong-scope location for every row.
				c, err := purgeLegacyAt(ctx, server, row, st)
				changed = changed || c
				if err != nil && firstErr == nil {
					firstErr = err
				}
				continue
			}
			var c bool
			var err error
			if st.scope == row.Scope {
				c, err = moveLegacyAt(ctx, server, row, st)
			} else {
				c, err = purgeLegacyAt(ctx, server, row, st)
			}
			changed = changed || c
			if err != nil && firstErr == nil {
				firstErr = err
			}
		}
	}
	return changed, firstErr
}

// legacyLensToLayout maps the retired @rk_win_lens value onto its
// @rk_win_layout successor: only "iframe" has a layout representation
// (layoutspecSingleWeb); any other value is dropped (ok=false — Old is still unset).
func legacyLensToLayout(v string) (string, bool) {
	if v == "iframe" {
		return layoutspecSingleWeb, true
	}
	return "", false
}

// moveLegacyAt performs the right-scope move for one carrier: when Old is
// held at this scope, copy its value to New (only when New is unset there;
// through Transform when the row declares one — a Transform miss copies
// nothing), then unset Old. Old is unset ONLY once New is known to hold a
// value at this scope — already held, or the copy just succeeded — so a
// failed copy never deletes the sole source of truth; the row is retried on
// the next sweep. A CopyOnly row skips the unset entirely: the dual state
// (Old + New held) is sanctioned during the deprecation window, so a carrier
// already holding both issues nothing. Reports whether a set/unset was issued.
func moveLegacyAt(ctx context.Context, server string, row legacyOption, st scopeTarget) (bool, error) {
	held, err := heldOptions(ctx, server, st)
	if err != nil {
		slog.Warn("legacy option sweep: read failed", "server", server, "option", row.Old, "scope", st.scope, "target", st.target, "error", err)
		return false, err
	}
	if _, ok := held[row.Old]; !ok {
		return false, nil
	}
	changed := false
	if row.New != "" {
		if _, newHeld := held[row.New]; !newHeld {
			// The enumeration value is shell-quoted display text; copy the
			// raw value so JSON/spaced values do not gain literal quotes.
			oldVal, err := rawOptionAt(ctx, server, st, row.Old)
			if err != nil {
				slog.Warn("legacy option sweep: value read failed, legacy option kept", "server", server, "option", row.Old, "scope", st.scope, "target", st.target, "error", err)
				return false, err
			}
			newVal, copy := oldVal, true
			if row.Transform != nil {
				newVal, copy = row.Transform(oldVal)
			}
			if copy {
				if err := setOptionAt(ctx, server, st, row.New, newVal); err != nil {
					slog.Warn("legacy option sweep: set failed, legacy option kept", "server", server, "option", row.New, "scope", st.scope, "target", st.target, "error", err)
					return false, err
				}
				slog.Info("legacy option sweep: migrated", "server", server, "option", row.Old, "to", row.New, "scope", st.scope, "target", st.target)
				changed = true
			}
		}
	}
	if row.CopyOnly {
		return changed, nil
	}
	if err := unsetOptionAt(ctx, server, st, row.Old); err != nil {
		slog.Warn("legacy option sweep: unset failed", "server", server, "option", row.Old, "scope", st.scope, "target", st.target, "error", err)
		return changed, err
	}
	slog.Info("legacy option sweep: unset", "server", server, "option", row.Old, "scope", st.scope, "target", st.target)
	return true, nil
}

// purgeLegacyAt unsets Old where it is held at a wrong scope. Values are
// never copied forward from a wrong scope — a session-level @color was never
// a legitimate window color.
func purgeLegacyAt(ctx context.Context, server string, row legacyOption, st scopeTarget) (bool, error) {
	held, err := heldOptions(ctx, server, st)
	if err != nil {
		slog.Warn("legacy option sweep: read failed", "server", server, "option", row.Old, "scope", st.scope, "target", st.target, "global", st.global, "error", err)
		return false, err
	}
	if _, ok := held[row.Old]; !ok {
		return false, nil
	}
	if err := unsetOptionAt(ctx, server, st, row.Old); err != nil {
		slog.Warn("legacy option sweep: unset failed", "server", server, "option", row.Old, "scope", st.scope, "target", st.target, "global", st.global, "error", err)
		return false, err
	}
	slog.Info("legacy option sweep: purged wrong-scope", "server", server, "option", row.Old, "scope", st.scope, "target", st.target, "global", st.global)
	return true, nil
}

// enumerateScopeTargets lists every carrier on the server: the server itself,
// the global table, every session, every window, every pane.
func enumerateScopeTargets(ctx context.Context, server string) ([]scopeTarget, error) {
	targets := []scopeTarget{
		{scope: scopeServer},
		{scope: scopeSession, global: true},
	}
	sessions, err := execLegacyTmux(ctx, server, "list-sessions", "-F", "#{session_name}")
	if err != nil {
		return nil, fmt.Errorf("list sessions on %s: %w", server, err)
	}
	for _, name := range sessions {
		targets = append(targets, scopeTarget{scope: scopeSession, target: name})
	}
	windows, err := execLegacyTmux(ctx, server, "list-windows", "-a", "-F", "#{window_id}")
	if err != nil {
		return nil, fmt.Errorf("list windows on %s: %w", server, err)
	}
	for _, id := range windows {
		targets = append(targets, scopeTarget{scope: scopeWindow, target: id})
	}
	panes, err := execLegacyTmux(ctx, server, "list-panes", "-a", "-F", "#{pane_id}")
	if err != nil {
		return nil, fmt.Errorf("list panes on %s: %w", server, err)
	}
	for _, id := range panes {
		targets = append(targets, scopeTarget{scope: scopePane, target: id})
	}
	return targets, nil
}

// heldOptions returns the user options held at exactly this carrier's scope —
// show-options without -A reports only what the scope's own table holds,
// never inherited values (the enumeration format cannot distinguish held from
// inherited). Output lines are "name value" where value is tmux's
// shell-quoted DISPLAY form ('["a"]', "has space"): use it for presence only
// and read the raw value through rawOptionAt before copying it anywhere.
func heldOptions(ctx context.Context, server string, st scopeTarget) (map[string]string, error) {
	args := showOptionsArgs(st)
	lines, err := execLegacyTmux(ctx, server, args...)
	if err != nil {
		return nil, err
	}
	held := make(map[string]string, len(lines))
	for _, line := range lines {
		name, value, _ := strings.Cut(line, " ")
		if strings.HasPrefix(name, "@") {
			held[name] = value
		}
	}
	return held, nil
}

// rawOptionAt reads one option's raw (unquoted) value at exactly st's scope
// via show-options -qv — the -v form prints the value verbatim, unlike the
// quoted enumeration heldOptions parses.
func rawOptionAt(ctx context.Context, server string, st scopeTarget, option string) (string, error) {
	args := showOptionsArgs(st)
	args = append(args, "-qv", option)
	out, err := execLegacyTmuxRaw(ctx, server, args...)
	if err != nil {
		return "", err
	}
	return strings.TrimSuffix(out, "\n"), nil
}

// showOptionsArgs builds the show-options argv selecting exactly st's table.
func showOptionsArgs(st scopeTarget) []string {
	args := []string{"show-options"}
	switch {
	case st.global:
		args = append(args, "-g")
	case st.scope == scopeServer:
		args = append(args, "-s")
	case st.scope == scopeWindow:
		args = append(args, "-w", "-t", st.target)
	case st.scope == scopePane:
		args = append(args, "-p", "-t", st.target)
	case st.scope == scopeSession:
		// Exact-match =name: form — a bare -t <session> is a window target.
		args = append(args, "-t", ExactSessionTarget(st.target))
	}
	return args
}

// setOptionAt writes option=value at exactly st's scope.
func setOptionAt(ctx context.Context, server string, st scopeTarget, option, value string) error {
	args := setOptionArgs(st)
	args = append(args, option, value)
	_, err := execLegacyTmuxRaw(ctx, server, args...)
	return err
}

// unsetOptionAt removes option from exactly st's scope.
func unsetOptionAt(ctx context.Context, server string, st scopeTarget, option string) error {
	args := setOptionArgs(st)
	args = append(args, "-u", option)
	_, err := execLegacyTmuxRaw(ctx, server, args...)
	return err
}

// setOptionArgs builds the set-option argv selecting exactly st's table.
func setOptionArgs(st scopeTarget) []string {
	args := []string{"set-option"}
	switch {
	case st.global:
		args = append(args, "-g")
	case st.scope == scopeServer:
		args = append(args, "-s")
	case st.scope == scopeWindow:
		args = append(args, "-w", "-t", st.target)
	case st.scope == scopePane:
		args = append(args, "-p", "-t", st.target)
	case st.scope == scopeSession:
		args = append(args, "-t", ExactSessionTarget(st.target))
	}
	return args
}

// CountLegacyOptions reports how many legacy option names are still held at
// any scope on the server — the diagnostic sibling of MigrateLegacyOptions
// (rk doctor), sharing the table and the scope walk. A CopyOnly row's Old
// held at its RIGHT scope is not counted: the dual state is sanctioned during
// the deprecation window (the writer dual-writes both), so counting it would
// keep every instrumented server permanently dirty. A CopyOnly Old held at a
// wrong scope still counts (a stray the sweep will purge).
func CountLegacyOptions(ctx context.Context, server string) (int, error) {
	targets, err := enumerateScopeTargets(ctx, server)
	if err != nil {
		return 0, err
	}
	count := 0
	for _, st := range targets {
		held, err := heldOptions(ctx, server, st)
		if err != nil {
			return 0, err
		}
		for _, row := range legacyOptions {
			if _, ok := held[row.Old]; !ok {
				continue
			}
			if row.CopyOnly && !st.global && st.scope == row.Scope {
				continue
			}
			count++
		}
	}
	return count, nil
}

// legacyMigrated records servers already swept this daemon lifetime —
// in-memory only (Constitution II); a daemon restart re-sweeps (idempotent).
var legacyMigrated sync.Map

// MigrateLegacyOptionsOnce runs the sweep at most once per server per
// process, marking on ATTEMPT (a failing server is not re-swept on every
// attach — rk mux adopt and daemon restart are the explicit retry paths).
// Reports whether the sweep changed anything so callers can wake the SSE hub
// selectively.
func MigrateLegacyOptionsOnce(ctx context.Context, server string) (bool, error) {
	if !MarkLegacyMigrationAttempt(server) {
		return false, nil
	}
	return sweepLegacyOptions(ctx, server)
}

// MarkLegacyMigrationAttempt takes the once-guard for server, reporting
// whether the caller is the first (and only) winner. The mark lands on
// ATTEMPT, before any sweep work — a failing server is not re-swept on every
// attach. The guard is atomic (LoadOrStore), so callers may take it from
// their own goroutine as long as at most one such goroutine can exist per
// server (the relay's per-server attach-reload guard provides that).
func MarkLegacyMigrationAttempt(server string) bool {
	_, loaded := legacyMigrated.LoadOrStore(server, struct{}{})
	return !loaded
}

// ResetLegacyMigrationForTest clears the once-guard so tests can re-run the
// sweep for a server within one process. Clears keys rather than reassigning
// the map: a test's cleanup may overlap an in-flight reload goroutine still
// holding the same sync.Map, and a reassignment is a plain racy write.
func ResetLegacyMigrationForTest() {
	legacyMigrated.Clear()
}
