package codebridge

import "encoding/json"

// ParseArgs converts exec's positional tokens into request args: each token
// that is a valid JSON literal is carried verbatim (numbers stay numbers,
// objects stay objects — including the {"$uri":…} marker the extension
// rewrites); anything else becomes a JSON string, so bare words pass through
// as strings.
func ParseArgs(tokens []string) []json.RawMessage {
	out := make([]json.RawMessage, 0, len(tokens))
	for _, tok := range tokens {
		if json.Valid([]byte(tok)) {
			out = append(out, json.RawMessage(tok))
			continue
		}
		b, err := json.Marshal(tok)
		if err != nil {
			continue
		}
		out = append(out, json.RawMessage(b))
	}
	return out
}
