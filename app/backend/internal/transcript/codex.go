package transcript

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// providerCodex is the routing key for the Codex adapter (the
// `@rk_pane_agent_session` provider prefix written by `rk agent hook --agent
// codex`).
const providerCodex = "codex"

// uuidAnyCaseRe guards UUID-shaped session refs before ANY filesystem use
// (codex session ids and agy conversation ids are UUIDs), matched
// case-insensitively. The ref rides a filename/path segment, so a value
// carrying `/`, `..`, or glob metacharacters can never reach the filesystem
// (Constitution I).
var uuidAnyCaseRe = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// codexAdapter locates a Codex CLI session transcript
// (`<root>/sessions/<YYYY>/<MM>/<DD>/rollout-<ts>-<ref>.jsonl` — layout
// verified against the installed 0.153.4, whose session_meta first line
// carries the same session_id).
type codexAdapter struct{}

func init() { Register(codexAdapter{}) }

func (codexAdapter) Provider() string { return providerCodex }

// codexRoot returns the Codex config root: $CODEX_HOME if set (Codex's own
// override), else ~/.codex. Tests set CODEX_HOME for hermetic roots.
func codexRoot() string {
	if dir := os.Getenv("CODEX_HOME"); dir != "" {
		return dir
	}
	home, err := os.UserHomeDir()
	if err != nil {
		home = ""
	}
	return filepath.Join(home, ".codex")
}

// TranscriptPath resolves ref to the rollout path via the ref-embedded
// fixed-depth glob `sessions/*/*/*/rollout-*-<ref>.jsonl`: a lookup scans only
// the date-level directories plus one day's entries per dir, never the whole
// rollout history — on a hit OR a miss (R16's bounded-work rule; the derive
// tick calls this once per identified window per fetch). Codex writes
// lowercase-UUID filenames, so the validated ref is folded to lowercase before
// globbing; there is deliberately no case-insensitive fallback (it would
// re-scan all of history on every genuine miss).
func (codexAdapter) TranscriptPath(ref string) (string, error) {
	if !uuidAnyCaseRe.MatchString(ref) {
		return "", ErrInvalidRef
	}
	matches, err := filepath.Glob(filepath.Join(codexRoot(), "sessions", "*", "*", "*", "rollout-*-"+strings.ToLower(ref)+".jsonl"))
	if err != nil {
		return "", err
	}
	if len(matches) == 0 {
		return "", ErrTranscriptNotFound
	}
	return matches[0], nil
}
