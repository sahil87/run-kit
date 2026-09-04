package transcript

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
)

// providerClaude is the routing key for the Claude adapter (the
// `@rk_pane_agent_session` provider prefix). Declared once here.
const providerClaude = "claude"

// uuidRe matches the strict Claude session-UUID shape. The ref MUST match this
// before ANY filesystem use — it is the path-traversal guard (Constitution I
// posture applied to file paths): the UUID *is* the transcript filename, so a
// value carrying `/`, `..`, or glob metacharacters can never reach the glob.
var uuidRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// ErrTranscriptNotFound is returned when a strict-UUID ref resolves to no file
// under any project dir. A live agent's transcript exists by construction, so
// this surfaces the "missing transcript for a live ref" case as a read error.
var ErrTranscriptNotFound = errors.New("transcript: not found for ref")

// ErrInvalidRef is returned when a ref fails the strict-UUID guard, before any
// filesystem access. It is exported so the API layer can map a malformed ref
// (which, for a window-keyed route, means the client only supplied a windowID
// whose reconciled @rk_pane_agent_session is malformed — not a server fault) to
// a 404-class response rather than a 500.
var ErrInvalidRef = errors.New("transcript: invalid session ref (not a uuid)")

// claudeAdapter locates a Claude Code session transcript
// (`<root>/projects/*/<ref>.jsonl`).
type claudeAdapter struct{}

func init() { Register(claudeAdapter{}) }

func (claudeAdapter) Provider() string { return providerClaude }

// transcriptRoot returns the Claude config root: $CLAUDE_CONFIG_DIR if set, else
// ~/.claude. An empty HOME with no override yields ".claude" (relative) — the
// glob then simply finds nothing, which surfaces as ErrTranscriptNotFound.
func transcriptRoot() string {
	if dir := os.Getenv("CLAUDE_CONFIG_DIR"); dir != "" {
		return dir
	}
	home, err := os.UserHomeDir()
	if err != nil {
		home = ""
	}
	return filepath.Join(home, ".claude")
}

// locateTranscript resolves ref to its transcript path via the glob
// `<root>/projects/*/<ref>.jsonl`. The ref MUST already be a strict UUID (callers
// gate on uuidRe first); this function re-gates defensively so it can never be
// called with an unguarded ref. Returns ErrTranscriptNotFound when no file
// matches.
func locateTranscript(ref string) (string, error) {
	if !uuidRe.MatchString(ref) {
		return "", ErrInvalidRef
	}
	root := transcriptRoot()
	// ref is a strict UUID (validated above), so it contains no glob
	// metacharacters — the only wildcard is the projects/* segment.
	matches, err := filepath.Glob(filepath.Join(root, "projects", "*", ref+".jsonl"))
	if err != nil {
		return "", err
	}
	if len(matches) == 0 {
		return "", ErrTranscriptNotFound
	}
	// A session UUID is unique across projects; if more than one matched (a
	// resumed session copied across cwds), the first is deterministic enough for
	// v1 — they name the same session.
	return matches[0], nil
}

// TranscriptPath resolves ref to the transcript's absolute path via the UUID-
// guarded locateTranscript — the claude adapter's TranscriptLocator capability
// (adapter.go), reached per-provider through transcript.Path. The guard
// stays in front: an invalid ref is ErrInvalidRef before any filesystem access.
func (claudeAdapter) TranscriptPath(ref string) (string, error) {
	return locateTranscript(ref)
}
