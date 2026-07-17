package main

import (
	"bytes"
	"os"
	"path/filepath"
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

// TestSkillBundleWithinLineBudget pins the ≤150-line budget from the standard.
// A bundle over budget is trying to be a README and taxes every conversation
// that loads it.
func TestSkillBundleWithinLineBudget(t *testing.T) {
	// Count content lines. bytes.Count reports newline characters, so a bundle
	// without a trailing newline would undercount by one (its final line has no
	// terminator) — and an undercount makes the check MORE permissive, letting an
	// over-budget bundle (e.g. 151 lines, no trailing newline) falsely pass. Add
	// the final non-newline-terminated line back explicitly so the budget holds
	// regardless of trailing-newline convention.
	lines := bytes.Count(skillBundle, []byte("\n"))
	if len(skillBundle) > 0 && !bytes.HasSuffix(skillBundle, []byte("\n")) {
		lines++
	}
	if lines > skillLineBudget {
		t.Errorf("skill bundle is %d lines, over the %d-line budget", lines, skillLineBudget)
	}
}
