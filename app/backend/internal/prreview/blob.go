package prreview

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
)

// errBlobUnavailable marks a blob gh declined to serve (binary, too large, or
// a path that does not exist at that sha). Callers degrade to unhighlighted
// rows rather than failing the request.
var errBlobUnavailable = errors.New("blob unavailable")

type ghContents struct {
	Content  string `json:"content"`
	Encoding string `json:"encoding"`
	Type     string `json:"type"`
}

// blobLines returns a blob's lines, cached by (blobSha, path).
//
// This is the SAME fetch context expansion needs, which is why it is one
// function: the lexer wants the surrounding lines for its context pad and the
// `↕ All N lines` expander wants them for display, so the two requirements
// share one gh call (spec § R5).
func (f *Fetcher) blobLines(ctx context.Context, ref PRRef, path, sha string) ([]string, error) {
	if sha == "" || !repoRelativePath(path) {
		return nil, errBlobUnavailable
	}
	if cached := f.blobs.get(sha, path); cached != nil {
		return cached.lines, nil
	}
	out, err := f.ghExec(ctx, nil, f.restArgs(ref,
		"repos/"+ref.Repository()+"/contents/"+encodePathSegments(path)+"?ref="+sha)...)
	if err != nil {
		return nil, errBlobUnavailable
	}
	var decoded ghContents
	if err := json.Unmarshal(out, &decoded); err != nil {
		return nil, errBlobUnavailable
	}
	if decoded.Type != "file" || !strings.EqualFold(decoded.Encoding, "base64") {
		return nil, errBlobUnavailable
	}
	// The REST contents payload wraps its base64 at 60 columns.
	raw, err := base64.StdEncoding.DecodeString(strings.ReplaceAll(decoded.Content, "\n", ""))
	if err != nil {
		return nil, errBlobUnavailable
	}
	lines := splitLines(string(raw))
	f.blobs.put(sha, path, &blobEntry{lines: lines, bytes: entryBytes(lines)})
	return lines, nil
}

// repoRelativePath reports whether `path` is a plain repo-relative file path.
//
// Defense in depth behind the callers' own closed-set gates (FileRows and
// ContextRows both require the path to name a file in the PR): pathEscape below
// deliberately leaves `.` unescaped, so a `..` segment would otherwise survive
// into the `contents/<path>` route segment and be resolved by GitHub rather
// than by us.
func repoRelativePath(path string) bool {
	if path == "" || strings.HasPrefix(path, "/") || strings.ContainsAny(path, "\x00\n\r") {
		return false
	}
	for _, segment := range strings.Split(path, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return false
		}
	}
	return true
}

// encodePathSegments percent-encodes each path segment while leaving the
// separators intact — the contents route takes the path as a route segment,
// not a query value, so url.QueryEscape's "+" for space would be wrong.
func encodePathSegments(path string) string {
	parts := strings.Split(path, "/")
	for i, part := range parts {
		parts[i] = pathEscape(part)
	}
	return strings.Join(parts, "/")
}

func pathEscape(segment string) string {
	const upperhex = "0123456789ABCDEF"
	var b strings.Builder
	for i := 0; i < len(segment); i++ {
		c := segment[i]
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9':
			b.WriteByte(c)
		case c == '-' || c == '_' || c == '.' || c == '~':
			b.WriteByte(c)
		default:
			b.WriteByte('%')
			b.WriteByte(upperhex[c>>4])
			b.WriteByte(upperhex[c&15])
		}
	}
	return b.String()
}
