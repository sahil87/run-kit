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

// TestSkillCmdPrintsBundleByteIdentical drives `rk skill` through its cobra
// command and asserts stdout equals the embedded bundle byte-for-byte, with
// empty stderr and a nil error (exit 0). No rendering, no added framing.
func TestSkillCmdPrintsBundleByteIdentical(t *testing.T) {
	var stdout, stderr bytes.Buffer
	skillCmd.SetOut(&stdout)
	skillCmd.SetErr(&stderr)
	t.Cleanup(func() {
		skillCmd.SetOut(nil)
		skillCmd.SetErr(nil)
	})

	if err := skillCmd.RunE(skillCmd, nil); err != nil {
		t.Fatalf("skill RunE err = %v, want nil (exit 0)", err)
	}
	if !bytes.Equal(stdout.Bytes(), skillBundle) {
		t.Errorf("stdout is not byte-identical to the embedded bundle (got %d bytes, want %d)",
			stdout.Len(), len(skillBundle))
	}
	if stderr.Len() != 0 {
		t.Errorf("skill wrote to stderr: %q", stderr.String())
	}
}

// TestSkillEmbedMatchesCanonical is the drift guard: the embedded bundle bytes
// MUST equal the canonical docs/site/skill.md. The test file lives at
// app/backend/cmd/rk/, so the canonical source is four levels up. When the
// canonical doc drifts from the committed copy (someone edits docs/site/skill.md
// without re-running scripts/sync-skill.sh), this fails, naming the fix.
func TestSkillEmbedMatchesCanonical(t *testing.T) {
	canonicalPath := filepath.Join("..", "..", "..", "..", "docs", "site", "skill.md")
	canonical, err := os.ReadFile(canonicalPath)
	if err != nil {
		t.Fatalf("read canonical %s: %v", canonicalPath, err)
	}
	if !bytes.Equal(skillBundle, canonical) {
		t.Errorf("embedded skill bundle has drifted from canonical %s — run scripts/sync-skill.sh and commit the refreshed copy", canonicalPath)
	}
}

// countLines counts content lines the way the ≤150 budget is defined: newline
// characters plus one for a final line with no trailing newline (an undercount
// would make the budget check falsely permissive; see TestSkillBundleWithinLineBudget).
func countLines(b []byte) int {
	lines := bytes.Count(b, []byte("\n"))
	if len(b) > 0 && !bytes.HasSuffix(b, []byte("\n")) {
		lines++
	}
	return lines
}

// TestSkillBundleWithinLineBudget pins the ≤150-line budget from the standard.
// A bundle over budget is trying to be a README and taxes every conversation
// that loads it.
func TestSkillBundleWithinLineBudget(t *testing.T) {
	if lines := countLines(skillBundle); lines > skillLineBudget {
		t.Errorf("skill bundle is %d lines, over the %d-line budget", lines, skillLineBudget)
	}
}

// runSkill drives skillCmd with the given args and returns (stdout, stderr, err).
func runSkill(t *testing.T, args ...string) (string, string, error) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	skillCmd.SetOut(&stdout)
	skillCmd.SetErr(&stderr)
	t.Cleanup(func() {
		skillCmd.SetOut(nil)
		skillCmd.SetErr(nil)
	})
	err := skillCmd.RunE(skillCmd, args)
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

// TestSkillDisplayPrintsTopicByteIdentical drives `rk skill display` and asserts
// stdout equals the embedded topic bundle byte-for-byte, empty stderr, nil error.
func TestSkillDisplayPrintsTopicByteIdentical(t *testing.T) {
	stdout, stderr, err := runSkill(t, "display")
	if err != nil {
		t.Fatalf("skill display RunE err = %v, want nil (exit 0)", err)
	}
	if !bytes.Equal([]byte(stdout), skillDisplayTopic) {
		t.Errorf("stdout is not byte-identical to the embedded display topic (got %d bytes, want %d)",
			len(stdout), len(skillDisplayTopic))
	}
	if stderr != "" {
		t.Errorf("skill display wrote to stderr: %q", stderr)
	}
}

// TestSkillUnknownTopicFailsFast asserts `rk skill bogus` fails fast: empty
// stdout, a non-nil usage-class error (exit 2) whose message names the valid
// topics — never a silent empty stdout with exit 0.
func TestSkillUnknownTopicFailsFast(t *testing.T) {
	stdout, _, err := runSkill(t, "bogus")
	if err == nil {
		t.Fatal("skill bogus err = nil, want a usage error")
	}
	if stdout != "" {
		t.Errorf("skill bogus wrote to stdout: %q, want empty", stdout)
	}
	if exitCode(err) != exitUsage {
		t.Errorf("skill bogus exit code = %d, want %d (usage)", exitCode(err), exitUsage)
	}
	for _, want := range []string{"unknown topic", "display"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("skill bogus error %q missing %q", err.Error(), want)
		}
	}
}

// TestSkillDisplayEmbedMatchesCanonical is the topic drift guard: the embedded
// display topic bytes MUST equal the canonical docs/site/skill/display.md.
func TestSkillDisplayEmbedMatchesCanonical(t *testing.T) {
	canonicalPath := filepath.Join("..", "..", "..", "..", "docs", "site", "skill", "display.md")
	canonical, err := os.ReadFile(canonicalPath)
	if err != nil {
		t.Fatalf("read canonical %s: %v", canonicalPath, err)
	}
	if !bytes.Equal(skillDisplayTopic, canonical) {
		t.Errorf("embedded display topic has drifted from canonical %s — run scripts/sync-skill.sh and commit the refreshed copy", canonicalPath)
	}
}

// TestSkillDisplayWithinLineBudget pins the topic page's independent ≤150-line
// budget (the standard bounds each topic page separately, not the aggregate).
func TestSkillDisplayWithinLineBudget(t *testing.T) {
	if lines := countLines(skillDisplayTopic); lines > skillLineBudget {
		t.Errorf("display topic is %d lines, over the %d-line budget", lines, skillLineBudget)
	}
}
