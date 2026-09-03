package inject

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Boot-readiness defaults — the field-proven settle heuristic values: a
// freshly spawned agent TUI is typed into only once its screen has stopped
// animating (or its hooks have stamped state), bounded well under a minute.
const (
	defaultReadyDeadline     = 25 * time.Second
	defaultReadyPollInterval = 600 * time.Millisecond
	// readyCaptureLines is the tail depth captured for the settle comparison —
	// enough to cover a full-height terminal's visible screen.
	readyCaptureLines = 50
	// readySnippetMaxRunes caps the last-capture fragment carried by ErrNotReady.
	readySnippetMaxRunes = 120
)

// ErrNotReady is the sentinel AwaitReady returns when neither readiness signal
// fires before the deadline. The wrapped message carries the last capture's
// trailing snippet so the caller can show what the pane looked like.
var ErrNotReady = errors.New("pane not boot-ready")

// Readiness reports which signal judged a pane boot-ready.
type Readiness int

const (
	// ReadyByState — the injected state reader returned a state (the pane's
	// hooks fired, so the TUI is up).
	ReadyByState Readiness = iota + 1
	// ReadyBySettle — the pane capture was non-blank and byte-identical across
	// two consecutive polls (the fallback for hook-less agents).
	ReadyBySettle
)

// ReadyOpts parameterize AwaitReady. The zero value is usable: Deadline
// defaults to 25s and PollInterval to 600ms.
type ReadyOpts struct {
	// State, when non-nil, is the caller's reconciled agent-state reader
	// (e.g. tmux.PaneAgentState). It MUST return "" for an absent or unknown
	// state; any non-empty, error-free value counts as present. Errors and
	// empty values mean "not yet" — never fatal — so a hook-less pane falls
	// through to the settle signal. inject deliberately does not import the
	// tmux state layer; the reader is injected here.
	State func(ctx context.Context, paneID, server string) (string, error)
	// Deadline bounds the whole wait. Zero = defaultReadyDeadline.
	Deadline time.Duration
	// PollInterval paces the signal checks. Zero = defaultReadyPollInterval.
	PollInterval time.Duration
	// Sleep is the test seam for the inter-poll wait. Nil = time.Sleep.
	Sleep func(time.Duration)
}

// AwaitReady blocks until the pane is boot-ready — safe to type into — polling
// two signals, first hit wins: state-present (opts.State, the preferred signal:
// hooks have fired, so the TUI finished booting) and capture-settle (the pane
// text is non-blank and unchanged across two consecutive polls; the fallback
// for hook-less agents). Capture errors are tolerated as "not yet" and bounded
// by the deadline like any other miss. On deadline the error wraps ErrNotReady
// with the last capture's trailing snippet; ctx cancellation returns ctx.Err().
//
// Settle caveat: a settled FIRST-RUN dialog can false-fire readiness — the
// subsequent delivery's echo probe is what catches that (ProbeFailure → the
// caller degrades), so readiness stays a cheap heuristic rather than a proof.
func AwaitReady(ctx context.Context, t Tmux, server, paneID string, opts ReadyOpts) (Readiness, error) {
	deadline := opts.Deadline
	if deadline <= 0 {
		deadline = defaultReadyDeadline
	}
	poll := opts.PollInterval
	if poll <= 0 {
		poll = defaultReadyPollInterval
	}
	sleep := opts.Sleep
	if sleep == nil {
		sleep = time.Sleep
	}
	stop := time.Now().Add(deadline)

	prev := ""
	havePrev := false
	lastCapture := ""
	for {
		if err := ctx.Err(); err != nil {
			return 0, err
		}
		if opts.State != nil {
			if state, err := opts.State(ctx, paneID, server); err == nil && state != "" {
				return ReadyByState, nil
			}
		}
		if cur, err := t.CapturePane(ctx, paneID, readyCaptureLines, server); err == nil {
			lastCapture = cur
			if havePrev && cur == prev && strings.TrimSpace(cur) != "" {
				return ReadyBySettle, nil
			}
			prev = cur
			havePrev = true
		}
		if !time.Now().Before(stop) {
			return 0, fmt.Errorf("%w after %s: last capture: %q", ErrNotReady, deadline, readySnippet(lastCapture))
		}
		sleep(poll)
	}
}

// DeliverWhenReady is the spawn-then-deliver composite: wait for boot
// readiness, then run the engine's verified send. It returns the Readiness on
// success and the first error otherwise (a readiness error returns the zero
// Readiness; a send error returns the readiness that fired).
func DeliverWhenReady(ctx context.Context, t Tmux, server, paneID, text string, submit bool, e *Engine, opts ReadyOpts) (Readiness, error) {
	readiness, err := AwaitReady(ctx, t, server, paneID, opts)
	if err != nil {
		return 0, err
	}
	if err := e.Send(ctx, t, server, paneID, text, submit); err != nil {
		return readiness, err
	}
	return readiness, nil
}

// readySnippet extracts the trailing fragment of a capture for the ErrNotReady
// message, rune-bounded. Pure.
func readySnippet(capture string) string {
	runes := []rune(strings.TrimSpace(capture))
	if len(runes) > readySnippetMaxRunes {
		runes = runes[len(runes)-readySnippetMaxRunes:]
	}
	return string(runes)
}
