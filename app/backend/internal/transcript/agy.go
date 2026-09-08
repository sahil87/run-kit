package transcript

import (
	"os"
	"path/filepath"
	"strings"
)

// providerAgy is the routing key for the Antigravity CLI adapter (the
// `@rk_pane_agent_session` provider prefix written by `rk agent hook --agent
// agy`).
const providerAgy = "agy"

// agyAdapter locates an Antigravity CLI conversation transcript at the
// deterministic path
// `<root>/brain/<conversationId>/.system_generated/logs/transcript.jsonl`
// (layout verified on the installed agy 1.1.11 — no glob needed).
type agyAdapter struct{}

func init() { Register(agyAdapter{}) }

func (agyAdapter) Provider() string { return providerAgy }

// agyBrainRootFn is a package-level seam so tests run against a hermetic root
// (the CLI has no documented config-root env override; the production value is
// the fixed ~/.gemini/antigravity-cli/brain).
var agyBrainRootFn = func() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = ""
	}
	return filepath.Join(home, ".gemini", "antigravity-cli", "brain")
}

// TranscriptPath joins the validated conversation id onto the documented
// transcript path and stats it — a deterministic lookup with no directory
// scan. Directory names are lowercase UUIDs locally, so the ref is folded
// before joining.
func (agyAdapter) TranscriptPath(ref string) (string, error) {
	if !uuidAnyCaseRe.MatchString(ref) {
		return "", ErrInvalidRef
	}
	path := filepath.Join(agyBrainRootFn(), strings.ToLower(ref), ".system_generated", "logs", "transcript.jsonl")
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
		return "", ErrTranscriptNotFound
	}
	return path, nil
}
