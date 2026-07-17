package main

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"runtime"

	"github.com/spf13/cobra"
)

// doctorJSON requests machine-readable output on stdout. Principle 2 names
// `doctor` as a --json carrier; the structured result goes to stdout (data)
// while the human diagnostic remains on stderr.
var doctorJSON bool

// doctorCheck is one dependency check in the --json report. `ok` is the pass
// flag; `hint` carries the remediation string on failure (empty when ok).
type doctorCheck struct {
	Name string `json:"name"`
	OK   bool   `json:"ok"`
	Hint string `json:"hint,omitempty"`
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

	return report
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
		stderr := cmd.ErrOrStderr()
		fmt.Fprintln(stderr, "Checking runtime dependencies...")
		for _, c := range report.Checks {
			if c.OK {
				fmt.Fprintf(stderr, "  [ OK ] %s\n", c.Name)
			} else {
				fmt.Fprintf(stderr, "  [FAIL] %s not found — %s\n", c.Name, c.Hint)
			}
		}
		if !report.OK {
			return fmt.Errorf("one or more dependency checks failed")
		}
		fmt.Fprintln(stderr, "\nAll checks passed.")
		return nil
	},
}

func init() {
	doctorCmd.Flags().BoolVar(&doctorJSON, "json", false, "Emit the dependency report as JSON to stdout")
}
