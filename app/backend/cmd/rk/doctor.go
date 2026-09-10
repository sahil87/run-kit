package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"rk/internal/codebridge"
	"rk/internal/codeserver"
	"rk/internal/config"
	"rk/internal/cron"
	"rk/internal/daemon"
	"rk/internal/gui"
	"rk/internal/settings"
	"rk/internal/tmux"

	"github.com/spf13/cobra"
)

// doctorJSON requests machine-readable output on stdout. Principle 2 names
// `doctor` as a --json carrier; the structured result goes to stdout (data)
// while the human diagnostic remains on stderr.
var doctorJSON bool

// tmuxVersionProbe is the seam for the PATH tmux version probe, shared by the
// doctor tmux row and the serve-startup warning — tests substitute it to
// drive the below-floor / unknown branches without a real tmux.
var tmuxVersionProbe = tmux.CurrentVersion

// tmuxServerList / tmuxServerVersionProbe are the seams for the drift sweep
// (live-server enumeration + per-server version probe) — tests substitute
// them to drive every drift branch without live tmux servers.
var (
	tmuxServerList         = tmux.ListServers
	tmuxServerVersionProbe = tmux.ServerVersion
)

// ephemeralServersList is the seam for the ephemeral-servers check — tests
// substitute it to drive the nonzero/zero/enumeration-error branches without
// live tmux servers.
var ephemeralServersList = tmux.EphemeralServers

// doctorCheck is one dependency check in the --json report. `ok` is the pass
// flag; `hint` carries the remediation string on failure (empty when ok);
// `note` carries informational state on a passing check (e.g. an optional
// artifact reported as not installed).
type doctorCheck struct {
	Name string `json:"name"`
	OK   bool   `json:"ok"`
	Hint string `json:"hint,omitempty"`
	Note string `json:"note,omitempty"`
	// failLabel overrides the human [FAIL] row's default "<name> not found"
	// lead-in for checks whose failures are not absences (the shim check fails
	// on mis-wiring, not on a missing binary). Unexported on purpose: it is
	// human rendering only and never appears in --json.
	failLabel string
}

// doctorReport is the top-level --json document. `ok` is the overall verdict:
// worst-check-wins — false when any check failed (Principle 4 aggregation rule).
type doctorReport struct {
	OK     bool          `json:"ok"`
	Checks []doctorCheck `json:"checks"`
}

// runDoctorChecks performs every dependency check and returns the structured
// report. It is pure of any output stream so both the human and JSON renderers
// consume the same result — the single source of truth for the verdict.
func runDoctorChecks() doctorReport {
	report := doctorReport{OK: true}

	if _, err := exec.LookPath("tmux"); err != nil {
		report.Checks = append(report.Checks, doctorCheck{Name: "tmux", OK: false, Hint: tmux.InstallHint(runtime.GOOS, exec.LookPath)})
		report.OK = false
	} else {
		report.Checks = append(report.Checks, tmuxVersionCheck())
	}

	if home, err := os.UserHomeDir(); err == nil {
		c := tmuxGuardShimCheck(home, os.Getenv("PATH"), exec.LookPath)
		report.Checks = append(report.Checks, c)
		if !c.OK {
			report.OK = false
		}
	}

	// code-server (260811-a2bo) — the daemon-managed editor behind /code/.
	// Always WARN-shaped (OK with a note), never a FAIL: an absent or
	// not-yet-started editor must not fail doctor — daemon start itself only
	// warns and continues (internal/daemon ensureCodeServer). home may be ""
	// when unresolvable — the managed-install rung is then skipped.
	home, _ := os.UserHomeDir()
	report.Checks = append(report.Checks, codeServerCheck(home, exec.LookPath, dialTCP))

	// code bridge — the rk-code-bridge extension behind `rk code exec`,
	// installed by `rk code-server install`/`update`. Always OK-shaped (the
	// code-server posture): absence is a note, never a verdict flipper.
	report.Checks = append(report.Checks, codeBridgeCheck(codeserver.ExtensionsDir(home), codeBridgeEmbeddedVersion(), codeBridgeLiveHostCount))

	// gui — the host desktop surface (the rk-gui session + RFB relay).
	// Always OK-shaped: off is the default and not-running is a state, never
	// a dependency failure. See guiDoctorCheck.
	report.Checks = append(report.Checks, guiDoctorCheck())

	// Ephemeral servers — informational hygiene count, always OK-shaped (the
	// code-server/drift posture): scratch servers are deliberate creator
	// opt-in, never a dependency failure.
	report.Checks = append(report.Checks, ephemeralServersCheck())

	// Agent hooks — the rk-owned settings.json hook entries' install state:
	// stale generations still write the retired option names, and a gen-3 hook
	// whose embedded rk path dangles writes nothing at all.
	if home != "" {
		c := agentHooksCheck(home, os.ReadFile, os.Stat)
		report.Checks = append(report.Checks, c)
		if !c.OK {
			report.OK = false
		}
	}

	// Legacy tmux options — informational count of live servers still carrying
	// the pre-scope-named option keys, always OK-shaped: the attach/adopt-time
	// sweep is the healer, doctor only reports.
	report.Checks = append(report.Checks, legacyOptionsCheck())

	// tmux config — the managed-conf ownership/drift row, always OK-shaped
	// (informational only: remediation is the note's recipe, never a failure).
	report.Checks = append(report.Checks, tmuxConfigCheck())

	// Cron ticker — configuration + disk facts only (the setting state and
	// the cron state dir's resolvability), always OK-shaped: doctor runs in a
	// separate process from the daemon, so live goroutine state is not
	// reportable and nothing here may fail the report.
	report.Checks = append(report.Checks, cronTickerCheck())

	// Set-but-ignored env vars: RK_SSH_HOST no longer has any reader (the
	// ssh_host setting is the only source), so a row appears ONLY when it is
	// set — steady-state output stays noise-free.
	if c, ok := removedEnvCheck(); ok {
		report.Checks = append(report.Checks, c)
		if !c.OK {
			report.OK = false
		}
	}

	return report
}

// cronTickerCheck reports the cron ticker's configuration facts: the
// cron_ticker setting state and the cron state dir's resolvability/path.
// Always OK-shaped (the ephemeral/tmux-config posture) — informational only,
// never a verdict flipper.
func cronTickerCheck() doctorCheck {
	check := doctorCheck{Name: "cron ticker", OK: true}
	state := "on"
	if !settings.Load().CronTicker {
		state = "off"
	}
	dir, err := cron.DefaultDir()
	if err != nil {
		check.Note = fmt.Sprintf("cron_ticker %s; state dir unresolvable: %v", state, err)
		return check
	}
	check.Note = fmt.Sprintf("cron_ticker %s; state dir %s", state, dir)
	return check
}

// removedEnvCheck flags a set-but-ignored RK_SSH_HOST: the env read was
// removed (the ssh_host key in ~/.config/run-kit/config.yaml is the only
// ssh-host source), so a still-exported value silently does nothing. The
// second return value is false when the var is unset — no row, no noise.
func removedEnvCheck() (doctorCheck, bool) {
	if os.Getenv("RK_SSH_HOST") == "" {
		return doctorCheck{}, false
	}
	return doctorCheck{
		Name:      "RK_SSH_HOST",
		OK:        false,
		Hint:      "RK_SSH_HOST is no longer read — set the ssh_host key in ~/.config/run-kit/config.yaml",
		failLabel: "RK_SSH_HOST set but ignored",
	}, true
}

// ephemeralServersCheck reports the count of live servers carrying the
// @rk_ephemeral mark with the reap remediation hint. Always OK — the row is
// informational and must never flip the overall verdict. The enumeration
// rides the reaper's own semantics via tmux.EphemeralServers (live-only,
// _rk-ctl/rk-daemon hard-skipped, per-server failures isolated); an
// enumeration error degrades to an OK row naming the skip rather than
// blocking or failing doctor (the drift sweep's never-block posture).
func ephemeralServersCheck() doctorCheck {
	check := doctorCheck{Name: "ephemeral servers", OK: true}
	ctx, cancel := context.WithTimeout(context.Background(), tmux.TmuxTimeout)
	defer cancel()
	marked, err := ephemeralServersList(ctx)
	if err != nil {
		check.Note = fmt.Sprintf("skipped — enumeration failed: %v", err)
		return check
	}
	if len(marked) == 0 {
		check.Note = "none"
		return check
	}
	check.Note = fmt.Sprintf("%d live server(s) marked %s — sweep with `rk mux reap --ephemeral`", len(marked), tmux.EphemeralOption)
	return check
}

// legacyOptionsScanResult is one live server's legacy-option tally: how many
// pre-scope-named option keys it still holds at any scope, and whether rk
// manages it (the daemon sweep never touches an unmanaged server).
type legacyOptionsScanResult struct {
	Server  string
	Count   int
	Managed bool
}

// legacyOptionsScan is the seam for the legacy-options row — tests substitute
// it to drive every note shape without live tmux servers. The default
// enumerates only live servers via ListServers (a tmux command on a dead
// socket resurrects a server) and shares the migrator's table and scope walk
// via CountLegacyOptions.
var legacyOptionsScan = func(ctx context.Context) ([]legacyOptionsScanResult, error) {
	servers, err := tmux.ListServers(ctx)
	if err != nil {
		return nil, err
	}
	results := make([]legacyOptionsScanResult, 0, len(servers))
	for _, server := range servers {
		count, err := tmux.CountLegacyOptions(ctx, server)
		if err != nil {
			// One failing server (socket died mid-scan) must not abort the
			// whole row — count the rest (the per-carrier sweep posture).
			slog.Debug("legacy options scan: skipping server", "server", server, "err", err)
			continue
		}
		managed, err := tmux.IsManagedServer(ctx, server)
		if err != nil {
			slog.Debug("legacy options scan: managed check failed; skipping server", "server", server, "err", err)
			continue
		}
		results = append(results, legacyOptionsScanResult{Server: server, Count: count, Managed: managed})
	}
	return results, nil
}

// legacyOptionsCheck reports how many live servers still carry legacy option
// names (@color/@session_color) at any scope. Always OK-shaped (the
// ephemeral-servers posture — informational, never a verdict flipper):
// remediation is the attach/adopt-time sweep named in the note, never doctor
// itself (doctor diagnoses, it never migrates). External servers are counted
// with a distinct phrasing because the daemon will never heal those. An
// enumeration failure degrades to an OK row naming the skip.
func legacyOptionsCheck() doctorCheck {
	check := doctorCheck{Name: "legacy tmux options", OK: true}
	ctx, cancel := context.WithTimeout(context.Background(), tmux.TmuxTimeout)
	defer cancel()
	results, err := legacyOptionsScan(ctx)
	if err != nil {
		check.Note = fmt.Sprintf("skipped — enumeration failed: %v", err)
		return check
	}
	dirty, external := 0, 0
	for _, r := range results {
		if r.Count > 0 {
			dirty++
			if !r.Managed {
				external++
			}
		}
	}
	if dirty == 0 {
		check.Note = "none"
		return check
	}
	check.Note = fmt.Sprintf("%d server(s) still carry legacy option names (@color/@session_color) — attach from the dashboard or run `rk mux adopt <server>` to sweep", dirty)
	if external > 0 {
		check.Note += fmt.Sprintf(", of which %d external — rk will not rewrite those", external)
	}
	return check
}

// tmuxVersionCheck is the passing tmux row, enriched with the probed version:
// the plain version at/above the floor, the shared below-floor message below
// it (WARN-shaped — the row stays OK, mirroring the code-server precedent;
// doctor is the detail view, not the enforcement point), and no note for an
// unknown version (never block on a parse). When the binary version is known,
// drift sentences for running servers still executing an older version are
// appended (see tmuxDriftNotes). --json carries the note verbatim.
func tmuxVersionCheck() doctorCheck {
	check := doctorCheck{Name: "tmux", OK: true}
	ctx, cancel := context.WithTimeout(context.Background(), tmux.TmuxTimeout)
	defer cancel()
	v, ok := tmuxVersionProbe(ctx)
	if !ok {
		return check
	}
	if v.BelowFloor() {
		check.Note = tmux.UpgradeHint(runtime.GOOS, exec.LookPath, v.Raw)
	} else {
		check.Note = v.Raw
	}
	check.Note = strings.Join(append([]string{check.Note}, tmuxDriftNotes(v)...), "; ")
	return check
}

// tmuxDriftNotes sweeps the live tmux servers and returns one drift sentence
// per server still executing a version strictly older than the on-disk binary
// — an upgrade replaces the binary but never the running servers, and that
// latency is invisible without this note. Informational only, doctor-only,
// and never a restart (Constitution VI: the timing is the user's call — the
// sentence names the cost). Only servers ListServers confirmed live are
// probed (a tmux command on a dead socket can resurrect a server); every
// failure — enumeration error, unknown server version — degrades to a silent
// skip, so drift can never fail or block the row.
func tmuxDriftNotes(binary tmux.Version) []string {
	ctx, cancel := context.WithTimeout(context.Background(), tmux.TmuxTimeout)
	defer cancel()
	servers, err := tmuxServerList(ctx)
	if err != nil {
		return nil
	}
	var notes []string
	for _, server := range servers {
		probeCtx, probeCancel := context.WithTimeout(context.Background(), tmux.TmuxTimeout)
		sv, ok := tmuxServerVersionProbe(probeCtx, server)
		probeCancel()
		if !ok || !sv.OlderThan(binary) {
			continue
		}
		notes = append(notes, fmt.Sprintf("tmux %s installed but running server %q is %s — restart your tmux server when convenient to pick it up (kills its sessions; pick a quiet moment)", binary.Raw, server, sv.Raw))
	}
	return notes
}

// tmuxConfigClassify is the seam for the managed-conf classifier — tests
// substitute it to drive every tmux config row state without fixture files.
var tmuxConfigClassify = tmux.ClassifyConfigFile

// tmuxUserOwnedPath is the seam for the user-owned resolution fact — tests
// substitute it to drive the tmux_conf-set branch.
var tmuxUserOwnedPath = tmux.UserOwnedConfigPath

// tmuxConfigCheck reports the managed tmux.conf's ownership/drift state.
// Always OK-shaped (the ephemeral/drift posture — the row is informational and
// must never flip the overall verdict); the note carries the state and, for
// drifted files, the migration recipe. Read-only: doctor diagnoses, it never
// migrates. When tmux_conf/RK_TMUX_CONF points rk at a user path, rk performs
// no ensure/refresh on it (settings.TmuxConf documents "you own everything"),
// so the row reports user-owned and skips drift analysis. Refresh notes carry
// the pane-creation caveat: history-limit-class options apply only to panes
// created after reload.
func tmuxConfigCheck() doctorCheck {
	check := doctorCheck{Name: "tmux config", OK: true}
	recipe := "move your customizations into ~/.config/run-kit/tmux.d/user.conf, then run `rk mux init-conf --force` to restore the managed file"
	if tmuxUserOwnedPath() {
		check.Note = "user-owned (tmux_conf set) — unmanaged"
		return check
	}
	// No resolvable home dir at init leaves DefaultConfigPath empty — there is
	// no managed path to classify, so report the skip instead of feeding "" to
	// the classifier (whose read error would render as a confusing
	// "state unreadable" note).
	if tmux.DefaultConfigPath == "" {
		check.Note = "skipped — home directory not resolvable, no managed path"
		return check
	}
	// A legacy ~/.rk/tmux.conf the migration deliberately left behind (not
	// byte-equal to the embed, so possibly hand-edited) outranks the new
	// path's state: its content is the one at risk of being forgotten.
	if home, err := os.UserHomeDir(); err == nil {
		legacy := filepath.Join(home, ".rk", "tmux.conf")
		if _, err := os.Stat(legacy); err == nil {
			check.Note = fmt.Sprintf("old config still at %s — %s", legacy, recipe)
			return check
		}
	}
	state, err := tmuxConfigClassify(tmux.DefaultConfigPath)
	if err != nil {
		check.Note = fmt.Sprintf("state unreadable: %v", err)
		return check
	}
	switch state {
	case tmux.ConfManagedCurrent:
		check.Note = "managed, current"
	case tmux.ConfManagedStale:
		check.Note = "managed, stale — refreshes on next daemon start (history-limit-class options apply only to panes created after the reload)"
	case tmux.ConfMissing:
		check.Note = "not written yet — scaffolds on next daemon start or via `rk mux init-conf`"
	default: // hand-edited
		check.Note = "hand-edited — rk leaves it untouched; " + recipe
	}
	return check
}

// guiCheck reports the GUI surface's state: off (the default), on+reachable
// with the resolved backend/display/geometry/viewer count/window manager and
// the resolution pin (a bare display appends the install hint — doctor is the
// diagnostic surface; 'rk gui status' keeps the bare 'no window manager'), or
// on+not-running with the fixed reason set (gui.NotRunningReason owns the
// strings). Always OK-shaped — the code-server posture: a missing or down
// desktop is a note, never a verdict flipper. Pure over the injected inputs
// so tests never touch tmux, the probe, or PATH.
func guiCheck(enabled, session bool, display, backend, wm string, probe gui.Info, viewers int, locked bool, lookPath func(string) (string, error)) doctorCheck {
	check := doctorCheck{Name: "gui", OK: true}
	if !enabled {
		check.Note = "off"
		return check
	}
	if probe.Reachable {
		bin := backend
		if bin == "" {
			bin, _ = gui.ResolveBackend(lookPath)
		}
		if wm == "" {
			wm = "no window manager"
			// Empty off Linux — the darwin mirror runs no WM, so no hint.
			if hint := gui.WMInstallHint(lookPath); hint != "" {
				wm += " — " + hint
			}
		}
		check.Note = guiOnSummary(bin, display, probe.Width, probe.Height, viewers, wm, locked)
		return check
	}
	check.Note = "on — not running (" + gui.NotRunningReason(session, backend, lookPath) + ")"
	return check
}

// guiDoctorCheck gathers the live facts for the gui row. Every tmux read is
// gated on the daemon running — a has-session probe on a dead rk-daemon
// socket would birth a tmux server; with the daemon down the row reads as
// session-absent.
func guiDoctorCheck() doctorCheck {
	if !settings.Load().GUIEnabled {
		return guiCheck(false, false, "", "", "", gui.Info{}, 0, false, guiLookPathFn)
	}
	if !guiDaemonRunningFn() {
		return guiCheck(true, false, "", "", "", gui.Info{}, 0, false, guiLookPathFn)
	}
	ctx, cancel := context.WithTimeout(context.Background(), tmux.TmuxTimeout)
	defer cancel()
	session := guiSessionExistsFn(ctx)
	display, backend, wm := "", "", ""
	locked := false
	if session {
		display, backend, wm, _ = guiSessionOptionsFn(ctx)
		locked = guiLockedFn(ctx)
	}
	var info gui.Info
	if session {
		if network, addr, err := gui.BackendAddr(daemon.GUIWindowName); err == nil {
			info, _ = guiProbeFn(ctx, network, addr)
		}
	}
	return guiCheck(true, session, display, backend, wm, info, guiViewersFn(), locked, guiLookPathFn)
}

// dialTCP is the production reachability probe for the code-server doctor row:
// a bare TCP dial of 127.0.0.1:{port}, mirroring the SSE hub's probe shape.
func dialTCP(addr string) bool {
	conn, err := net.DialTimeout("tcp", addr, 400*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

// codeServerCheck reports the daemon-managed code-server's state: install
// source (rk-managed under ~/.rk/code-server-bin, else a user-managed PATH
// install), the resolved port (preset RK_CODE_SERVER_PORT, else RK_PORT+2),
// and reachability. Pure over an injected (home, lookPath, dial) triple so
// tests never depend on the host. Never OK=false — absence is the WARN case
// (the daemon warns and continues without it, spawning the install job), so
// the row carries a remediation Note.
func codeServerCheck(home string, lookPath func(string) (string, error), dial func(string) bool) doctorCheck {
	port := config.Load().ResolvedCodeServerPort()
	check := doctorCheck{Name: "code-server", OK: true}
	// A degenerate config (RK_PORT whose +2 leaves 1-65535, no valid override)
	// resolves to 0 — the feature is off, so report that rather than probing
	// the meaningless 127.0.0.1:0. Mirrors the /code route's 503 branch.
	if port == 0 {
		check.Note = "port not resolvable — RK_PORT+2 falls outside 1-65535 and no valid RK_CODE_SERVER_PORT is set, so /code/ is off (lower RK_PORT or set RK_CODE_SERVER_PORT)"
		return check
	}
	reachability := func() string {
		if dial(fmt.Sprintf("127.0.0.1:%d", port)) {
			return fmt.Sprintf("reachable on 127.0.0.1:%d", port)
		}
		return fmt.Sprintf("not currently reachable on 127.0.0.1:%d (the daemon starts it on `rk daemon start`)", port)
	}
	// The managed rung mirrors the daemon's resolution ladder: the rk-owned
	// install wins over a PATH install when both exist.
	if home != "" {
		if managed := codeserver.ManagedBinary(home); managed != "" {
			version, err := codeserver.InstalledVersion(home)
			if err != nil || version == "" {
				version = "unknown"
			}
			check.Note = fmt.Sprintf("managed v%s; %s", version, reachability())
			return check
		}
	}
	if _, err := lookPath("code-server"); err != nil {
		check.Note = fmt.Sprintf("not installed — the daemon-managed editor behind /code/ is unavailable (resolved port :%d; the daemon installs it automatically on start, or run `rk code-server install`)", port)
		return check
	}
	check.Note = "installed (PATH); " + reachability()
	return check
}

// codeBridgeEmbeddedVersion / codeBridgeLiveHostCount are the seams for the
// code bridge row's production inputs — tests substitute them so
// runDoctorChecks never touches the real embed dir or state dir. The version
// is "" when the build carries no VSIX (a dev build — the row then omits the
// bundled-is-newer clause); the host count is the same liveness-pruning
// enumeration `rk code hosts` performs.
var codeBridgeEmbeddedVersion = func() string {
	_, version, ok := codebridge.Embedded()
	if !ok {
		return ""
	}
	return version
}
var codeBridgeLiveHostCount = func() (int, error) {
	dir, err := codebridge.HostsDir()
	if err != nil {
		return 0, err
	}
	// Bounded: each ping is capped inside LiveHosts and the sweep as a whole
	// gets a ceiling so doctor never hangs on a dead socket.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	live, _, err := codebridge.LiveHosts(ctx, dir)
	if err != nil {
		return 0, err
	}
	return len(live), nil
}

// codeBridgeCheck reports the rk-code-bridge extension's state: not installed
// (a remediation note), else the installed version and live host count, plus
// a bundled-is-newer clause when the embedded VSIX is ahead. Always OK-shaped
// — the bridge is optional tooling, never a dependency failure. Pure over the
// injected (extensionsDir, embeddedVersion, listHosts) triple so tests never
// touch the real state dir.
func codeBridgeCheck(extensionsDir string, embeddedVersion string, listHosts func() (int, error)) doctorCheck {
	check := doctorCheck{Name: "code bridge", OK: true}
	installed, err := codeserver.InstalledBridgeVersion(extensionsDir)
	if err != nil {
		check.Note = fmt.Sprintf("state unreadable: %v", err)
		return check
	}
	if installed == "" {
		check.Note = "not installed — run rk code-server install"
		return check
	}
	n, err := listHosts()
	if err != nil {
		check.Note = fmt.Sprintf("installed v%s; live host count unavailable — enumeration failed: %v", installed, err)
	} else {
		check.Note = fmt.Sprintf("installed v%s; %d live host(s)", installed, n)
	}
	if embeddedVersion != "" && codebridge.OlderThan(installed, embeddedVersion) {
		check.Note += fmt.Sprintf("; bundled v%s is newer — run rk code-server update", embeddedVersion)
	}
	return check
}

// tmuxGuardShimCheck reports the tmux guard shim's install state (see
// tmux_guard.go / agent_setup.go). The shim is OPTIONAL — an absent shim is a
// passing check with an informational note, never a failure; a marker-less
// file at the shim path is a USER file, not an installed shim, and reads as
// not-installed too (ownership is verified via tmuxShimMarker, mirroring
// `rk agent setup`). The check fails on the mis-wired states: a file at the shim
// path exists but cannot be read (exec.LookPath can still resolve it, so tmux
// commands may be dying against a file doctor cannot vouch for), the shim's
// EMBEDDED rk path no longer exists (a dangling binary — the brew rk→run-kit
// rename shape — makes every tmux command on the machine stall through the
// shim's ~3s probe budget and then run UNGUARDED, while the shim file itself
// looks installed), the shim is installed but `tmux` no longer resolves to it
// (a PATH-ordering regression — the guard is silently bypassed), or `tmux`
// resolves to the shim but NO real tmux exists behind it (findRealTmux fails —
// every guarded tmux call would die at exec time). Pure over an injected
// (home, pathEnv, lookPath) triple so tests never depend on the host PATH.
func tmuxGuardShimCheck(home, pathEnv string, lookPath func(string) (string, error)) doctorCheck {
	check := doctorCheck{Name: "tmux-guard shim", failLabel: "tmux-guard shim", OK: true}
	shimPath := tmuxShimPath(home)
	content, exists, err := readFileIfExists(shimPath)
	if err != nil {
		// NOT the absent case: a file EXISTS at the shim path but cannot be
		// read. PATH resolution does not need read permission, so this file
		// may be fronting every tmux invocation — folding it into the
		// optional "not installed" OK note would let doctor exit 0 on a
		// machine where every tmux command fails.
		check.OK = false
		check.Hint = fmt.Sprintf("unreadable file at %s (%v) — PATH may still resolve tmux to it; fix its permissions (chmod 0755) or remove it, then re-run `rk doctor`", shimPath, err)
		return check
	}
	if !exists {
		check.Note = "not installed (optional — install with `rk agent setup`)"
		return check
	}
	if !strings.Contains(content, tmuxShimMarker) {
		check.Note = fmt.Sprintf("not installed (a non-rk file occupies %s — rk only recognizes shims it owns)", shimPath)
		return check
	}
	// The shim is only as alive as the rk binary its exec line names: verify
	// the embedded target is still a regular executable file before vouching
	// for the install. The dangling case is real (the recorded brew
	// rk→run-kit rename left a shim exec'ing a removed keg path) and is the
	// single most damaging mis-wiring — the shim's probe budget cannot outwait
	// a PERMANENTLY dangling path, so every tmux command on the machine pays
	// ~3s and then falls open to an unguarded run, while the shim file itself
	// looks healthy. A directory or non-executable file at the target degrades
	// every shimmed invocation the same way, so bare existence is not enough.
	target := tmuxShimExecTarget(content)
	if target == "" {
		check.OK = false
		check.Hint = fmt.Sprintf("shim at %s carries no parseable exec target — re-install it with `rk agent setup`", shimPath)
		return check
	}
	info, statErr := os.Stat(target)
	if statErr != nil {
		check.OK = false
		check.Hint = fmt.Sprintf("shim at %s execs %q, which is missing (%v) — every tmux command would stall ~3s and then run UNGUARDED; re-install the shim with `rk agent setup`", shimPath, target, statErr)
		return check
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0o111 == 0 {
		check.OK = false
		check.Hint = fmt.Sprintf("shim at %s execs %q, which is not an executable file (mode %v) — every tmux command would stall ~3s and then run UNGUARDED; re-install the shim with `rk agent setup`", shimPath, target, info.Mode())
		return check
	}
	resolved, err := lookPath("tmux")
	if err != nil {
		check.OK = false
		check.Hint = "shim installed but no tmux resolves on PATH — open a new shell, or check the `rk tmux guard` block in ~/.zshenv"
		return check
	}
	if !doctorSamePath(resolved, shimPath) {
		check.OK = false
		check.Hint = fmt.Sprintf("shim installed at %s but PATH resolves tmux to %s — the shims dir must precede it (check the `rk tmux guard` block in ~/.zshenv, then open a new shell)", shimPath, resolved)
		return check
	}
	// The shim only fronts the real tmux — confirm one actually exists behind
	// it, or every guarded tmux invocation dies at exec time.
	if _, err := findRealTmux(pathEnv, rkShimsDir(home)); err != nil {
		check.OK = false
		check.Hint = "PATH resolves tmux to the shim but no real tmux exists behind it — every tmux command will fail; install tmux (or fix PATH), then re-run `rk doctor`"
		return check
	}
	check.Note = "installed; PATH resolves tmux to the shim"
	return check
}

// doctorFailLabel returns the human [FAIL] row's lead-in. Pre-existing checks
// fail on absence, so the default stays the historical "<name> not found"; a
// check whose failures are not absences (the shim check fails on mis-wiring)
// supplies its own failLabel instead. The row shape "  [FAIL] <label> —
// <hint>" is shared by every check.
func doctorFailLabel(c doctorCheck) string {
	if c.failLabel != "" {
		return c.failLabel
	}
	return c.Name + " not found"
}

// doctorSamePath reports whether two paths name the same file after symlink
// evaluation (falling back to lexical cleaning when resolution fails).
func doctorSamePath(a, b string) bool {
	resolve := func(p string) string {
		if r, err := filepath.EvalSymlinks(p); err == nil {
			return r
		}
		return filepath.Clean(p)
	}
	return resolve(a) == resolve(b)
}

var doctorCmd = &cobra.Command{
	Use:   "doctor",
	Short: "Check runtime dependencies",
	RunE: func(cmd *cobra.Command, args []string) error {
		report := runDoctorChecks()

		if doctorJSON {
			data, err := json.MarshalIndent(report, "", "  ")
			if err != nil {
				return fmt.Errorf("encoding doctor JSON: %w", err)
			}
			fmt.Fprintln(cmd.OutOrStdout(), string(data))
			if !report.OK {
				return fmt.Errorf("one or more dependency checks failed")
			}
			return nil
		}

		// Human diagnostic output goes to stderr (Principle 2: this is status,
		// not the data a machine consumer parses — that is the --json path).
		// Under --quiet (Principle 9) the banner, [ OK ] rows, and success tail
		// are chatter and drop; [FAIL] rows carry the remediation hint (actionable
		// error detail) and MUST survive, so they write to ungated stderr.
		sink := newSink(cmd)
		stderr := cmd.ErrOrStderr()
		sink.Notef("Checking runtime dependencies...\n")
		for _, c := range report.Checks {
			switch {
			case c.OK && c.Note != "":
				sink.Notef("  [ OK ] %s — %s\n", c.Name, c.Note)
			case c.OK:
				sink.Notef("  [ OK ] %s\n", c.Name)
			default:
				fmt.Fprintf(stderr, "  [FAIL] %s — %s\n", doctorFailLabel(c), c.Hint)
			}
		}
		if !report.OK {
			return fmt.Errorf("one or more dependency checks failed")
		}
		sink.Notef("\nAll checks passed.\n")
		return nil
	},
}

func init() {
	doctorCmd.Flags().BoolVar(&doctorJSON, "json", false, "Emit the dependency report as JSON to stdout")
}

// --- agent hooks check -----------------------------------------------------

// classifyHookGeneration classifies an rk-owned hook command by its marker:
// 1 = the retired self-contained one-liner (inlines LegacyAgentStateOption),
// 2 = the delegating ` agent-hook ` root form, 3 = the delegating
// ` agent hook ` family form. 0 means no marker matched (an rk entry with an
// unrecognized command shape).
func classifyHookGeneration(cmd string) int {
	switch {
	case strings.Contains(cmd, rkHookMarker):
		return 1
	case strings.Contains(cmd, rkHookMarkerAgentHook):
		return 2
	case strings.Contains(cmd, rkHookMarkerAgentHookFamily):
		return 3
	}
	return 0
}

// hookRkPath extracts the rk binary path embedded in a gen-3 hook command —
// the double-quoted token immediately before the ` agent hook ` invocation
// marker (both wrapper variants: the classic `|| exit 0; "<rk>"` and the
// JSON-output `&& "<rk>"`). "" when the command does not carry one.
func hookRkPath(cmd string) string {
	idx := strings.Index(cmd, " agent hook ")
	if idx < 0 {
		return ""
	}
	head := cmd[:idx]
	end := strings.LastIndex(head, `"`)
	if end < 0 {
		return ""
	}
	start := strings.LastIndex(head[:end], `"`)
	if start < 0 {
		return ""
	}
	return head[start+1 : end]
}

// agentHooksCheck reports the rk-owned agent-hooks install state across EVERY
// agent in the registry: which hook generations are installed per agent and
// whether a gen-3 entry's embedded rk path still resolves to an executable.
// The hooks are OPTIONAL — agents with no rk artifacts are a passing check with
// an informational note. The check fails when any gen-1/gen-2 entry survives
// (those write the retired option names — the dual-read window absorbs them,
// but the stale entries are what keep the window open), when a gen-3 entry's
// embedded rk path dangles (the hook fires and writes nothing, silently), or
// when an rk-owned artifact is unreadable/malformed. Pure over an injected
// (home, readFile, stat) triple in the tmuxGuardShimCheck style so tests never
// depend on the host.
func agentHooksCheck(home string, readFile func(string) ([]byte, error), stat func(string) (os.FileInfo, error)) doctorCheck {
	check := doctorCheck{Name: "agent hooks", failLabel: "agent hooks", OK: true}
	var installed []string
	for _, agent := range agentRegistry(home) {
		st, failHint := agentHooksStatus(agent, readFile, stat)
		if failHint != "" {
			check.OK = false
			check.Hint = failHint
			return check
		}
		if st {
			installed = append(installed, agent.provider)
		}
	}
	if len(installed) == 0 {
		check.Note = "not installed (optional — install with `rk agent setup`)"
		return check
	}
	check.Note = fmt.Sprintf("installed (generation 3): %s; writes %s + %s", strings.Join(installed, ", "), tmux.AgentStateOption, tmux.LegacyAgentStateOption)
	return check
}

// agentHooksStatus reports whether one registry agent has rk-owned hooks
// installed, returning a failure hint when the agent's artifacts are present
// but broken (stale generation, dangling rk path, unreadable/malformed file).
// Absent artifacts are (false, "") — the hooks are optional.
func agentHooksStatus(agent agentConfig, readFile func(string) ([]byte, error), stat func(string) (os.FileInfo, error)) (installed bool, failHint string) {
	switch agent.kind {
	case kindMarkerFile:
		return markerFileHooksStatus(agent, readFile, stat)
	case kindMarkerBlock:
		return markerBlockHooksStatus(agent, readFile, stat)
	default:
		return jsonHooksStatus(agent, readFile, stat)
	}
}

// jsonHooksStatus classifies the rk-owned entries of a kindJSONHooksMerge
// agent's settings file. claude/codex/gemini carry the nested shape under a
// "hooks" root; agy's named-hooks document IS the root (walked whole). The
// recursive command walk collects every "command" string in the relevant
// subtree, so both shapes classify through the same generation markers.
func jsonHooksStatus(agent agentConfig, readFile func(string) ([]byte, error), stat func(string) (os.FileInfo, error)) (bool, string) {
	data, err := readFile(agent.settingsPath)
	if err != nil {
		if os.IsNotExist(err) {
			return false, ""
		}
		// A present-but-unreadable settings file is NOT the absent case: the
		// hooks it carries may be firing (or failing) on every turn while
		// doctor cannot vouch for them.
		return false, fmt.Sprintf("%s: unreadable settings file at %s (%v) — fix its permissions or remove it, then re-run `rk doctor`", agent.name, agent.settingsPath, err)
	}
	var settings map[string]any
	if err := json.Unmarshal(data, &settings); err != nil {
		return false, fmt.Sprintf("%s: settings file at %s is not parseable JSON (%v) — fix it, then re-run `rk doctor`", agent.name, agent.settingsPath, err)
	}
	root := any(asMap(settings["hooks"]))
	if agent.namedHooksDoc {
		root = settings
	}
	var stale, gen3 int
	staleGen := 0
	for _, cmd := range walkJSONCommands(root) {
		switch gen := classifyHookGeneration(cmd); gen {
		case 1, 2:
			stale++
			if staleGen == 0 || gen < staleGen {
				staleGen = gen
			}
		case 3:
			gen3++
			if hint := checkHookRkPath(agent, agent.settingsPath, cmd, stat); hint != "" {
				return false, hint
			}
		}
	}
	if stale > 0 {
		noun := "entries"
		if stale == 1 {
			noun = "entry"
		}
		return false, fmt.Sprintf("%s: %d stale hook %s in %s (generation %d) — they write legacy option names; re-run `rk agent setup` to replace them", agent.name, stale, noun, agent.settingsPath, staleGen)
	}
	if agent.namedHooksDoc {
		_, ok := settings[rkNamedHookKey]
		return ok, ""
	}
	return gen3 > 0, ""
}

// walkJSONCommands collects every "command" string value in a JSON-shaped
// tree — one walk covering the nested hooks→Event→[].hooks[] shape and agy's
// named flat handler arrays alike. Non-marker commands classify as generation
// 0 downstream and are ignored.
func walkJSONCommands(v any) []string {
	var out []string
	switch t := v.(type) {
	case map[string]any:
		for key, val := range t {
			if key == "command" {
				if s, ok := val.(string); ok {
					out = append(out, s)
				}
				continue
			}
			out = append(out, walkJSONCommands(val)...)
		}
	case []any:
		for _, e := range t {
			out = append(out, walkJSONCommands(e)...)
		}
	}
	return out
}

// markerFileHooksStatus checks a kindMarkerFile agent (copilot/opencode): the
// marker-owned file exists, and every embedded rk hook command's path resolves
// to an executable.
func markerFileHooksStatus(agent agentConfig, readFile func(string) ([]byte, error), stat func(string) (os.FileInfo, error)) (bool, string) {
	data, err := readFile(agent.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return false, ""
		}
		return false, fmt.Sprintf("%s: unreadable hooks file at %s (%v) — fix its permissions or remove it, then re-run `rk doctor`", agent.name, agent.filePath, err)
	}
	content := string(data)
	if !markerFileOwned(content) {
		// A foreign marker-less file at the path is not an rk install.
		return false, ""
	}
	for _, cmd := range extractRkHookCommands(content) {
		if hint := checkHookRkPath(agent, agent.filePath, cmd, stat); hint != "" {
			return false, hint
		}
	}
	return true, ""
}

// markerBlockHooksStatus checks a kindMarkerBlock agent (kimi): the
// marker-owned block is present and well-formed, and its embedded rk paths
// resolve. A malformed block (begin without end, or a duplicated begin) fails
// with the repair hint rather than being guessed at.
func markerBlockHooksStatus(agent agentConfig, readFile func(string) ([]byte, error), stat func(string) (os.FileInfo, error)) (bool, string) {
	data, err := readFile(agent.blockPath)
	if err != nil {
		if os.IsNotExist(err) {
			return false, ""
		}
		return false, fmt.Sprintf("%s: unreadable config at %s (%v) — fix its permissions, then re-run `rk doctor`", agent.name, agent.blockPath, err)
	}
	begin, end, _ := agent.blockContent("")
	lines := strings.Split(string(data), "\n")
	start, stop, found, blockErr := markerBlockBounds(lines, begin, end)
	if blockErr != nil {
		return false, fmt.Sprintf("%s: %s: %v — repair or remove the block by hand, then re-run `rk agent setup`", agent.name, agent.blockPath, blockErr)
	}
	if !found {
		return false, ""
	}
	for _, line := range lines[start : stop+1] {
		if cmd, ok := kimiBlockCommand(line); ok {
			if hint := checkHookRkPath(agent, agent.blockPath, cmd, stat); hint != "" {
				return false, hint
			}
		}
	}
	return true, ""
}

// checkHookRkPath fails when a gen-3 hook command's embedded rk path dangles.
func checkHookRkPath(agent agentConfig, path, cmd string, stat func(string) (os.FileInfo, error)) string {
	rkPath := hookRkPath(cmd)
	if rkPath == "" {
		return ""
	}
	info, statErr := stat(rkPath)
	if statErr != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0o111 == 0 {
		return fmt.Sprintf("%s: gen-3 hook in %s execs %q, which is not an existing regular executable — hooks fire and write nothing; re-run `rk agent setup`", agent.name, path, rkPath)
	}
	return ""
}

// extractRkHookCommands returns the rk hook command strings from raw file
// content: the JSON form (copilot's `"command": "..."` values) and the JS
// plugin's `const RK = "<path>"` plus its invocation line. The scan keys on
// the ` agent hook ` / ` agent-hook ` invocation markers — the same ownership
// signal markerFileOwned uses.
func extractRkHookCommands(content string) []string {
	var cmds []string
	var doc map[string]any
	if json.Unmarshal([]byte(content), &doc) == nil {
		for _, ev := range asMap(doc["hooks"]) {
			for _, e := range asSlice(ev) {
				entry := asMap(e)
				if cmd, ok := entry["command"].(string); ok &&
					(strings.Contains(cmd, rkHookMarkerAgentHook) || strings.Contains(cmd, rkHookMarkerAgentHookFamily)) {
					cmds = append(cmds, cmd)
				}
			}
		}
		return cmds
	}
	// Non-JSON (the opencode plugin): the binary path sits in the RK const.
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if rest, ok := strings.CutPrefix(line, `const RK = "`); ok {
			if p, ok := strings.CutSuffix(rest, `";`); ok {
				cmds = append(cmds, fmt.Sprintf(`; "%s" agent hook `, p))
			}
		}
	}
	return cmds
}

// kimiBlockCommand extracts the command value from a `command = "..."` TOML
// line inside the kimi marker block, undoing tomlBasicString's escaping.
func kimiBlockCommand(line string) (string, bool) {
	line = strings.TrimSpace(line)
	rest, ok := strings.CutPrefix(line, `command = "`)
	if !ok {
		return "", false
	}
	val, ok := strings.CutSuffix(rest, `"`)
	if !ok {
		return "", false
	}
	var b strings.Builder
	for i := 0; i < len(val); i++ {
		if val[i] == '\\' && i+1 < len(val) {
			i++
		}
		b.WriteByte(val[i])
	}
	return b.String(), true
}
