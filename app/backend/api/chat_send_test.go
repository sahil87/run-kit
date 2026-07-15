package api

import (
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"rk/internal/sessions"
	"rk/internal/tmux"
)

// fastChatSendProbe shrinks the probe settle/gap so the retry loop runs quickly
// under test, restoring the production values after.
func fastChatSendProbe(t *testing.T) {
	t.Helper()
	ps, pg := chatSendProbeSettle, chatSendProbeGap
	chatSendProbeSettle = time.Millisecond
	chatSendProbeGap = time.Millisecond
	t.Cleanup(func() { chatSendProbeSettle, chatSendProbeGap = ps, pg })
}

// sendReq builds a POST /chat/send request for window @1 with the given body.
func sendReq(body string) *http.Request {
	return sendReqFor("@1", body)
}

// sendReqFor builds a POST /chat/send request for the given window with the given
// body — used by the cross-pane concurrency test, which drives two windows.
func sendReqFor(windowID, body string) *http.Request {
	return httptest.NewRequest(http.MethodPost, "/api/windows/"+windowID+"/chat/send", strings.NewReader(body))
}

// twoChatWindows is a two-window session fixture: @1 → pane %1, @2 → pane %2,
// both chat-capable. Used by the cross-pane concurrency test to prove distinct
// panes serialize independently (only the shared-buffer set → paste subsequence
// is globally ordered, everything else runs concurrently).
func twoChatWindows() []sessions.ProjectSession {
	return []sessions.ProjectSession{
		{Name: "s", Windows: []tmux.WindowInfo{
			{WindowID: "@1", ChatProvider: "claude", ChatSessionRef: testChatRef,
				Panes: []tmux.PaneInfo{{PaneID: "%1", IsActive: true, ChatProvider: "claude", ChatSessionRef: testChatRef}}},
			{WindowID: "@2", ChatProvider: "claude", ChatSessionRef: testChatRef,
				Panes: []tmux.PaneInfo{{PaneID: "%2", IsActive: true, ChatProvider: "claude", ChatSessionRef: testChatRef}}},
		}},
	}
}

// TestChatSendSuccess: a paste whose text NEWLY echoes into the capture (the
// pre-paste baseline lacks it, the post-paste capture has it) sends Enter and
// returns 200 — and the injection runs in the exact order capture-pane (baseline)
// → set-buffer → paste-buffer → capture-pane (probe) → send-keys, all targeting
// the resolved PaneID.
func TestChatSendSuccess(t *testing.T) {
	fastChatSendProbe(t)
	sf := &mockSessionFetcher{result: chatSessions("@1", "claude", testChatRef)}
	// [0] baseline (no echo yet) → [1] post-paste (echo present) — a strict count
	// increase, so the probe passes.
	ops := &mockTmuxOps{capturePaneResults: []string{"❯ ", "❯ hello world"}}
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, sendReq(`{"text":"hello world"}`))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	want := []string{"capture-pane", "set-buffer", "paste-buffer", "capture-pane", "send-keys"}
	if strings.Join(ops.chatCalls, ",") != strings.Join(want, ",") {
		t.Errorf("injection order = %v, want %v", ops.chatCalls, want)
	}
	if ops.setChatBufferText != "hello world" {
		t.Errorf("buffer text = %q, want %q", ops.setChatBufferText, "hello world")
	}
	if ops.pasteChatPaneID != "%1" || ops.sendEnterPaneID != "%1" {
		t.Errorf("injection targeted paste=%q enter=%q, want the resolved pane %%1", ops.pasteChatPaneID, ops.sendEnterPaneID)
	}
}

// TestChatSendMultilineAndSpecialChars: multiline text with tmux-key-name-like
// content is stored verbatim as one buffer argv element; the probe matches the
// wrapped last line and Enter is sent once.
func TestChatSendMultilineAndSpecialChars(t *testing.T) {
	fastChatSendProbe(t)
	text := "line one with C-c\nplease run: echo Enter"
	sf := &mockSessionFetcher{result: chatSessions("@1", "claude", testChatRef)}
	// [0] baseline (no echo) → [1] the pasted last line lands wrapped across two
	// capture rows with a prompt glyph — the wrap-safe needle must still match as a
	// fresh occurrence.
	ops := &mockTmuxOps{capturePaneResults: []string{"❯ ", "❯ please run: echo\n  Enter"}}
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, sendReq(`{"text":"line one with C-c\nplease run: echo Enter"}`))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if ops.setChatBufferText != text {
		t.Errorf("buffer text = %q, want verbatim %q", ops.setChatBufferText, text)
	}
	if !ops.sendEnterCalled {
		t.Error("Enter was not sent on a matching wrapped echo")
	}
}

// TestChatSendLeadingDashText: a message that begins with a dash
// ("--force is broken") must reach SetChatSendBuffer verbatim and inject in full
// (200) — never be mangled or rejected at the handler layer. The `--` option
// terminator that makes tmux treat such text as positional buffer data (not
// flags) lives in tmux.SetChatSendBuffer, below the TmuxOps seam; the handler's
// contract is that the raw text passes through untouched. The live round-trip
// that proves the `--` terminator itself is TestSetChatSendBuffer_LeadingDash in
// internal/tmux.
func TestChatSendLeadingDashText(t *testing.T) {
	fastChatSendProbe(t)
	const text = "--force is broken"
	sf := &mockSessionFetcher{result: chatSessions("@1", "claude", testChatRef)}
	ops := &mockTmuxOps{capturePaneResults: []string{"❯ ", "❯ --force is broken"}}
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, sendReq(`{"text":"--force is broken"}`))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if ops.setChatBufferText != text {
		t.Errorf("buffer text = %q, want verbatim %q (leading dash must not be mangled)", ops.setChatBufferText, text)
	}
	want := []string{"capture-pane", "set-buffer", "paste-buffer", "capture-pane", "send-keys"}
	if strings.Join(ops.chatCalls, ",") != strings.Join(want, ",") {
		t.Errorf("injection order = %v, want %v", ops.chatCalls, want)
	}
}

// TestChatSendProbeFailureWithholdsEnter: the pasted text never appears in the
// capture across all retries → 409 (structured), and NO send-keys Enter is sent.
func TestChatSendProbeFailureWithholdsEnter(t *testing.T) {
	fastChatSendProbe(t)
	sf := &mockSessionFetcher{result: chatSessions("@1", "claude", testChatRef)}
	ops := &mockTmuxOps{capturePaneResult: "some unrelated pane output"}
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, sendReq(`{"text":"hello world"}`))

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
	if ops.sendEnterCalled {
		t.Error("Enter was sent despite a failed probe (must be withheld)")
	}
	// One pre-paste baseline capture + the full bounded probe retry.
	if want := 1 + chatSendProbeAttempts; ops.capturePaneCalls != want {
		t.Errorf("capture attempts = %d, want %d (baseline + full bounded retry)", ops.capturePaneCalls, want)
	}
	if !strings.Contains(rec.Body.String(), "Enter withheld") {
		t.Errorf("409 body = %s, want the structured probe error", rec.Body.String())
	}
	// The retry hint steers the user to the terminal view before resending (the
	// pasted text is still in the composer — a naive retry would double it).
	if !strings.Contains(rec.Body.String(), "before retrying") {
		t.Errorf("409 body = %s, want the retry hint", rec.Body.String())
	}
}

// TestChatSendProbeRetryThenSuccess: the echo lands on a LATER retry (not the
// first probe capture) — Enter is still sent and the result is 200.
func TestChatSendProbeRetryThenSuccess(t *testing.T) {
	fastChatSendProbe(t)
	sf := &mockSessionFetcher{result: chatSessions("@1", "claude", testChatRef)}
	// [0] baseline (no echo) → [1] first probe (still redrawing, no echo) → [2]
	// second probe (the text has landed).
	ops := &mockTmuxOps{capturePaneResults: []string{"❯ ", "(redrawing…)", "❯ hello world"}}
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, sendReq(`{"text":"hello world"}`))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	// 1 baseline + 2 probe captures (matched on the second probe).
	if ops.capturePaneCalls != 3 {
		t.Errorf("capture attempts = %d, want 3 (baseline + matched on the second probe)", ops.capturePaneCalls)
	}
	if !ops.sendEnterCalled {
		t.Error("Enter not sent after a successful later-retry probe")
	}
}

// TestChatSendEmptyText: empty / whitespace-only text is rejected 400 with no
// injection.
func TestChatSendEmptyText(t *testing.T) {
	for _, body := range []string{`{"text":""}`, `{"text":"   \n\t  "}`} {
		sf := &mockSessionFetcher{result: chatSessions("@1", "claude", testChatRef)}
		ops := &mockTmuxOps{}
		router := NewTestRouter(slog.Default(), sf, ops, "host")

		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, sendReq(body))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("body %q: status = %d, want 400", body, rec.Code)
		}
		if len(ops.chatCalls) != 0 {
			t.Errorf("body %q: injection ran (%v) for empty text", body, ops.chatCalls)
		}
	}
}

// TestChatSendInvalidJSON: an undecodable body is a 400 with no injection.
func TestChatSendInvalidJSON(t *testing.T) {
	sf := &mockSessionFetcher{result: chatSessions("@1", "claude", testChatRef)}
	ops := &mockTmuxOps{}
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, sendReq(`{not json`))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	if len(ops.chatCalls) != 0 {
		t.Errorf("injection ran (%v) on a bad body", ops.chatCalls)
	}
}

// TestChatSendInvalidWindowID: a malformed window id is a 400.
func TestChatSendInvalidWindowID(t *testing.T) {
	sf := &mockSessionFetcher{result: chatSessions("@1", "claude", testChatRef)}
	ops := &mockTmuxOps{}
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	req := httptest.NewRequest(http.MethodPost, "/api/windows/not-a-window/chat/send", strings.NewReader(`{"text":"hi"}`))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

// TestChatSendNoChat: a window with no reconciled chat is a 404 with no injection.
func TestChatSendNoChat(t *testing.T) {
	sf := &mockSessionFetcher{result: []sessions.ProjectSession{
		{Name: "s", Windows: []tmux.WindowInfo{{WindowID: "@1"}}},
	}}
	ops := &mockTmuxOps{}
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, sendReq(`{"text":"hi"}`))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	if len(ops.chatCalls) != 0 {
		t.Errorf("injection ran (%v) with no chat pane", ops.chatCalls)
	}
}

// TestChatSendFetchError: a FetchSessions failure is a 500 (infrastructure
// fault), NOT a 404 — mirroring the read endpoints.
func TestChatSendFetchError(t *testing.T) {
	sf := &mockSessionFetcher{err: errors.New("tmux exploded")}
	ops := &mockTmuxOps{}
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, sendReq(`{"text":"hi"}`))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}

// TestChatSendPasteFailure: a tmux paste-buffer failure is a 500 (a tmux fault,
// not a probe miss) and no Enter is sent.
func TestChatSendPasteFailure(t *testing.T) {
	sf := &mockSessionFetcher{result: chatSessions("@1", "claude", testChatRef)}
	ops := &mockTmuxOps{pasteChatBufferErr: errors.New("paste failed")}
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, sendReq(`{"text":"hi"}`))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
	if ops.sendEnterCalled {
		t.Error("Enter sent despite a paste failure")
	}
}

// TestChatSendCaptureFailure: a capture-pane subprocess failure (the baseline
// capture here — capturePaneErr fails every capture) is a 500 (distinct from a
// clean probe miss → 409) and no Enter is sent.
func TestChatSendCaptureFailure(t *testing.T) {
	fastChatSendProbe(t)
	sf := &mockSessionFetcher{result: chatSessions("@1", "claude", testChatRef)}
	ops := &mockTmuxOps{capturePaneErr: errors.New("capture failed")}
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, sendReq(`{"text":"hi"}`))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
	if ops.sendEnterCalled {
		t.Error("Enter sent despite a capture failure")
	}
}

// TestChatSendStaleEchoNoBlindEnter: the exact hazard the novelty probe closes —
// a stale occurrence of the needle (or a paste-collapse chip) already in the
// pane BEFORE this paste must NOT satisfy the probe. Presence alone would blind-
// Enter into e.g. a permission dialog; only a fresh occurrence (count increase)
// counts. Both stale-content shapes 409 with Enter withheld.
func TestChatSendStaleEchoNoBlindEnter(t *testing.T) {
	cases := []struct {
		name    string
		body    string
		capture string // returned for EVERY capture (baseline == probe → no increase)
	}{
		{
			// Short/common single-line needle ("ok") already on screen from prior
			// output. chatProbeNeedle has no distinctiveness floor, so presence
			// matching would false-positive; the baseline floor makes it fail closed.
			name:    "short needle already present",
			body:    `{"text":"ok"}`,
			capture: "❯ ok\nsome earlier line that says ok too",
		},
		{
			// A stale "[Pasted text #N +M lines]" chip already in-frame (this very
			// handler's 409 path leaves the pasted text in the composer). A multiline
			// send whose raw text does not echo must not ride the stale chip.
			name:    "stale paste-collapse chip present",
			body:    `{"text":"first line\nsecond line that will not echo raw"}`,
			capture: "❯ [Pasted text #1 +7 lines]",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fastChatSendProbe(t)
			sf := &mockSessionFetcher{result: chatSessions("@1", "claude", testChatRef)}
			ops := &mockTmuxOps{capturePaneResult: tc.capture}
			router := NewTestRouter(slog.Default(), sf, ops, "host")

			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, sendReq(tc.body))

			if rec.Code != http.StatusConflict {
				t.Fatalf("status = %d, want 409 (stale content must not pass the probe); body=%s", rec.Code, rec.Body.String())
			}
			if ops.sendEnterCalled {
				t.Error("Enter was sent on stale (non-novel) content — blind-Enter hazard")
			}
		})
	}
}

// TestChatSendMultilinePlaceholderNovelty: a multiline paste that the TUI
// collapses into a FRESH "[Pasted text #N +M lines]" chip (absent from the
// baseline, present after) is a legitimate echo → 200, Enter sent.
func TestChatSendMultilinePlaceholderNovelty(t *testing.T) {
	fastChatSendProbe(t)
	sf := &mockSessionFetcher{result: chatSessions("@1", "claude", testChatRef)}
	// [0] baseline (no chip) → [1] the collapse chip appears (fresh occurrence).
	ops := &mockTmuxOps{capturePaneResults: []string{"❯ ", "❯ [Pasted text #1 +12 lines]"}}
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, sendReq(`{"text":"a multiline\nmessage that\ncollapses into a chip"}`))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if !ops.sendEnterCalled {
		t.Error("Enter not sent on a fresh paste-collapse chip (valid multiline echo)")
	}
}

// TestChatSendSharedDeadlineAborts: the whole injection sequence shares ONE
// context deadline (chatSendTotalBudget). When it is tiny and a tmux subprocess
// (the baseline capture here) respects ctx cancellation, the sequence aborts as
// a 500 rather than blocking the route — proving the deadline threads through.
func TestChatSendSharedDeadlineAborts(t *testing.T) {
	orig := chatSendTotalBudget
	chatSendTotalBudget = time.Millisecond
	t.Cleanup(func() { chatSendTotalBudget = orig })

	sf := &mockSessionFetcher{result: chatSessions("@1", "claude", testChatRef)}
	// The baseline CapturePane blocks until the shared ctx is cancelled, then
	// returns ctx.Err() — the same shape a real ctx-bound tmux exec returns when
	// the deadline fires. Proves the handler's derived deadline reaches the
	// subprocess and short-circuits the sequence.
	ops := &mockTmuxOps{capturePaneCtxAware: true}
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, sendReq(`{"text":"hello world"}`))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (deadline abort); body=%s", rec.Code, rec.Body.String())
	}
	if ops.sendEnterCalled {
		t.Error("Enter sent despite a deadline abort")
	}
}

// TestChatSendConcurrentSamePaneWholeSequence: two concurrent sends to the SAME
// pane must not interleave AT ALL — the per-(server,paneID) lock serializes the
// WHOLE injection (baseline → set → paste → probe → Enter), so the second send
// only begins after the first has completely finished. Two same-pane sends racing
// the same composer that each pasted before either probed+Entered would merge into
// one doubled submission; whole-sequence serialization closes that window.
//
// The recorded call stream is asserted to be TWO contiguous, non-overlapping
// per-send blocks (block1 fully, then block2). Any interleave would break the
// exact concatenation. Run under `go test -race` this also proves no data race.
func TestChatSendConcurrentSamePaneWholeSequence(t *testing.T) {
	fastChatSendProbe(t)
	sf := &mockSessionFetcher{result: chatSessions("@1", "claude", testChatRef)}
	// Every capture (baseline + probe) returns the same stale content — no probe
	// ever sees a strict count increase, so both requests 409 deterministically.
	// A 409 send's block is a fixed shape regardless of which goroutine wins, so
	// the two blocks are byte-identical and any interleave is detectable by exact
	// concatenation.
	ops := &mockTmuxOps{capturePaneResult: "❯ stale unrelated line"}
	// A hook inside SetChatSendBuffer sleeps WHILE this send holds the pane lock,
	// widening the window for the other send to slip in. With the whole-sequence
	// per-pane lock it cannot: the second send blocks on the pane lock before its
	// baseline capture even starts.
	ops.setChatBufferHook = func(string) { time.Sleep(5 * time.Millisecond) }

	router := NewTestRouter(slog.Default(), sf, ops, "host")

	var wg sync.WaitGroup
	for _, txt := range []string{"alpha message", "bravo message"} {
		wg.Add(1)
		go func(text string) {
			defer wg.Done()
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, sendReq(`{"text":"`+text+`"}`))
			if rec.Code != http.StatusConflict {
				t.Errorf("text %q: status = %d, want 409; body=%s", text, rec.Code, rec.Body.String())
			}
		}(txt)
	}
	wg.Wait()

	ops.chatMu.Lock()
	calls := append([]string(nil), ops.chatCalls...)
	texts := append([]string(nil), ops.setChatBufferTexts...)
	ops.chatMu.Unlock()

	// One 409 send's block: baseline capture, set, paste, then chatSendProbeAttempts
	// probe captures (no send-keys — Enter withheld). Whole-sequence serialization
	// ⇒ the full stream is exactly block ++ block (no interleave).
	oneBlock := []string{"capture-pane", "set-buffer", "paste-buffer"}
	for i := 0; i < chatSendProbeAttempts; i++ {
		oneBlock = append(oneBlock, "capture-pane")
	}
	want := append(append([]string(nil), oneBlock...), oneBlock...)
	if strings.Join(calls, ",") != strings.Join(want, ",") {
		t.Fatalf("same-pane sends interleaved — call stream = %v,\n want two contiguous blocks %v", calls, want)
	}
	// Both distinct texts were set (each send ran its own full sequence).
	if len(texts) != 2 || !((texts[0] == "alpha message" && texts[1] == "bravo message") ||
		(texts[0] == "bravo message" && texts[1] == "alpha message")) {
		t.Errorf("set-buffer texts = %v, want the two distinct messages", texts)
	}
}

// TestChatSendConcurrentCrossPaneBufferAtomic: two concurrent sends to DIFFERENT
// panes (%1, %2) run concurrently — only the shared server-wide named buffer's
// set → paste subsequence is globally serialized (chatSetPasteMu). In the recorded
// stream, every set-buffer is immediately followed by its OWN paste-buffer (the
// set/paste subsequence is well-nested, never set,set,…), proving no
// A-set / B-set / A-paste buffer-crossing race across panes. Run under
// `go test -race` this also proves no data race.
func TestChatSendConcurrentCrossPaneBufferAtomic(t *testing.T) {
	fastChatSendProbe(t)
	sf := &mockSessionFetcher{result: twoChatWindows()}
	// Deterministic 409 on both (shared stale capture); the point is the
	// well-nested set/paste stream, not the probe verdict.
	ops := &mockTmuxOps{capturePaneResult: "❯ stale unrelated line"}
	// The hook sleeps inside the set → paste critical section (held under the
	// global chatSetPasteMu); if that mutex were absent the other pane's send would
	// slip its set-buffer in during the sleep, producing set,set,…,paste,paste.
	ops.setChatBufferHook = func(string) { time.Sleep(5 * time.Millisecond) }

	router := NewTestRouter(slog.Default(), sf, ops, "host")

	var wg sync.WaitGroup
	for _, tc := range []struct{ window, text string }{
		{"@1", "alpha message"},
		{"@2", "bravo message"},
	} {
		wg.Add(1)
		go func(window, text string) {
			defer wg.Done()
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, sendReqFor(window, `{"text":"`+text+`"}`))
			if rec.Code != http.StatusConflict {
				t.Errorf("window %s text %q: status = %d, want 409; body=%s", window, text, rec.Code, rec.Body.String())
			}
		}(tc.window, tc.text)
	}
	wg.Wait()

	ops.chatMu.Lock()
	calls := append([]string(nil), ops.chatCalls...)
	paneIDs := append([]string(nil), ops.pasteChatPaneIDs...)
	ops.chatMu.Unlock()

	// The set/paste subsequence must be well-nested across panes: a set-buffer is
	// always immediately followed by a paste-buffer (never two sets in a row).
	inCritical := false
	for _, c := range calls {
		switch c {
		case "set-buffer":
			if inCritical {
				t.Fatalf("two set-buffers with no intervening paste-buffer — cross-pane buffer crossing: %v", calls)
			}
			inCritical = true
		case "paste-buffer":
			if !inCritical {
				t.Fatalf("paste-buffer with no preceding set-buffer: %v", calls)
			}
			inCritical = false
		}
	}
	if inCritical {
		t.Fatalf("a set-buffer never reached its paste-buffer: %v", calls)
	}
	// Both panes were pasted into (distinct pane targets, concurrent sequences).
	if len(paneIDs) != 2 {
		t.Fatalf("paste pane IDs = %v, want exactly 2", paneIDs)
	}
	if !((paneIDs[0] == "%1" && paneIDs[1] == "%2") || (paneIDs[0] == "%2" && paneIDs[1] == "%1")) {
		t.Errorf("paste pane IDs = %v, want the two distinct panes %%1 and %%2", paneIDs)
	}
}

// TestChatSendKeysEndpointUntouched: the generic /keys endpoint still uses the
// window-targeted SendKeys with a trailing Enter and is unaffected by chat-send.
func TestChatSendKeysEndpointUntouched(t *testing.T) {
	sf := &mockSessionFetcher{result: chatSessions("@1", "claude", testChatRef)}
	ops := &mockTmuxOps{}
	router := NewTestRouter(slog.Default(), sf, ops, "host")

	req := httptest.NewRequest(http.MethodPost, "/api/windows/@1/keys", strings.NewReader(`{"keys":"ls"}`))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if !ops.sendKeysCalled || ops.sendKeysWindowID != "@1" || ops.sendKeysKeys != "ls" {
		t.Errorf("SendKeys not called window-targeted: called=%v id=%q keys=%q", ops.sendKeysCalled, ops.sendKeysWindowID, ops.sendKeysKeys)
	}
	// chat-send injection primitives must NOT have fired for /keys.
	if len(ops.chatCalls) != 0 {
		t.Errorf("chat-send primitives fired for /keys: %v", ops.chatCalls)
	}
}

// --- pure probe-matcher tests (R5) ------------------------------------------

func TestChatProbeNeedle(t *testing.T) {
	tests := []struct {
		name string
		text string
		want string
	}{
		{"single line", "hello world", "helloworld"},
		{"last non-empty line wins", "first\nsecond line\n\n", "secondline"},
		{"length-capped from the end", strings.Repeat("a", 100), strings.Repeat("a", chatSendNeedleMaxLen)},
		{"whitespace stripped", "  spaced   out  ", "spacedout"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := chatProbeNeedle(tt.text); got != tt.want {
				t.Errorf("chatProbeNeedle(%q) = %q, want %q", tt.text, got, tt.want)
			}
		})
	}
}

// TestCountProbeOccurrences exercises the occurrence-COUNTING matcher directly.
// The handler compares a pre-paste baseline count against a post-paste count and
// requires a strict increase; these cases pin the counting rules (raw needle,
// multiline-gated placeholder, ANSI/whitespace normalization) the comparison
// rests on.
func TestCountProbeOccurrences(t *testing.T) {
	needle := chatProbeNeedle("please run the tests")
	tests := []struct {
		name      string
		capture   string
		multiline bool
		want      int
	}{
		{"echo present once", "❯ please run the tests", false, 1},
		{"echo absent", "unrelated scrollback\n❯ ", false, 0},
		{"echo present twice", "❯ please run the tests\n❯ please run the tests", false, 2},
		// A TUI wrap splits the fragment across two rows with a leading prompt
		// glyph on the continuation — whitespace-stripping keeps the (one) match.
		{"wrapped across rows", "❯ please run the\n  tests", false, 1},
		// ANSI-styled input (CapturePane keeps escapes with -e) is stripped first.
		{"ansi-styled echo", "\x1b[1m❯\x1b[0m please run \x1b[32mthe tests\x1b[0m", false, 1},
		// Placeholder counts ONLY for multiline text (single-line pastes never
		// collapse). Same capture, opposite gate:
		{"placeholder counted when multiline", "❯ [Pasted text #1 +12 lines]", true, 1},
		{"placeholder ignored when single-line", "❯ [Pasted text #1 +12 lines]", false, 0},
		// Singular "line" + a leading prompt glyph still counts (multiline).
		{"placeholder singular line", "❯ [Pasted text #3 +1 line]", true, 1},
		// ANSI-styled placeholder is stripped before matching (multiline).
		{"ansi-styled placeholder", "\x1b[2m[Pasted text #2 +40 lines]\x1b[0m", true, 1},
		// Two chips → two placeholder occurrences (multiline).
		{"two placeholders", "[Pasted text #1 +2 lines]\n[Pasted text #2 +3 lines]", true, 2},
		// A partial / malformed chip (no "+M lines" tail) is NOT counted — only a
		// genuine paste-collapse placeholder, never arbitrary bracketed text.
		{"non-placeholder bracketed text", "❯ [some other note]", true, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := countProbeOccurrences(tt.capture, needle, tt.multiline); got != tt.want {
				t.Errorf("countProbeOccurrences(%q, %q, multiline=%v) = %d, want %d", tt.capture, needle, tt.multiline, got, tt.want)
			}
		})
	}
}

// TestCountProbeOccurrences_ShortNeedleFailsClosed: a short/common single-line
// needle ("y", "ok") substring-matches stale content, but because the baseline
// count already includes those stale occurrences and the handler requires a
// STRICT increase, a paste that adds no fresh occurrence fails closed. This test
// pins the count semantics the fails-closed guarantee depends on: identical
// baseline and post captures yield equal counts (post NOT > baseline).
func TestCountProbeOccurrences_ShortNeedleFailsClosed(t *testing.T) {
	for _, needle := range []string{"y", "ok"} {
		// Stale content already contains the short needle several times.
		stale := "history: y\nok done\nanother y here\nok"
		baseCount := countProbeOccurrences(stale, needle, false)
		if baseCount == 0 {
			t.Fatalf("needle %q: expected the short needle to appear in stale content", needle)
		}
		// A paste that does not echo leaves the same content → same count → not a
		// strict increase → the handler's probe fails closed (no blind Enter).
		postCount := countProbeOccurrences(stale, needle, false)
		if postCount > baseCount {
			t.Errorf("needle %q: post %d > baseline %d — a non-echoing paste would spuriously pass", needle, postCount, baseCount)
		}
	}
}
