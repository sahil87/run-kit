package transcript

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
)

// providerKimi is the routing key for the Kimi Code CLI adapter.
const providerKimi = "kimi"

// kimiRefRe guards the kimi session ref before ANY filesystem use: kimi
// session ids are `session_<uuid>` (verified on 0.41.0's session_index.jsonl),
// and the shared safe-token shape admits that and nothing path-bearing.
var kimiRefRe = safeTokenRefRe

// kimiAdapter locates a Kimi Code session transcript
// (`<root>/sessions/<workDirKey>/<sessionId>/agents/main/wire.jsonl` — layout
// verified against the installed 0.41.0). The primary locator is the
// session_index.jsonl mapping (sessionId → sessionDir), which resolves without
// a directory scan; a bounded glob is the fallback for a stale/missing index
// line.
type kimiAdapter struct{}

func init() { Register(kimiAdapter{}) }

func (kimiAdapter) Provider() string { return providerKimi }

// kimiRoot returns the Kimi Code config root: $KIMI_CODE_HOME if set (the
// CLI's own relocation override), else ~/.kimi-code.
func kimiRoot() string {
	if dir := os.Getenv("KIMI_CODE_HOME"); dir != "" {
		return dir
	}
	home, err := os.UserHomeDir()
	if err != nil {
		home = ""
	}
	return filepath.Join(home, ".kimi-code")
}

// kimiIndexRecord is one line of session_index.jsonl.
type kimiIndexRecord struct {
	SessionID  string `json:"sessionId"`
	SessionDir string `json:"sessionDir"`
}

// kimiIndexReadLimit bounds the session-index read (~1 MiB — the file grows
// one small record per session).
const kimiIndexReadLimit = 1 << 20

// kimiWireName is the transcript file inside a session dir.
const kimiWireName = "wire.jsonl"

// TranscriptPath resolves ref to the session's wire.jsonl: the session index
// is scanned first (its sessionDir is authoritative, but only honored when it
// sits under the kimi root — a client-influenced path outside the root is
// never trusted), then the bounded glob `sessions/*/<ref>/agents/main/wire.jsonl`.
func (kimiAdapter) TranscriptPath(ref string) (string, error) {
	if !kimiRefRe.MatchString(ref) {
		return "", ErrInvalidRef
	}
	root := kimiRoot()
	if dir := kimiSessionDirFromIndex(root, ref); dir != "" {
		path := filepath.Join(dir, "agents", "main", kimiWireName)
		if info, err := os.Stat(path); err == nil && info.Mode().IsRegular() {
			return path, nil
		}
	}
	matches, err := filepath.Glob(filepath.Join(root, "sessions", "*", ref, "agents", "main", kimiWireName))
	if err != nil {
		return "", err
	}
	if len(matches) == 0 {
		return "", ErrTranscriptNotFound
	}
	return matches[0], nil
}

// kimiSessionDirFromIndex scans session_index.jsonl for ref's record and
// returns its sessionDir — but ONLY when the recorded dir is exactly the
// root's own sessions tree (`<root>/sessions/...`): the index is a hint, and a
// record pointing outside the root degrades to the glob fallback rather than
// reading an arbitrary path (the same posture as the ref guard).
func kimiSessionDirFromIndex(root, ref string) string {
	f, err := os.Open(filepath.Join(root, "session_index.jsonl"))
	if err != nil {
		return ""
	}
	defer f.Close()
	prefix := filepath.Join(root, "sessions") + string(os.PathSeparator)
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), kimiIndexReadLimit)
	for scanner.Scan() {
		var rec kimiIndexRecord
		if err := json.Unmarshal(scanner.Bytes(), &rec); err != nil {
			continue
		}
		if rec.SessionID == ref && rec.SessionDir != "" && len(rec.SessionDir) > len(prefix) &&
			filepath.Clean(rec.SessionDir) == rec.SessionDir &&
			rec.SessionDir[:len(prefix)] == prefix {
			return rec.SessionDir
		}
	}
	return ""
}
