package chat

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// parseString runs the tolerant parser over s and returns the parser (events +
// counters) for assertions.
func parseString(t *testing.T, s string) *parser {
	t.Helper()
	p := newParser()
	if _, err := p.consume(context.Background(), strings.NewReader(s)); err != nil {
		t.Fatalf("consume: %v", err)
	}
	return p
}

// TestFixtureParse pins the parser against the sanitized real-shape fixture.
func TestFixtureParse(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("testdata", "claude_session.jsonl"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	p := parseString(t, string(data))

	// Non-conversation lines, sidechain, thinking, unknown types all skipped:
	// the conversational events are text(u1) + text(a1) + tool_use(A) +
	// tool_result(A) + text(u2) + tool_use(B) + tool_result(B) + tool_use(ASK) = 8.
	if len(p.events) != 8 {
		t.Fatalf("event count = %d, want 8; events=%+v", len(p.events), p.events)
	}

	// No sidechain text leaked in.
	for _, e := range p.events {
		if strings.Contains(e.Text, "sidechain") {
			t.Errorf("sidechain event leaked: %+v", e)
		}
		if strings.Contains(e.Text, "hidden reasoning") {
			t.Errorf("thinking block leaked as text: %+v", e)
		}
	}

	// Turn accounting: first user (string content) opens turn 1; the
	// tool_result-carrier user message does NOT bump; second real user opens
	// turn 2. So the max turn seen is 2.
	maxTurn := 0
	for _, e := range p.events {
		if e.Turn > maxTurn {
			maxTurn = e.Turn
		}
	}
	if maxTurn != 2 {
		t.Errorf("max turn = %d, want 2", maxTurn)
	}

	// tool_result flatten: string form (toolu_A) and array form (toolu_B).
	var gotStringResult, gotArrayResult bool
	for _, e := range p.events {
		if e.Type == EventToolResult && e.ToolUseID == "toolu_A" {
			if e.ToolOutput != "SANITIZED file contents" {
				t.Errorf("string tool_result flatten = %q", e.ToolOutput)
			}
			gotStringResult = true
		}
		if e.Type == EventToolResult && e.ToolUseID == "toolu_B" {
			if e.ToolOutput != "SANITIZED line 1\nSANITIZED line 2" {
				t.Errorf("array tool_result flatten = %q", e.ToolOutput)
			}
			gotArrayResult = true
		}
	}
	if !gotStringResult || !gotArrayResult {
		t.Errorf("missing flattened tool_results: string=%v array=%v", gotStringResult, gotArrayResult)
	}

	// Pending: the AskUserQuestion tool_use is unpaired at the tail.
	pend := p.pending()
	if pend == nil {
		t.Fatal("expected a Pending for the unpaired AskUserQuestion tail")
	}
	if pend.ToolUseID != "toolu_ASK" || pend.ToolName != "AskUserQuestion" {
		t.Errorf("pending = %+v", pend)
	}
	if pend.Text != "SANITIZED which option do you prefer?" {
		t.Errorf("pending text = %q", pend.Text)
	}
}

// TestPendingNilWhenAllPaired: a transcript ending in text (all tools paired)
// yields no Pending.
func TestPendingNilWhenAllPaired(t *testing.T) {
	s := `{"type":"user","uuid":"u1","timestamp":"t","message":{"role":"user","content":"hi"}}
{"type":"assistant","uuid":"a1","timestamp":"t","message":{"role":"assistant","content":[{"type":"text","text":"done"}]}}
`
	p := parseString(t, s)
	if p.pending() != nil {
		t.Errorf("expected nil pending, got %+v", p.pending())
	}
}

// TestMalformedLineSkipped: a non-JSON line is counted and skipped, not fatal.
func TestMalformedLineSkipped(t *testing.T) {
	s := `{"type":"user","uuid":"u1","timestamp":"t","message":{"role":"user","content":"ok"}}
this is not json
{"type":"assistant","uuid":"a1","timestamp":"t","message":{"role":"assistant","content":[{"type":"text","text":"reply"}]}}
`
	p := parseString(t, s)
	if p.malformed != 1 {
		t.Errorf("malformed count = %d, want 1", p.malformed)
	}
	if len(p.events) != 2 {
		t.Errorf("event count = %d, want 2 (user text + assistant text)", len(p.events))
	}
}

// TestUnknownBlockAndLineSkipped: unknown block types and unknown line types are
// skipped without error.
func TestUnknownBlockAndLineSkipped(t *testing.T) {
	s := `{"type":"weird-line-type","uuid":"x"}
{"type":"assistant","uuid":"a1","timestamp":"t","message":{"role":"assistant","content":[{"type":"image","source":"..."},{"type":"text","text":"kept"}]}}
`
	p := parseString(t, s)
	if len(p.events) != 1 || p.events[0].Text != "kept" {
		t.Errorf("expected only the text event, got %+v", p.events)
	}
}

// TestPartialFinalLineHeld: consume() must not consume a trailing partial line
// (no newline) and must exclude its bytes from the returned count.
func TestPartialFinalLineHeld(t *testing.T) {
	complete := `{"type":"user","uuid":"u1","timestamp":"t","message":{"role":"user","content":"a"}}` + "\n"
	partial := `{"type":"assistant","uuid":"a1"` // no closing brace, no newline
	p := newParser()
	n, err := p.consume(context.Background(), strings.NewReader(complete+partial))
	if err != nil {
		t.Fatalf("consume: %v", err)
	}
	if n != int64(len(complete)) {
		t.Errorf("consumed %d bytes, want %d (partial line excluded)", n, len(complete))
	}
	if len(p.events) != 1 {
		t.Errorf("event count = %d, want 1 (partial line not parsed)", len(p.events))
	}
	// Feeding the completion of the partial line (plus newline) on a second
	// consume picks it up whole.
	rest := `,"timestamp":"t","message":{"role":"assistant","content":[{"type":"text","text":"b"}]}}` + "\n"
	n2, err := p.consume(context.Background(), strings.NewReader(partial+rest))
	if err != nil {
		t.Fatalf("consume 2: %v", err)
	}
	if n2 != int64(len(partial+rest)) {
		t.Errorf("consumed %d bytes on completion, want %d", n2, len(partial+rest))
	}
	if len(p.events) != 2 {
		t.Errorf("event count after completion = %d, want 2", len(p.events))
	}
}

// TestStrictUUIDGuard: a non-UUID ref is rejected before any filesystem access.
func TestStrictUUIDGuard(t *testing.T) {
	a := claudeAdapter{}
	bad := []string{
		"../../etc/passwd",
		"not-a-uuid",
		"5d80479e-8f25-46cd-a0d4-e51435508a", // too short
		"5d80479e_8f25_46cd_a0d4_e51435508a7g",
		"*",
		"",
		"5d80479e-8f25-46cd-a0d4-e51435508a37/..",
	}
	for _, ref := range bad {
		if _, err := a.Backfill(context.Background(), ref); err != ErrInvalidRef {
			t.Errorf("Backfill(%q) err = %v, want ErrInvalidRef", ref, err)
		}
		if _, err := a.Tail(context.Background(), ref); err != ErrInvalidRef {
			t.Errorf("Tail(%q) err = %v, want ErrInvalidRef", ref, err)
		}
		if _, err := locateTranscript(ref); err != ErrInvalidRef {
			t.Errorf("locateTranscript(%q) err = %v, want ErrInvalidRef", ref, err)
		}
	}
}

// TestTranscriptNotFound: a valid-UUID ref with no matching file returns
// ErrTranscriptNotFound (a missing transcript surfaces as a read error).
func TestTranscriptNotFound(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", dir)
	if err := os.MkdirAll(filepath.Join(dir, "projects", "someproj"), 0o755); err != nil {
		t.Fatal(err)
	}
	a := claudeAdapter{}
	ref := "5d80479e-8f25-46cd-a0d4-e51435508a37"
	if _, err := a.Backfill(context.Background(), ref); err != ErrTranscriptNotFound {
		t.Errorf("Backfill err = %v, want ErrTranscriptNotFound", err)
	}
}

// TestBackfillFromDisk: end-to-end backfill via CLAUDE_CONFIG_DIR resolves the
// glob and parses the fixture.
func TestBackfillFromDisk(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", dir)
	ref := "5d80479e-8f25-46cd-a0d4-e51435508a37"
	projDir := filepath.Join(dir, "projects", "someproj")
	if err := os.MkdirAll(projDir, 0o755); err != nil {
		t.Fatal(err)
	}
	fixture, err := os.ReadFile(filepath.Join("testdata", "claude_session.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(projDir, ref+".jsonl"), fixture, 0o644); err != nil {
		t.Fatal(err)
	}
	a := claudeAdapter{}
	conv, err := a.Backfill(context.Background(), ref)
	if err != nil {
		t.Fatalf("Backfill: %v", err)
	}
	if conv.Provider != providerClaude || conv.SessionRef != ref {
		t.Errorf("conv provider/ref = %q/%q", conv.Provider, conv.SessionRef)
	}
	if len(conv.Events) != 8 {
		t.Errorf("event count = %d, want 8", len(conv.Events))
	}
	if conv.Pending == nil || conv.Pending.ToolName != "AskUserQuestion" {
		t.Errorf("pending = %+v", conv.Pending)
	}
}

// TestTailInitialResetAndAppend: Tail emits an initial Reset (full backfill),
// then an Events update when the file grows; ctx cancel closes the channel.
func TestTailInitialResetAndAppend(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", dir)
	ref := "5d80479e-8f25-46cd-a0d4-e51435508a37"
	projDir := filepath.Join(dir, "projects", "someproj")
	if err := os.MkdirAll(projDir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(projDir, ref+".jsonl")
	initial := `{"type":"user","uuid":"u1","timestamp":"t","message":{"role":"user","content":"first"}}` + "\n"
	if err := os.WriteFile(path, []byte(initial), 0o644); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	a := claudeAdapter{}
	ch, err := a.Tail(ctx, ref)
	if err != nil {
		t.Fatalf("Tail: %v", err)
	}

	// First update: Reset with full backfill.
	first := recvUpdate(t, ch)
	if !first.Reset || first.Conv == nil {
		t.Fatalf("first update = %+v, want Reset with Conv", first)
	}
	if len(first.Conv.Events) != 1 {
		t.Errorf("initial backfill events = %d, want 1", len(first.Conv.Events))
	}

	// Append a complete line; expect an Events update.
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	appended := `{"type":"assistant","uuid":"a1","timestamp":"t","message":{"role":"assistant","content":[{"type":"text","text":"reply"}]}}` + "\n"
	if _, err := f.WriteString(appended); err != nil {
		t.Fatal(err)
	}
	f.Close()

	second := recvUpdate(t, ch)
	if second.Reset {
		t.Fatalf("second update unexpectedly Reset: %+v", second)
	}
	if len(second.Events) != 1 || second.Events[0].Text != "reply" {
		t.Errorf("append update events = %+v, want one 'reply' text event", second.Events)
	}

	// Cancel closes the channel.
	cancel()
	deadline := time.After(2 * time.Second)
	for {
		select {
		case _, ok := <-ch:
			if !ok {
				return // closed — success
			}
		case <-deadline:
			t.Fatal("channel not closed after cancel")
		}
	}
}

// TestTailShrinkResets: truncating the file below the offset triggers a Reset.
func TestTailShrinkResets(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", dir)
	ref := "5d80479e-8f25-46cd-a0d4-e51435508a37"
	projDir := filepath.Join(dir, "projects", "someproj")
	if err := os.MkdirAll(projDir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(projDir, ref+".jsonl")
	big := strings.Repeat(`{"type":"user","uuid":"u1","timestamp":"t","message":{"role":"user","content":"x"}}`+"\n", 3)
	if err := os.WriteFile(path, []byte(big), 0o644); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	a := claudeAdapter{}
	ch, err := a.Tail(ctx, ref)
	if err != nil {
		t.Fatalf("Tail: %v", err)
	}
	first := recvUpdate(t, ch)
	if !first.Reset {
		t.Fatalf("first update not Reset: %+v", first)
	}

	// Rewrite the file smaller (session /clear rewrite).
	small := `{"type":"user","uuid":"u2","timestamp":"t","message":{"role":"user","content":"fresh"}}` + "\n"
	if err := os.WriteFile(path, []byte(small), 0o644); err != nil {
		t.Fatal(err)
	}
	reset := recvUpdate(t, ch)
	if !reset.Reset || reset.Conv == nil {
		t.Fatalf("expected Reset after shrink, got %+v", reset)
	}
	if len(reset.Conv.Events) != 1 {
		t.Errorf("post-shrink backfill events = %d, want 1", len(reset.Conv.Events))
	}
}

// recvUpdate reads one Update with a timeout.
func recvUpdate(t *testing.T, ch <-chan Update) Update {
	t.Helper()
	select {
	case u, ok := <-ch:
		if !ok {
			t.Fatal("channel closed unexpectedly")
		}
		return u
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for update")
	}
	return Update{}
}

// TestLookupUnregistered: a well-formed but unregistered provider returns
// ErrNoAdapter; claude is registered.
func TestLookupUnregistered(t *testing.T) {
	if _, err := Lookup("codex"); err != ErrNoAdapter {
		t.Errorf("Lookup(codex) err = %v, want ErrNoAdapter", err)
	}
	if _, err := Lookup(""); err != ErrNoAdapter {
		t.Errorf("Lookup(\"\") err = %v, want ErrNoAdapter", err)
	}
	a, err := Lookup(providerClaude)
	if err != nil || a == nil {
		t.Errorf("Lookup(claude) = %v, %v; want a registered adapter", a, err)
	}
}
