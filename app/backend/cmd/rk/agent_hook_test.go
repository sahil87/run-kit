package main

import (
	"context"
	"io"
	"strings"
	"testing"
)

// fakeProc models a process tree for the ancestor-walk tests: pid → (comm, ppid).
type fakeProc struct {
	comm string
	ppid int
}

// installFakeProcTree points the process-inspection seams at an in-memory tree so
// resolveAgentPID can be tested without spawning real ancestor chains. It returns
// a restore func for the test to defer.
func installFakeProcTree(t *testing.T, tree map[int]fakeProc) {
	t.Helper()
	origComm, origPPID := processCommFn, processPPIDFn
	processCommFn = func(_ context.Context, pid int) string {
		if p, ok := tree[pid]; ok {
			return p.comm
		}
		return ""
	}
	processPPIDFn = func(_ context.Context, pid int) int {
		if p, ok := tree[pid]; ok {
			return p.ppid
		}
		return 0
	}
	t.Cleanup(func() {
		processCommFn, processPPIDFn = origComm, origPPID
	})
}

func TestResolveAgentPIDWalksToAgentAncestor(t *testing.T) {
	// Chain: rk(100) → sh(101) → hook-shell(102) → claude(103) → login-shell(104)
	// The walk starts at the parent (101) and must climb to the claude pid (103).
	installFakeProcTree(t, map[int]fakeProc{
		101: {comm: "sh", ppid: 102},
		102: {comm: "bash", ppid: 103},
		103: {comm: "claude", ppid: 104},
		104: {comm: "zsh", ppid: 1},
	})

	got := resolveAgentPID(context.Background(), 101, "claude")
	if got != 103 {
		t.Errorf("resolveAgentPID = %d, want 103 (the claude ancestor)", got)
	}
}

func TestResolveAgentPIDMatchesImmediateParent(t *testing.T) {
	// When the hook's parent IS the agent (non-wrapped launch), the walk returns
	// the start pid itself.
	installFakeProcTree(t, map[int]fakeProc{
		200: {comm: "claude", ppid: 1},
	})
	if got := resolveAgentPID(context.Background(), 200, "claude"); got != 200 {
		t.Errorf("resolveAgentPID = %d, want 200 (parent is the agent)", got)
	}
}

func TestResolveAgentPIDExhaustsBoundReturnsZero(t *testing.T) {
	// A chain of shells with the claude ancestor BEYOND the 5-hop bound must
	// return 0 (→ omit the pid segment) rather than a wrong pid.
	tree := map[int]fakeProc{}
	// pids 300..306 are all shells; 307 is claude — 7 hops up, past the bound.
	for pid := 300; pid <= 306; pid++ {
		tree[pid] = fakeProc{comm: "sh", ppid: pid + 1}
	}
	tree[307] = fakeProc{comm: "claude", ppid: 1}
	installFakeProcTree(t, tree)

	if got := resolveAgentPID(context.Background(), 300, "claude"); got != 0 {
		t.Errorf("resolveAgentPID = %d, want 0 (claude ancestor is past the %d-hop bound)", got, agentHookAncestorHops)
	}
}

func TestResolveAgentPIDDeadAncestorReturnsZero(t *testing.T) {
	// A missing/dead ancestor (ppid resolves to 0 mid-walk) returns 0.
	installFakeProcTree(t, map[int]fakeProc{
		400: {comm: "sh", ppid: 0}, // parent unknown
	})
	if got := resolveAgentPID(context.Background(), 400, "claude"); got != 0 {
		t.Errorf("resolveAgentPID = %d, want 0 (ancestor chain broke)", got)
	}
}

// captureWrite installs a writeAgentState seam that records its last call.
type writeCall struct {
	called bool
	pane   string
	state  string
	pid    int
}

func captureWrite(t *testing.T) *writeCall {
	t.Helper()
	rec := &writeCall{}
	orig := writeAgentStateFn
	writeAgentStateFn = func(_ context.Context, pane, state string, pid int) {
		rec.called = true
		rec.pane, rec.state, rec.pid = pane, state, pid
	}
	t.Cleanup(func() { writeAgentStateFn = orig })
	return rec
}

func TestRunAgentHookNoPaneNoWrite(t *testing.T) {
	t.Setenv("TMUX_PANE", "")
	rec := captureWrite(t)
	// Also fail the test loudly if the walk seam is even consulted.
	origComm := processCommFn
	processCommFn = func(context.Context, int) string {
		t.Fatal("ancestor walk should not run when $TMUX_PANE is unset")
		return ""
	}
	t.Cleanup(func() { processCommFn = origComm })

	runAgentHook(context.Background(), "claude", "active")
	if rec.called {
		t.Error("no $TMUX_PANE must mean no write")
	}
}

func TestRunAgentHookUnknownStateNoWrite(t *testing.T) {
	t.Setenv("TMUX_PANE", "%3")
	rec := captureWrite(t)
	runAgentHook(context.Background(), "claude", "busy") // not a canonical state
	if rec.called {
		t.Error("an unknown state must not write")
	}
}

func TestRunAgentHookUnknownAgentNoWrite(t *testing.T) {
	t.Setenv("TMUX_PANE", "%3")
	rec := captureWrite(t)
	runAgentHook(context.Background(), "nope", "active") // not in the registry
	if rec.called {
		t.Error("an unknown --agent must not write")
	}
}

func TestRunAgentHookWritesWithResolvedPid(t *testing.T) {
	t.Setenv("TMUX_PANE", "%7")
	rec := captureWrite(t)
	// The hook's parent chain resolves to a claude pid.
	installFakeProcTree(t, map[int]fakeProc{
		// os.Getppid() is the real parent; make it resolve to claude directly by
		// mapping ANY pid to a claude ancestor one hop up.
	})
	// Override the seam to always find claude at the immediate parent, regardless
	// of the real getppid value.
	origComm := processCommFn
	processCommFn = func(_ context.Context, _ int) string { return "claude" }
	t.Cleanup(func() { processCommFn = origComm })

	runAgentHook(context.Background(), "claude", "waiting")
	if !rec.called {
		t.Fatal("a valid invocation inside tmux must write")
	}
	if rec.pane != "%7" || rec.state != agentStateWaiting {
		t.Errorf("wrote (pane=%q state=%q), want (%%7, waiting)", rec.pane, rec.state)
	}
	if rec.pid <= 0 {
		t.Errorf("pid = %d, want the resolved (>0) claude pid", rec.pid)
	}
}

func TestRunAgentHookWritesTwoSegmentWhenWalkFails(t *testing.T) {
	t.Setenv("TMUX_PANE", "%7")
	rec := captureWrite(t)
	// No ancestor matches claude → the walk returns 0 → the value must omit the
	// pid segment (two-segment legacy fallback), never a wrong pid.
	origComm := processCommFn
	processCommFn = func(_ context.Context, _ int) string { return "bash" }
	origPPID := processPPIDFn
	processPPIDFn = func(_ context.Context, _ int) int { return 0 } // chain breaks immediately
	t.Cleanup(func() { processCommFn, processPPIDFn = origComm, origPPID })

	runAgentHook(context.Background(), "claude", "idle")
	if !rec.called {
		t.Fatal("a valid state inside tmux must still write, just without a pid")
	}
	if rec.pid != 0 {
		t.Errorf("pid = %d, want 0 (walk failed → omit the pid segment)", rec.pid)
	}
}

// chatCall records a single writeChat invocation for the test seam.
type chatCall struct {
	called             bool
	pane, provider, id string
}

// captureChat swaps the writeChat seam for one that records its arguments.
func captureChat(t *testing.T) *chatCall {
	t.Helper()
	rec := &chatCall{}
	orig := writeChatFn
	writeChatFn = func(_ context.Context, pane, provider, sessionID string) {
		rec.called = true
		rec.pane, rec.provider, rec.id = pane, provider, sessionID
	}
	t.Cleanup(func() { writeChatFn = orig })
	return rec
}

// setHookStdin swaps the stdin seam for a reader over the given payload.
func setHookStdin(t *testing.T, payload string) {
	t.Helper()
	orig := hookStdinFn
	hookStdinFn = func() io.Reader { return strings.NewReader(payload) }
	t.Cleanup(func() { hookStdinFn = orig })
}

func TestReadHookSessionID(t *testing.T) {
	const uuid = "6f0d9e2a-1c3b-4f7e-9a2d-8b5c4e1f0a37"
	cases := []struct {
		name    string
		payload string
		want    string
	}{
		{"valid", `{"session_id":"` + uuid + `","transcript_path":"/x/y.jsonl","hook_event_name":"Stop"}`, uuid},
		{"extra unknown keys tolerated", `{"cwd":"/tmp","session_id":"` + uuid + `"}`, uuid},
		{"absent session_id", `{"hook_event_name":"Stop"}`, ""},
		{"empty session_id", `{"session_id":""}`, ""},
		{"whitespace session_id rejected", `{"session_id":"has space"}`, ""},
		{"empty stdin", "", ""},
		{"non-JSON stdin", "not json at all", ""},
		{"leading object only (single-object decode)", `{"session_id":"` + uuid + `"}{"session_id":"other"}`, uuid},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := readHookSessionID(strings.NewReader(c.payload))
			if got != c.want {
				t.Errorf("readHookSessionID(%q) = %q, want %q", c.payload, got, c.want)
			}
		})
	}
}

func TestReadHookSessionIDOversizedIsRejectedNotHung(t *testing.T) {
	// A > 1 MiB payload whose closing brace lies beyond the LimitReader bound: the
	// decode fails (unexpected EOF) and yields "" — bounded, never blocks.
	var b strings.Builder
	b.WriteString(`{"session_id":"`)
	b.WriteString(strings.Repeat("a", (1<<20)+16))
	b.WriteString(`"}`)
	if got := readHookSessionID(strings.NewReader(b.String())); got != "" {
		t.Errorf("oversized payload = %q, want empty (bounded read)", got)
	}
}

func TestReadHookSessionIDNilReader(t *testing.T) {
	if got := readHookSessionID(nil); got != "" {
		t.Errorf("nil reader = %q, want empty", got)
	}
}

func TestRunAgentHookStampsChatOnStateFire(t *testing.T) {
	const uuid = "6f0d9e2a-1c3b-4f7e-9a2d-8b5c4e1f0a37"
	t.Setenv("TMUX_PANE", "%7")
	rec := captureWrite(t)
	chat := captureChat(t)
	setHookStdin(t, `{"session_id":"`+uuid+`"}`)
	origComm := processCommFn
	processCommFn = func(_ context.Context, _ int) string { return "claude" }
	t.Cleanup(func() { processCommFn = origComm })

	runAgentHook(context.Background(), "claude", "active")

	if !rec.called || rec.state != agentStateActive {
		t.Errorf("agent-state write: called=%v state=%q, want true/active", rec.called, rec.state)
	}
	if !chat.called {
		t.Fatal("a state fire with a session id must ALSO stamp @rk_chat")
	}
	if chat.pane != "%7" || chat.provider != "claude" || chat.id != uuid {
		t.Errorf("chat stamp = (pane=%q provider=%q id=%q), want (%%7, claude, %s)", chat.pane, chat.provider, chat.id, uuid)
	}
}

func TestRunAgentHookStateFireNoSessionIDNoChat(t *testing.T) {
	t.Setenv("TMUX_PANE", "%7")
	rec := captureWrite(t)
	chat := captureChat(t)
	setHookStdin(t, `{"hook_event_name":"Stop"}`) // no session_id
	origComm := processCommFn
	processCommFn = func(_ context.Context, _ int) string { return "claude" }
	t.Cleanup(func() { processCommFn = origComm })

	runAgentHook(context.Background(), "claude", "idle")

	if !rec.called {
		t.Error("agent-state must still be written when there is no session id")
	}
	if chat.called {
		t.Error("no session id must mean no chat stamp")
	}
}

func TestRunAgentHookStampTokenWritesChatOnly(t *testing.T) {
	const uuid = "abc-123-def"
	t.Setenv("TMUX_PANE", "%9")
	rec := captureWrite(t)
	chat := captureChat(t)
	setHookStdin(t, `{"session_id":"`+uuid+`"}`)
	// The walk seam must not even be consulted for a stamp-only fire (no agent-state).
	origComm := processCommFn
	processCommFn = func(context.Context, int) string {
		t.Fatal("stamp-only fire must not resolve an agent pid (no agent-state write)")
		return ""
	}
	t.Cleanup(func() { processCommFn = origComm })

	runAgentHook(context.Background(), "claude", agentHookStampToken)

	if rec.called {
		t.Error("the stamp token must NOT write @rk_agent_state")
	}
	if !chat.called || chat.pane != "%9" || chat.provider != "claude" || chat.id != uuid {
		t.Errorf("stamp chat = (called=%v pane=%q provider=%q id=%q), want (true, %%9, claude, %s)", chat.called, chat.pane, chat.provider, chat.id, uuid)
	}
}

func TestRunAgentHookStampTokenNoSessionIDNoWrite(t *testing.T) {
	t.Setenv("TMUX_PANE", "%9")
	rec := captureWrite(t)
	chat := captureChat(t)
	setHookStdin(t, ``) // no stdin → no session id
	runAgentHook(context.Background(), "claude", agentHookStampToken)
	if rec.called || chat.called {
		t.Errorf("stamp with no session id must write nothing (state=%v chat=%v)", rec.called, chat.called)
	}
}

func TestRunAgentHookUnknownTokenNoWrite(t *testing.T) {
	t.Setenv("TMUX_PANE", "%9")
	rec := captureWrite(t)
	chat := captureChat(t)
	setHookStdin(t, `{"session_id":"abc-123"}`)
	runAgentHook(context.Background(), "claude", "busy") // neither a state nor stamp
	if rec.called || chat.called {
		t.Errorf("an unknown token must write nothing (state=%v chat=%v)", rec.called, chat.called)
	}
}

func TestRunAgentHookMalformedSessionIDNotStamped(t *testing.T) {
	t.Setenv("TMUX_PANE", "%7")
	captureWrite(t)
	chat := captureChat(t)
	setHookStdin(t, `{"session_id":"has space"}`) // rejected by isValidSessionID
	origComm := processCommFn
	processCommFn = func(_ context.Context, _ int) string { return "claude" }
	t.Cleanup(func() { processCommFn = origComm })

	runAgentHook(context.Background(), "claude", "active")
	if chat.called {
		t.Error("a whitespace-bearing session id must never be stamped")
	}
}

func TestIsValidSessionID(t *testing.T) {
	for _, s := range []string{"abc", "6f0d9e2a-1c3b-4f7e-9a2d-8b5c4e1f0a37", "seg1:seg2"} {
		if !isValidSessionID(s) {
			t.Errorf("isValidSessionID(%q) = false, want true", s)
		}
	}
	for _, s := range []string{"", " ", "has space", "line\nbreak", "tab\there", "del\x7f"} {
		if isValidSessionID(s) {
			t.Errorf("isValidSessionID(%q) = true, want false", s)
		}
	}
}

func TestFormatAgentStateValue(t *testing.T) {
	// The cross-repo @rk_agent_state value contract, byte-for-byte
	// (docs/specs/agent-state.md § The Option): three segments with a pid, two
	// without (the legacy form readers fall back on). A non-positive pid means
	// "the walk could not validate an ancestor" and must OMIT the segment.
	cases := []struct {
		state string
		epoch int64
		pid   int
		want  string
	}{
		{agentStateWaiting, 1751790000, 48213, "waiting:1751790000:48213"},
		{agentStateActive, 1751790000, 1, "active:1751790000:1"},
		{agentStateIdle, 1751790000, 0, "idle:1751790000"},
		{agentStateActive, 1751790000, -7, "active:1751790000"},
	}
	for _, c := range cases {
		if got := formatAgentStateValue(c.state, c.epoch, c.pid); got != c.want {
			t.Errorf("formatAgentStateValue(%q, %d, %d) = %q, want %q", c.state, c.epoch, c.pid, got, c.want)
		}
	}
}

func TestParseProcStatusPPID(t *testing.T) {
	cases := []struct {
		name    string
		content string
		want    int
	}{
		{"typical status file", "Name:\tzsh\nUmask:\t0022\nState:\tS (sleeping)\nPid:\t3393476\nPPid:\t3393474\nTracerPid:\t0\n", 3393474},
		{"pid 1 / kernel thread", "Name:\tsystemd\nPPid:\t0\n", 0},
		{"missing PPid line", "Name:\tzsh\nPid:\t42\n", 0},
		{"malformed value", "PPid:\tnotanumber\n", 0},
		{"empty content", "", 0},
	}
	for _, c := range cases {
		if got := parseProcStatusPPID(c.content); got != c.want {
			t.Errorf("%s: parseProcStatusPPID = %d, want %d", c.name, got, c.want)
		}
	}
}

func TestAgentCommForNameKnownAndUnknown(t *testing.T) {
	if c := agentCommForName("", "claude"); c != "claude" {
		t.Errorf("agentCommForName(claude) = %q, want claude", c)
	}
	if c := agentCommForName("", "Claude Code"); c != "claude" {
		t.Errorf("agentCommForName(display name) = %q, want claude", c)
	}
	if c := agentCommForName("", "gemini"); c != "" {
		t.Errorf("agentCommForName(unregistered) = %q, want empty", c)
	}
}

func TestAgentHookCmdNeverErrorsOnMalformedInvocation(t *testing.T) {
	// The never-fail contract: NO invocation of `rk agent-hook` may return a
	// non-nil error from cobra (which would exit non-zero — a warning/blocking
	// signal to the harness). Missing state, extra args, and unknown flags must
	// all return nil. $TMUX_PANE unset guarantees no real tmux write is attempted.
	t.Setenv("TMUX_PANE", "")
	cases := [][]string{
		{"agent-hook", "--agent", "claude"},           // missing state arg
		{"agent-hook", "--agent", "claude", "a", "b"}, // extra args
		{"agent-hook", "--bogus", "x"},                // unknown flag
		{"agent-hook", "--agent"},                     // KNOWN flag missing its value (pflag error before RunE — needs SetFlagErrorFunc)
		{"agent-hook", "--agent", "claude", "active"}, // valid state (no pane → no-op)
		{"agent-hook", "--agent", "claude", "stamp"},  // stamp-only token (no pane → no-op)
		{"agent-hook", "--agent", "claude", "bogus"},  // unknown token (no-op)
	}
	for _, args := range cases {
		agentHookAgent = "claude" // reset the package-level flag binding between runs
		rootCmd.SetArgs(args)
		err := rootCmd.Execute()
		if err != nil {
			t.Errorf("rk %v returned error %v; must always be nil (never-fail contract)", args, err)
		}
		// Explicit exit-code assertion: after the root SetFlagErrorFunc tags flag
		// errors usage-class (2), agent-hook's OWN SetFlagErrorFunc(→ nil) must keep
		// shadowing it so `--agent` (missing value) and unknown flags still exit 0.
		// Claude Code treats a hook exit 2 as *blocking* — this must never surface.
		if code := exitCode(err); code != 0 {
			t.Errorf("rk %v exitCode = %d; must be 0 (never-fail contract; 2 would block the harness)", args, code)
		}
	}
}

func TestTmuxSocketArgs(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"", nil},
		{",1,0", nil}, // empty socket field
		{"/tmp/tmux-1000/default,4242,0", []string{"-S", "/tmp/tmux-1000/default"}},
		{"/tmp/tmux-1000/rk-daemon,1,2", []string{"-S", "/tmp/tmux-1000/rk-daemon"}},
		{"/no/commas", []string{"-S", "/no/commas"}}, // tolerate a bare socket path
	}
	for _, c := range cases {
		got := tmuxSocketArgs(c.in)
		if len(got) != len(c.want) {
			t.Errorf("tmuxSocketArgs(%q) = %v, want %v", c.in, got, c.want)
			continue
		}
		for i := range got {
			if got[i] != c.want[i] {
				t.Errorf("tmuxSocketArgs(%q)[%d] = %q, want %q", c.in, i, got[i], c.want[i])
			}
		}
	}
}

func TestIsAgentStateValidator(t *testing.T) {
	for _, s := range []string{agentStateActive, agentStateWaiting, agentStateIdle} {
		if !isAgentState(s) {
			t.Errorf("isAgentState(%q) = false, want true", s)
		}
	}
	for _, s := range []string{"", "busy", "running", "Active"} {
		if isAgentState(s) {
			t.Errorf("isAgentState(%q) = true, want false", s)
		}
	}
}
