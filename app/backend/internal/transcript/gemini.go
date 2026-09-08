package transcript

import (
	"bufio"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// providerGemini is the routing key for the Gemini CLI adapter.
const providerGemini = "gemini"

// geminiAdapter locates a Gemini CLI session transcript
// (`<root>/tmp/<project-slug>/chats/session-<ts>-<ref-prefix8>.jsonl` — layout
// verified against the installed 0.54.4). The filename carries only the FIRST
// 8 hex chars of the session id, so a glob match is a candidate, not a proof:
// the adapter verifies the full id against the file's first record
// (`sessionId`) before returning.
type geminiAdapter struct{}

func init() { Register(geminiAdapter{}) }

func (geminiAdapter) Provider() string { return providerGemini }

// geminiRootFn is a package-level seam so tests run against a hermetic root
// (Gemini CLI has no documented config-root env override; the production value
// is the fixed ~/.gemini).
var geminiRootFn = func() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = ""
	}
	return filepath.Join(home, ".gemini")
}

// geminiFirstRecord is the leading record of a gemini chat file — the only
// field read is the full session id used to confirm a prefix-glob candidate.
type geminiFirstRecord struct {
	SessionID string `json:"sessionId"`
}

// geminiFirstReadLimit bounds the first-record read; the header line is small
// and the cap keeps a pathological file from stalling a lookup.
const geminiFirstReadLimit = 1 << 20

// TranscriptPath resolves a strict-UUID ref via the bounded glob
// `tmp/*/chats/session-*-<ref[:8]>.jsonl`, then confirms the candidate's
// full sessionId. A prefix collision without a full-id match is
// ErrTranscriptNotFound, never a wrong transcript.
func (geminiAdapter) TranscriptPath(ref string) (string, error) {
	if !uuidRe.MatchString(ref) {
		return "", ErrInvalidRef
	}
	matches, err := filepath.Glob(filepath.Join(geminiRootFn(), "tmp", "*", "chats", "session-*-"+ref[:8]+".jsonl"))
	if err != nil {
		return "", err
	}
	for _, m := range matches {
		if geminiFileSessionID(m) == ref {
			return m, nil
		}
	}
	return "", ErrTranscriptNotFound
}

// geminiFileSessionID reads the first record of a gemini chat file and returns
// its sessionId ("" on any failure — the candidate simply fails verification).
func geminiFileSessionID(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	line, err := bufio.NewReader(io.LimitReader(f, geminiFirstReadLimit)).ReadString('\n')
	if err != nil && line == "" {
		return ""
	}
	var rec geminiFirstRecord
	if err := json.Unmarshal([]byte(strings.TrimSpace(line)), &rec); err != nil {
		return ""
	}
	return rec.SessionID
}
