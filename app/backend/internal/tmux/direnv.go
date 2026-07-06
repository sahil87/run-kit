package tmux

import (
	"bytes"
	"compress/zlib"
	"encoding/base64"
	"encoding/json"
	"io"
	"strings"
)

// direnvDiffVar is the environment variable direnv exports carrying its
// internal env_diff — a record of every change direnv made when it loaded the
// current directory's .envrc. Reverse-applying it yields the environment "as if
// the user had started tmux from $HOME" (a from-home shell is precisely one
// where direnv reverted its diff).
const direnvDiffVar = "DIRENV_DIFF"

// direnvDiff is direnv's env_diff payload: P holds the prior value of each var
// direnv changed or removed, N holds the new value of each var direnv changed
// or added. A var present in P but absent from N was removed by direnv; a var
// in N but absent from P was added; a var in both was changed.
type direnvDiff struct {
	P map[string]string `json:"p"`
	N map[string]string `json:"n"`
}

// reverseDirenvDiff returns environ with direnv's DIRENV_DIFF reverse-applied,
// undoing direnv's changes so the result reflects the pre-direnv (from-home)
// environment — including the user's true pre-direnv PATH.
//
// When DIRENV_DIFF is absent, environ is returned unchanged with a nil error
// (nothing to reverse). When DIRENV_DIFF is present but cannot be decoded,
// inflated, or parsed, the original environ is returned alongside a non-nil
// error so the caller can warn and fall through — sanitization never fails hard
// over a malformed diff.
//
// Reversal semantics (per direnv's env_diff format): for each key in N, restore
// its P value if present in P, otherwise remove it (direnv added it); for each
// key in P absent from N, restore its P value (direnv removed it). DIRENV_DIFF
// itself is not stripped here — the caller's DIRENV_* strip removes it.
func reverseDirenvDiff(environ []string) ([]string, error) {
	raw, ok := lookupEnv(environ, direnvDiffVar)
	if !ok {
		return environ, nil
	}

	diff, err := decodeDirenvDiff(raw)
	if err != nil {
		return environ, err
	}

	// Build the reversed environment: start from environ as a name->value map,
	// preserving order via a parallel key slice so output is deterministic.
	names := make([]string, 0, len(environ))
	values := make(map[string]string, len(environ))
	for _, e := range environ {
		name, val := splitEnv(e)
		if _, seen := values[name]; !seen {
			names = append(names, name)
		}
		values[name] = val
	}

	// For each var direnv touched via N: restore its prior value if direnv
	// changed it (present in P), otherwise remove it (direnv added it).
	for name := range diff.N {
		if prior, hadPrior := diff.P[name]; hadPrior {
			if _, seen := values[name]; !seen {
				names = append(names, name)
			}
			values[name] = prior
		} else {
			delete(values, name)
		}
	}

	// For each var direnv removed (in P, absent from N): restore its value.
	for name, prior := range diff.P {
		if _, inN := diff.N[name]; inN {
			continue // already handled by the N loop above
		}
		if _, seen := values[name]; !seen {
			names = append(names, name)
		}
		values[name] = prior
	}

	out := make([]string, 0, len(names))
	for _, name := range names {
		if val, ok := values[name]; ok {
			out = append(out, name+"="+val)
		}
	}
	return out, nil
}

// decodeDirenvDiff decodes direnv's DIRENV_DIFF value: base64url decode, then
// zlib inflate, then JSON unmarshal of {"p":{...},"n":{...}}. Stdlib only.
func decodeDirenvDiff(raw string) (direnvDiff, error) {
	var diff direnvDiff

	compressed, err := decodeBase64URL(raw)
	if err != nil {
		return diff, err
	}

	r, err := zlib.NewReader(bytes.NewReader(compressed))
	if err != nil {
		return diff, err
	}
	defer r.Close()

	plain, err := io.ReadAll(r)
	if err != nil {
		return diff, err
	}

	if err := json.Unmarshal(plain, &diff); err != nil {
		return diff, err
	}
	return diff, nil
}

// decodeBase64URL decodes a base64url string, tolerating both the padded
// (base64.URLEncoding, direnv's default) and unpadded (RawURLEncoding) forms.
func decodeBase64URL(raw string) ([]byte, error) {
	if b, err := base64.URLEncoding.DecodeString(raw); err == nil {
		return b, nil
	}
	return base64.RawURLEncoding.DecodeString(raw)
}

// lookupEnv returns the value of name in environ ("NAME=value" entries) and
// whether it was found. On duplicates, the last entry wins (shell semantics).
func lookupEnv(environ []string, name string) (string, bool) {
	prefix := name + "="
	value := ""
	found := false
	for _, e := range environ {
		if strings.HasPrefix(e, prefix) {
			value = e[len(prefix):]
			found = true
		}
	}
	return value, found
}

// splitEnv splits a "NAME=value" entry into its name and value. An entry with
// no '=' is treated as a bare name with an empty value.
func splitEnv(entry string) (name, value string) {
	if i := strings.IndexByte(entry, '='); i >= 0 {
		return entry[:i], entry[i+1:]
	}
	return entry, ""
}
