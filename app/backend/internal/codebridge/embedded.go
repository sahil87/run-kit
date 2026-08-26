package codebridge

import (
	"strings"

	"rk/build"
)

// Embedded returns the packaged rk-code-bridge VSIX and its VERSION sidecar
// from the build-time embed dir. An absent VSIX is a state, not an error: a
// dev build without the extension step has only .gitkeep in the embed dir,
// and callers skip the install with a note — ok=false, never a failure.
func Embedded() (vsix []byte, version string, ok bool) {
	data, err := build.CodeBridge.ReadFile("codebridge/rk-code-bridge.vsix")
	if err != nil {
		return nil, "", false
	}
	v, err := build.CodeBridge.ReadFile("codebridge/VERSION")
	if err != nil {
		return nil, "", false
	}
	return data, strings.TrimSpace(string(v)), true
}
