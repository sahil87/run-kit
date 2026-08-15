package main

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"rk/internal/codeserver"
	"rk/internal/config"

	"github.com/spf13/cobra"
)

// doctorJSON requests machine-readable output on stdout. Principle 2 names
// `doctor` as a --json carrier; the structured result goes to stdout (data)
// while the human diagnostic remains on stderr.
var doctorJSON bool

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
		hint := "install tmux and ensure it is on PATH"
		if runtime.GOOS == "darwin" {
			hint = "install with: brew install tmux"
		}
		report.Checks = append(report.Checks, doctorCheck{Name: "tmux", OK: false, Hint: hint})
		report.OK = false
	} else {
		report.Checks = append(report.Checks, doctorCheck{Name: "tmux", OK: true})
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

	return report
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
