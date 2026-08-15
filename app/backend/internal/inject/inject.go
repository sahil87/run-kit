// Package inject is the shared pane-injection engine extracted out of the
// chat-send HTTP handler (api/chat.go) so BOTH the daemon route and the CLI
// verb (`rk mux send`) drive one implementation: sanitize (at the caller's
// boundary) → named-buffer set-buffer → bracketed paste-buffer (-d -p) →
// NOVELTY echo probe → probe-gated Enter. All tmux access goes through the
// small Tmux interface so both consumers stay testable without a live tmux.
package inject

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

// Tmux is the tmux substrate the engine needs — four context-bound primitives.
// The daemon adapts its TmuxOps seam onto this (buffer name fixed to
// ChatSendBuffer); the CLI adapts internal/tmux's name-parameterized buffer
// functions (per-invocation buffer names).
type Tmux interface {
	CapturePane(ctx context.Context, paneID string, lines int, server string) (string, error)
	SetBuffer(ctx context.Context, name, text, server string) error
	PasteBuffer(ctx context.Context, name, paneID, server string) error
	SendEnter(ctx context.Context, paneID, server string) error
}

// Probe timing. A short settle lets the TUI redraw after the paste before the
// first echo capture; a bounded retry tolerates a slow redraw. The probe's own
// wall-clock worst case is settle + (attempts-1)*gap = 80 + 2*80 = 240ms; the
// caller threads ONE shared context deadline through the whole sequence, so the
// total cost stays bounded regardless. Package vars (not consts) SOLELY so
// tests can shrink them — production always uses these values.
var (
	ProbeSettle = 80 * time.Millisecond
	ProbeGap    = 80 * time.Millisecond
)

const (
	// ProbeAttempts bounds the echo-probe retry loop.
	ProbeAttempts = 3
	// ProbeCaptureLines is the tail depth captured for the echo probe — enough
	// to catch the pasted message even when the TUI input box wraps it across
	// several rows, without capturing the whole scrollback.
	ProbeCaptureLines = 40
	// NeedleMaxLen caps the probe needle length so an ~80-col TUI wrap cannot
	// split the fragment we look for; taken from the END of the last line (most
	// recently typed characters are the most reliable to have landed).
	NeedleMaxLen = 40
	// CollapseMinRunes is the single-line rune length at or above which the
	// paste-collapse placeholder is counted as a valid echo signal. Claude Code
	// collapses a single-line paste over 800 chars into a suffix-less
	// "[Pasted text #N]" chip (empirical, CC 2.1.215, INDEPENDENT of TUI width —
	// the observed threshold is 801). 200 is a deliberately conservative lower
	// bound so an upstream threshold reduction cannot silently rebreak
	// long-single-line sends, while short interactive sends (which never
	// collapse) keep exact-needle-only matching and so keep the narrowest
	// false-positive window.
	CollapseMinRunes = 200
)

// ProbeFailure is the sentinel error type for a failed echo probe — the pasted
// text did not echo into the pane's live input buffer within the retry budget,
// so Enter was withheld. Callers map it to their surface's recoverable-state
// signal (the HTTP handler's structured 409; the CLI's staged-text exit 1).
type ProbeFailure struct{}

func (ProbeFailure) Error() string {
	// The retry hint matters because the pasted text is left sitting in the
	// agent's composer (Enter was withheld, not the paste). An identical retry
	// would paste a SECOND copy on top of the first and submit doubled text — so
	// steer the user to check the terminal view before resending.
	return "agent input not ready — message pasted but not echoed; Enter withheld. " +
		"The text remains in the agent's input — check the terminal view before retrying, as a resend would duplicate it."
}

// Engine runs the injection sequence for ONE named-buffer owner, carrying the
// serialization state that owner needs:
//
//   - the per-(server, paneID) lock map serializes the WHOLE sequence per pane
//     (baseline capture → set → paste → probe → Enter), so a second send to the
//     same pane only begins after the first finished and can never merge two
//     pastes into one doubled submission. Entries are created on demand and
//     never evicted: the key space is bounded by the live pane set, and eviction
//     would reintroduce a drop-the-last-reference race.
//   - the set → paste critical-section mutex serializes the two-subprocess
//     window across ALL panes of this engine, because the named buffer is
//     shared by every send through it (A-set / B-set / A-paste would deliver B's
//     text to pane A). The daemon's single shared buffer needs this guard; the
//     CLI's per-invocation buffer (rk-send-<pid>) gets it for free and harmless.
//
// Distinct engines (distinct buffer owners) never share locks — the CLI's
// unique buffer needs no cross-process guard, and same-pane cross-process paste
// races are inherent to tmux and accepted.
//
// The Engine holds no Tmux: the substrate is passed per Send call, so one
// package-level engine can serve requests routed through per-Server (mocked)
// seams while keeping the lock domain process-wide — the serialization domain
// is the tmux server, not the Server value.
type Engine struct {
	buffer string

	locksMu    sync.Mutex
	paneLocks  map[string]*sync.Mutex
	setPasteMu sync.Mutex
}

// NewEngine returns an engine bound to a named buffer. The daemon passes
// tmux.ChatSendBuffer; the CLI passes its per-invocation rk-send-<pid> name.
func NewEngine(buffer string) *Engine {
	return &Engine{buffer: buffer, paneLocks: make(map[string]*sync.Mutex)}
}

// Buffer reports the engine's named buffer.
func (e *Engine) Buffer() string { return e.buffer }

// lockFor returns the mutex for a (server, paneID) pair, creating it on first
// use. The returned mutex is NOT locked — the caller Lock/Unlocks it.
func (e *Engine) lockFor(server, paneID string) *sync.Mutex {
	key := server + "\x00" + paneID
	e.locksMu.Lock()
	defer e.locksMu.Unlock()
	mu, ok := e.paneLocks[key]
	if !ok {
		mu = &sync.Mutex{}
		e.paneLocks[key] = mu
	}
	return mu
}

// Send runs the pane-targeted injection sequence (Constitution I — all argv
// slices, no shell strings, text as a discrete argv element via the named
// buffer): baseline capture → set-buffer → paste-buffer (-d -p, bracketed) →
// NOVELTY echo probe → send-keys Enter (only on probe success AND submit).
// Every step targets paneID, never the window, and shares the caller's ctx
// deadline. submit=false (insert-without-submit) skips ONLY the final
// SendEnter — baseline, set/paste, probe (a probe failure still returns
// ProbeFailure), locks, and the shared budget are unchanged — leaving the
// verified paste staged in the agent's input box.
//
// text MUST already be sanitized (see Sanitize) — both callers sanitize at
// their own boundary so the emptiness decision sees the cleaned text.
//
// The probe verifies NOVELTY, not mere presence: it counts the needle (and, for
// a COLLAPSIBLE paste, the paste-collapse placeholder) in a PRE-PASTE baseline
// capture and requires the count to strictly INCREASE after the paste. This is
// what makes the guard sound: a stale "[Pasted text #N …]" chip already
// in-frame (a prior probe failure leaves the pasted text in the composer) or a
// short/common needle like "y"/"ok" already on screen no longer
// false-positives the probe — only the CURRENT paste, which adds a fresh
// occurrence, satisfies it. If the pane scrolls between baseline and probe the
// count cannot rise, so it fails CLOSED (ProbeFailure, no blind Enter) — the
// exact hazard (blind Enter into e.g. a permission dialog) the probe exists to
// prevent.
//
// A tmux failure is returned verbatim; a probe failure is returned as
// ProbeFailure (Enter withheld).
func (e *Engine) Send(ctx context.Context, t Tmux, server, paneID, text string, submit bool) error {
	needle := Needle(text)
	if needle == "" {
		// Whitespace-only text is rejected upstream; a non-empty text always
		// yields a non-empty needle. Defensive: an empty needle means "cannot
		// verify", so fail closed BEFORE touching the buffer — never a blind Enter.
		return ProbeFailure{}
	}
	// The TUI can collapse a paste into a "[Pasted text #N …]" chip instead of
	// echoing the raw text — for MULTILINE text (a "+M lines" chip) OR for a long
	// single line (a suffix-less chip, empirically >800 chars). A paste is
	// "collapsible" when either is possible, and only then is the chip a valid
	// echo signal (see CollapseMinRunes). Short single-line pastes keep
	// exact-needle-only matching.
	collapsible := strings.Contains(text, "\n") || utf8.RuneCountInString(text) >= CollapseMinRunes

	// Serialize the WHOLE sequence per (server, paneID): a second send to the SAME
	// pane only begins after this one has fully finished (baseline → set → paste →
	// probe → Enter or probe failure), so it can never paste into a composer
	// already holding this send's in-flight paste (which would merge into one
	// doubled submission). Distinct panes run concurrently — each takes its own
	// lock.
	paneLock := e.lockFor(server, paneID)
	paneLock.Lock()
	defer paneLock.Unlock()

	// PRE-PASTE baseline: the occurrence count the probe must beat. Captured
	// BEFORE mutating the buffer so any stale needle/placeholder already in-frame
	// is included in the floor rather than mistaken for this paste's echo.
	baseline, err := t.CapturePane(ctx, paneID, ProbeCaptureLines, server)
	if err != nil {
		return fmt.Errorf("capture-pane (baseline): %w", err)
	}
	baseCount := CountOccurrences(baseline, needle, collapsible)

	// The set → paste critical section is additionally serialized across ALL panes
	// (setPasteMu) because the named buffer is shared by this engine; held only
	// for these two fast subprocesses. The probe below runs with only the per-pane
	// lock held.
	if err := e.setAndPaste(ctx, t, server, paneID, text); err != nil {
		return err
	}

	if err := e.probeEcho(ctx, t, server, paneID, needle, collapsible, baseCount); err != nil {
		return err
	}
	if !submit {
		// Insert-without-submit: the probe verified the paste landed; leave it
		// staged in the input box and send no Enter.
		return nil
	}
	if err := t.SendEnter(ctx, paneID, server); err != nil {
		return fmt.Errorf("send-keys: %w", err)
	}
	return nil
}

// setAndPaste runs the set-buffer → paste-buffer critical section under
// setPasteMu so two concurrent sends to DIFFERENT panes (each holding its own
// per-pane lock) cannot interleave on the shared named buffer as
// A-set / B-set / A-paste. See Engine.
func (e *Engine) setAndPaste(ctx context.Context, t Tmux, server, paneID, text string) error {
	e.setPasteMu.Lock()
	defer e.setPasteMu.Unlock()
	if err := t.SetBuffer(ctx, e.buffer, text, server); err != nil {
		return fmt.Errorf("set-buffer: %w", err)
	}
	if err := t.PasteBuffer(ctx, e.buffer, paneID, server); err != nil {
		return fmt.Errorf("paste-buffer: %w", err)
	}
	return nil
}

// probeEcho verifies the pasted text NEWLY echoed into the pane's live input
// buffer before Enter is committed. It waits a short settle, then captures the
// pane tail up to ProbeAttempts times (bounded retry with a small gap),
// returning nil on the first capture whose needle/placeholder occurrence count
// strictly exceeds baseCount (the pre-paste floor) — proof THIS paste added an
// occurrence, not that a stale one was already present. A tmux capture failure
// is returned verbatim (distinct from a clean probe miss); an exhausted retry
// returns ProbeFailure. All captures and sleeps share the caller's ctx
// deadline.
func (e *Engine) probeEcho(ctx context.Context, t Tmux, server, paneID, needle string, collapsible bool, baseCount int) error {
	for attempt := 0; attempt < ProbeAttempts; attempt++ {
		d := ProbeGap
		if attempt == 0 {
			d = ProbeSettle
		}
		// ctx-aware settle/gap: on caller cancellation or a shared deadline
		// firing, abort the probe promptly rather than sleeping out the full
		// interval before the next capture would notice the cancelled ctx.
		if err := sleepCtx(ctx, d); err != nil {
			return err
		}
		capture, err := t.CapturePane(ctx, paneID, ProbeCaptureLines, server)
		if err != nil {
			return fmt.Errorf("capture-pane: %w", err)
		}
		if CountOccurrences(capture, needle, collapsible) > baseCount {
			return nil
		}
	}
	return ProbeFailure{}
}

// sleepCtx sleeps for d but returns early with ctx.Err() if ctx is cancelled or
// its deadline fires first. Used by the echo probe so a client disconnect (or a
// shared injection deadline) aborts the settle/gap wait promptly instead of
// sleeping out the full interval. A ctx error propagates up as the injection
// error, never a false ProbeFailure.
func sleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// ansiEscapeRe matches the ANSI CSI / OSC escape sequences CapturePane preserves
// (it captures with -e). Stripped before probe matching so styling never breaks
// the echo check.
var ansiEscapeRe = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)`)

// pasteCollapseRe matches Claude Code's paste-collapse placeholder — the TUI
// replaces a larger bracketed paste with a chip rather than echoing the raw text,
// so the raw needle would never be found and the probe would fail exactly the
// collapsed case. There are TWO chip forms:
//   - multiline collapse:            "[Pasted text #N +M lines]"
//   - long single-line collapse:     "[Pasted text #N]" (NO "+M lines" suffix)
//
// The single-line collapse is a pure character-count threshold (empirically
// >800 chars on Claude Code 2.1.215, INDEPENDENT of TUI width — verified at
// 60/80/200 cols), NOT a wrap effect, so the suffix-less chip carries no line
// count. The placeholder counts as a SUCCESSFUL echo (the paste demonstrably
// reached the input buffer — the TUI only renders this chip for content it
// accepted) — but ONLY when the paste is COLLAPSIBLE (see CountOccurrences /
// CollapseMinRunes), and ONLY as a fresh occurrence vs the pre-paste baseline
// (a stale chip from a prior send is in the baseline count).
//
// The pattern matches the WHITESPACE-STRIPPED capture (stripForProbe removes all
// whitespace — spaces, tabs, newlines, etc.), i.e. "[Pastedtext#1+12lines]" or
// "[Pastedtext#5]"; the "+M lines" part
// is optional and tolerant of singular/plural "line"/"lines" and any digit counts.
var pasteCollapseRe = regexp.MustCompile(`\[Pastedtext#\d+(?:\+\d+lines?)?\]`)

// Sanitize strips terminal control bytes from a message before it is pasted
// into an agent pane. Bracketed paste makes ordinary text inert, but control
// bytes ride through verbatim — most sharply ESC (0x1B), which can embed the
// bracketed-paste-end sequence (ESC[201~) and turn the tail of the message into
// live keystrokes (the classic paste-injection break-out). Defense: normalize
// CR/CRLF to \n, then drop every control rune — unicode.IsControl covers C0
// (U+0000–U+001F), DEL (U+007F), and the C1 range (U+0080–U+009F, incl. the
// single-byte CSI U+009B) — EXCEPT \n and \t, which are legitimate message content
// (multiline messages and indented code). CR-normalization (rather than bare
// stripping) keeps a CRLF-origin multiline message's line structure so it still
// counts as multiline downstream.
func Sanitize(text string) string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	return strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' {
			return r
		}
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, text)
}

// Needle derives the echo-probe needle from the message text: the LAST
// non-empty line, whitespace-stripped and capped to the last NeedleMaxLen
// runes (so an ~80-col TUI wrap cannot split the fragment we look for). Returns
// "" only for whitespace-only text (rejected upstream).
func Needle(text string) string {
	lines := strings.Split(text, "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		stripped := stripForProbe(lines[i])
		if stripped == "" {
			continue
		}
		runes := []rune(stripped)
		if len(runes) > NeedleMaxLen {
			runes = runes[len(runes)-NeedleMaxLen:]
		}
		return string(runes)
	}
	return ""
}

// CountOccurrences counts how many times this paste's echo signal appears
// in the pane capture: the raw needle occurrences PLUS, when the paste is
// COLLAPSIBLE, the paste-collapse placeholder occurrences. Both the capture and
// the needle have ALL whitespace removed (stripForProbe) so a TUI wrap that
// inserts spaces/newlines mid-fragment (or a leading prompt glyph on the wrapped
// row) cannot defeat the match.
//
// The engine compares this count against a pre-paste BASELINE and requires a
// strict increase, so a stale needle/placeholder already in-frame is a floor to
// beat rather than a false positive. The collapsible gate matters: `collapsible`
// means the TUI may have collapsed THIS paste into a chip (multiline text, or a
// single line long enough to collapse — CollapseMinRunes), so the chip is
// a valid fresh-echo signal; a short single-line paste never collapses, so
// counting the chip for it would only widen the concurrent-fresh-chip
// false-positive window. A short/common single-line needle ("y", "ok") could
// substring-match unrelated stale content, but that content is in the baseline
// too — the caller's strict-increase requirement, not this counter, is what makes
// short needles fail closed against stale content.
func CountOccurrences(capture, needle string, collapsible bool) int {
	stripped := stripForProbe(capture)
	n := strings.Count(stripped, needle)
	if collapsible {
		n += len(pasteCollapseRe.FindAllString(stripped, -1))
	}
	return n
}

// stripForProbe normalizes a string for echo matching: strip ANSI escapes, then
// remove ALL whitespace (spaces, tabs, newlines). Wrap-safe by construction.
func stripForProbe(s string) string {
	s = ansiEscapeRe.ReplaceAllString(s, "")
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if r == ' ' || r == '\t' || r == '\n' || r == '\r' || r == '\v' || r == '\f' {
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}
