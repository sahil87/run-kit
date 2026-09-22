// Package ghprobe answers one question — is the `gh` CLI installed AND
// authenticated — for every package that needs it before spending a
// subprocess. It is the single source of that probe, shared by the PR-status
// collector (internal/prstatus) and the PR-review detail fetcher
// (internal/prreview), so the two can never drift on what "gh is unavailable"
// means.
//
// Stdlib-only by design: both importers sit at the same layer, so this package
// must pull in no rk/internal package.
package ghprobe

import (
	"context"
	"os/exec"
	"time"
)

// Available reports whether gh is installed and logged in. Either failing is a
// silent no-op for every caller (the `command -v rk` fail-silent posture), so
// this returns a plain bool rather than distinguishing the two.
//
// `timeout` bounds the auth check; the caller supplies its own gh budget
// because the two collectors run on very different cadences.
func Available(ctx context.Context, timeout time.Duration) bool {
	if _, err := exec.LookPath("gh"); err != nil {
		return false
	}
	authCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	// `gh auth status` exits non-zero when not logged in.
	return exec.CommandContext(authCtx, "gh", "auth", "status").Run() == nil
}
