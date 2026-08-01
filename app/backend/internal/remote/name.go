package remote

import (
	"fmt"
	"strings"

	"rk/internal/validate"
)

// DefaultName derives a remote's default name from its verbatim ssh target:
// the host token (text after the last '@' — a bare alias is its own host
// token) with dots mapped to hyphens, since tmux names cannot carry periods
// ("build.example.com" → "build-example-com"). The result is validated with
// the same rule `rk remote add --name` applies; a target whose derivation
// still fails validation errors with a pointer to --name.
//
// This is a pure, offline derivation — add performs no ssh roundtrip, so the
// health-ping hostname (the desktop shell's naming convention for URL hosts)
// is not available here.
func DefaultName(target string) (string, error) {
	token := target
	if i := strings.LastIndex(token, "@"); i >= 0 {
		token = token[i+1:]
	}
	name := strings.ReplaceAll(token, ".", "-")
	if msg := validate.ValidateRemoteName(name); msg != "" {
		return "", fmt.Errorf("cannot derive a valid name from %q (%s) — pass one with --name", target, strings.ToLower(msg[:1])+msg[1:])
	}
	return name, nil
}
