package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// skillLineBudget is the hard line-count ceiling for the skill bundle, per the
// shll `skill` standard (≤150 lines). Agents load this bundle every session and
// it will later be aggregated across every installed tool, so the budget is a
// contract, not a suggestion.
const skillLineBudget = 150

// Core and topic invocations print their embedded content byte-for-byte.
func TestSkillTopicsPrintByteIdentical(t *testing.T) {
	cases := []struct {
		name  string
		topic string
		want  []byte
	}{
		{name: "core", want: skillBundle},
		{name: "display", topic: "display", want: skillDisplayTopic},
		{name: "code", topic: "code", want: skillCodeTopic},
		{name: "mux", topic: "mux", want: skillMuxTopic},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var stdout, stderr string
			var err error
			if tc.topic == "" {
				var outBuffer, errBuffer bytes.Buffer
				skillCmd.SetOut(&outBuffer)
				skillCmd.SetErr(&errBuffer)
				t.Cleanup(func() {
					skillCmd.SetOut(nil)
					skillCmd.SetErr(nil)
				})
				err = skillCmd.RunE(skillCmd, nil)
				stdout, stderr = outBuffer.String(), errBuffer.String()
			} else {
				stdout, stderr, err = runSkill(t, tc.topic)
			}
			if err != nil {
				t.Fatalf("skill %s RunE err = %v, want nil", tc.topic, err)
			}
			if !bytes.Equal([]byte(stdout), tc.want) {
				t.Errorf("stdout is not byte-identical (got %d bytes, want %d)", len(stdout), len(tc.want))
			}
			if stderr != "" {
				t.Errorf("skill %s wrote to stderr: %q", tc.topic, stderr)
			}
		})
	}
}

func TestSkillTopicsMatchCanonical(t *testing.T) {
	cases := []struct {
		name      string
		embedded  []byte
		canonical string
	}{
		{name: "core", embedded: skillBundle, canonical: filepath.Join("..", "..", "..", "..", "docs", "site", "skill.md")},
		{name: "display", embedded: skillDisplayTopic, canonical: filepath.Join("..", "..", "..", "..", "docs", "site", "skill", "display.md")},
		{name: "code", embedded: skillCodeTopic, canonical: filepath.Join("..", "..", "..", "..", "docs", "site", "skill", "code.md")},
		{name: "mux", embedded: skillMuxTopic, canonical: filepath.Join("..", "..", "..", "..", "docs", "site", "skill", "mux.md")},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			canonical, err := os.ReadFile(tc.canonical)
			if err != nil {
				t.Fatalf("read canonical %s: %v", tc.canonical, err)
			}
			if !bytes.Equal(tc.embedded, canonical) {
				t.Errorf("embedded skill content has drifted from canonical %s", tc.canonical)
			}
		})
	}
}

// countLines applies the line-budget definition to content with or without a
// trailing newline.
func countLines(b []byte) int {
	lines := bytes.Count(b, []byte("\n"))
	if len(b) > 0 && !bytes.HasSuffix(b, []byte("\n")) {
		lines++
	}
	return lines
}

// Every embedded skill page has its own line budget.
func TestSkillTopicsWithinLineBudget(t *testing.T) {
	for _, tc := range []struct {
		name    string
		content []byte
	}{
		{name: "core", content: skillBundle},
		{name: "display", content: skillDisplayTopic},
		{name: "code", content: skillCodeTopic},
		{name: "mux", content: skillMuxTopic},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if lines := countLines(tc.content); lines > skillLineBudget {
				t.Errorf("%s skill content is %d lines, over the %d-line budget", tc.name, lines, skillLineBudget)
			}
		})
	}
}

// runSkill drives `rk skill [args...]` through the real cobra Execute() seam —
// not skillCmd.RunE directly — so the MaximumNArgs(1)+usageArgs validator and
// cobra's stderr error path are exercised exactly as they are in production. It
// returns (stdout, stderr, err); err is the value Execute() returns, which
// execute() would classify via exitCode. Buffers are attached to the shared
// rootCmd (children inherit its out/err), and root flag/arg state is reset first
// so a prior test's Execute() cannot bleed into this one.
func runSkill(t *testing.T, args ...string) (string, string, error) {
	t.Helper()
	resetRootFlagState(t)
	var stdout, stderr bytes.Buffer
	rootCmd.SetOut(&stdout)
	rootCmd.SetErr(&stderr)
	rootCmd.SetArgs(append([]string{"skill"}, args...))
	t.Cleanup(func() {
		rootCmd.SetOut(nil)
		rootCmd.SetErr(nil)
		rootCmd.SetArgs(nil)
	})
	err := rootCmd.Execute()
	return stdout.String(), stderr.String(), err
}

// TestSkillBareStillPrintsCoreBundle asserts bare `rk skill` (no arg) still
// prints ONLY the core bundle, byte-identical — never a topic page inlined.
func TestSkillBareStillPrintsCoreBundle(t *testing.T) {
	stdout, stderr, err := runSkill(t)
	if err != nil {
		t.Fatalf("skill RunE err = %v, want nil (exit 0)", err)
	}
	if stdout != string(skillBundle) {
		t.Error("bare `skill` stdout is not the core bundle byte-identical")
	}
	if stderr != "" {
		t.Errorf("skill wrote to stderr: %q", stderr)
	}
}

// TestSkillUnknownTopicFailsFast asserts `rk skill bogus` fails fast: empty
// stdout, the diagnostic emitted on STDERR (cobra's `Error:` line, since the
// command runs through Execute()), a non-nil usage-class error (exit 2) whose
// message names the valid topics — never a silent empty stdout with exit 0.
func TestSkillUnknownTopicFailsFast(t *testing.T) {
	stdout, stderr, err := runSkill(t, "bogus")
	if err == nil {
		t.Fatal("skill bogus err = nil, want a usage error")
	}
	if stdout != "" {
		t.Errorf("skill bogus wrote to stdout: %q, want empty", stdout)
	}
	if exitCode(err) != exitUsage {
		t.Errorf("skill bogus exit code = %d, want %d (usage)", exitCode(err), exitUsage)
	}
	for _, want := range []string{"unknown topic", "code, display, mux"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("skill bogus error %q missing %q", err.Error(), want)
		}
		if !strings.Contains(stderr, want) {
			t.Errorf("skill bogus stderr %q missing %q", stderr, want)
		}
	}
}

// TestSkillTooManyArgsFailsFast pins the MaximumNArgs(1)+usageArgs contract: a
// second positional arg is a usage error (exit 2) with empty stdout and the
// diagnostic on stderr — the validator rejects it before RunE runs, so no bundle
// is ever printed.
func TestSkillTooManyArgsFailsFast(t *testing.T) {
	stdout, stderr, err := runSkill(t, "display", "extra")
	if err == nil {
		t.Fatal("skill display extra err = nil, want a usage error")
	}
	if stdout != "" {
		t.Errorf("skill display extra wrote to stdout: %q, want empty", stdout)
	}
	if exitCode(err) != exitUsage {
		t.Errorf("skill display extra exit code = %d, want %d (usage)", exitCode(err), exitUsage)
	}
	if stderr == "" {
		t.Error("skill display extra wrote nothing to stderr, want the arg-count diagnostic")
	}
}
