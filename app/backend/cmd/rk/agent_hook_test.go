package main

import (
	"context"
	"fmt"
	"io"
	"slices"
	"strings"
	"testing"

	"rk/internal/tmux"

	"github.com/spf13/cobra"
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

// agentSessionCall records a single writeAgentSession invocation for the test
// seam.
type agentSessionCall struct {
	called             bool
	pane, provider, id string
}

// captureAgentSession swaps the writeAgentSession seam for one that records its
// arguments.
func captureAgentSession(t *testing.T) *agentSessionCall {
	t.Helper()
	rec := &agentSessionCall{}
	orig := writeAgentSessionFn
	writeAgentSessionFn = func(_ context.Context, pane, provider, sessionID string) {
		rec.called = true
		rec.pane, rec.provider, rec.id = pane, provider, sessionID
	}
	t.Cleanup(func() { writeAgentSessionFn = orig })
	return rec
}

// setHookStdin swaps the stdin seam for a reader over the given payload.
func setHookStdin(t *testing.T, payload string) {
	t.Helper()
	orig := hookStdinFn
	hookStdinFn = func() io.Reader { return strings.NewReader(payload) }
	t.Cleanup(func() { hookStdinFn = orig })
}

// hookSessionIDFrom mirrors the production composition (readHookInput feeding
// isValidSessionID — agent_hook.go's stamp path): the payload's validated
// session id, or "" on any failure.
func hookSessionIDFrom(r io.Reader) string {
	in, ok := readHookInput(r)
	if !ok || !isValidSessionID(in.SessionID) {
		return ""
	}
	return in.SessionID
}

func TestHookSessionIDValidation(t *testing.T) {
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
			got := hookSessionIDFrom(strings.NewReader(c.payload))
			if got != c.want {
				t.Errorf("hookSessionIDFrom(%q) = %q, want %q", c.payload, got, c.want)
			}
		})
	}
}

func TestHookSessionIDOversizedIsRejectedNotHung(t *testing.T) {
	// A > 1 MiB payload whose closing brace lies beyond the LimitReader bound: the
	// decode fails (unexpected EOF) and yields "" — bounded, never blocks.
	var b strings.Builder
	b.WriteString(`{"session_id":"`)
	b.WriteString(strings.Repeat("a", (1<<20)+16))
	b.WriteString(`"}`)
	if got := hookSessionIDFrom(strings.NewReader(b.String())); got != "" {
		t.Errorf("oversized payload = %q, want empty (bounded read)", got)
	}
}

func TestHookSessionIDNilReader(t *testing.T) {
	if got := hookSessionIDFrom(nil); got != "" {
		t.Errorf("nil reader = %q, want empty", got)
	}
}

func TestRunAgentHookStampsAgentSessionOnStateFire(t *testing.T) {
	const uuid = "6f0d9e2a-1c3b-4f7e-9a2d-8b5c4e1f0a37"
	t.Setenv("TMUX_PANE", "%7")
	rec := captureWrite(t)
	sess := captureAgentSession(t)
	setHookStdin(t, `{"session_id":"`+uuid+`"}`)
	origComm := processCommFn
	processCommFn = func(_ context.Context, _ int) string { return "claude" }
	t.Cleanup(func() { processCommFn = origComm })

	runAgentHook(context.Background(), "claude", "active")

	if !rec.called || rec.state != agentStateActive {
		t.Errorf("agent-state write: called=%v state=%q, want true/active", rec.called, rec.state)
	}
	if !sess.called {
		t.Fatal("a state fire with a session id must ALSO stamp @rk_pane_agent_session")
	}
	if sess.pane != "%7" || sess.provider != "claude" || sess.id != uuid {
		t.Errorf("agent-session stamp = (pane=%q provider=%q id=%q), want (%%7, claude, %s)", sess.pane, sess.provider, sess.id, uuid)
	}
}

func TestRunAgentHookStateFireNoSessionIDNoAgentSession(t *testing.T) {
	t.Setenv("TMUX_PANE", "%7")
	rec := captureWrite(t)
	sess := captureAgentSession(t)
	setHookStdin(t, `{"hook_event_name":"Stop"}`) // no session_id
	origComm := processCommFn
	processCommFn = func(_ context.Context, _ int) string { return "claude" }
	t.Cleanup(func() { processCommFn = origComm })

	runAgentHook(context.Background(), "claude", "idle")

	if !rec.called {
		t.Error("agent-state must still be written when there is no session id")
	}
	if sess.called {
		t.Error("no session id must mean no agent-session stamp")
	}
}

func TestRunAgentHookStampTokenWritesAgentSessionAndIdle(t *testing.T) {
	const uuid = "abc-123-def"
	t.Setenv("TMUX_PANE", "%9")
	rec := captureWrite(t)
	sess := captureAgentSession(t)
	setHookStdin(t, `{"session_id":"`+uuid+`","source":"startup"}`)
	origComm := processCommFn
	processCommFn = func(_ context.Context, _ int) string { return "claude" }
	t.Cleanup(func() { processCommFn = origComm })

	runAgentHook(context.Background(), "claude", agentHookStampToken)

	// The stamp token's boot write: idle agent-state (the boot-ready signal),
	// with the resolved pid, overwriting any stale state from a previous agent.
	if !rec.called || rec.pane != "%9" || rec.state != agentStateIdle {
		t.Errorf("boot write = (called=%v pane=%q state=%q), want (true, %%9, idle)", rec.called, rec.pane, rec.state)
	}
	if rec.pid <= 0 {
		t.Errorf("pid = %d, want the resolved (>0) claude pid", rec.pid)
	}
	if !sess.called || sess.pane != "%9" || sess.provider != "claude" || sess.id != uuid {
		t.Errorf("stamp agent-session = (called=%v pane=%q provider=%q id=%q), want (true, %%9, claude, %s)", sess.called, sess.pane, sess.provider, sess.id, uuid)
	}
}

func TestRunAgentHookStampTokenBootWriteSources(t *testing.T) {
	const uuid = "abc-123-def"
	// The boot write fires on the session-begin sources and on a parsed payload
	// with no source field; source=compact (mid-turn) and an unparseable payload
	// withhold it — an idle write there could clobber a live active state.
	cases := []struct {
		name      string
		payload   string
		wantState bool
	}{
		{"startup", `{"session_id":"` + uuid + `","source":"startup"}`, true},
		{"resume", `{"session_id":"` + uuid + `","source":"resume"}`, true},
		{"clear", `{"session_id":"` + uuid + `","source":"clear"}`, true},
		{"no source field", `{"session_id":"` + uuid + `"}`, true},
		{"compact fires mid-turn — no idle write", `{"session_id":"` + uuid + `","source":"compact"}`, false},
		{"unparseable payload — fail-safe", `not json`, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("TMUX_PANE", "%9")
			rec := captureWrite(t)
			sess := captureAgentSession(t)
			setHookStdin(t, tc.payload)
			origComm := processCommFn
			processCommFn = func(_ context.Context, _ int) string { return "claude" }
			t.Cleanup(func() { processCommFn = origComm })

			runAgentHook(context.Background(), "claude", agentHookStampToken)

			if rec.called != tc.wantState {
				t.Errorf("state write = %v, want %v", rec.called, tc.wantState)
			}
			if rec.called && rec.state != agentStateIdle {
				t.Errorf("state = %q, want idle", rec.state)
			}
			// The agent-session stamp keys on the session id alone — source never gates it.
			wantStamp := tc.payload != "not json"
			if sess.called != wantStamp {
				t.Errorf("agent-session stamp = %v, want %v", sess.called, wantStamp)
			}
		})
	}
}

func TestRunAgentHookStampTokenNoSessionIDNoWrite(t *testing.T) {
	t.Setenv("TMUX_PANE", "%9")
	rec := captureWrite(t)
	sess := captureAgentSession(t)
	setHookStdin(t, ``) // no stdin → no session id
	runAgentHook(context.Background(), "claude", agentHookStampToken)
	if rec.called || sess.called {
		t.Errorf("stamp with no session id must write nothing (state=%v session=%v)", rec.called, sess.called)
	}
}

func TestRunAgentHookUnknownTokenNoWrite(t *testing.T) {
	t.Setenv("TMUX_PANE", "%9")
	rec := captureWrite(t)
	sess := captureAgentSession(t)
	setHookStdin(t, `{"session_id":"abc-123"}`)
	runAgentHook(context.Background(), "claude", "busy") // neither a state nor stamp
	if rec.called || sess.called {
		t.Errorf("an unknown token must write nothing (state=%v session=%v)", rec.called, sess.called)
	}
}

func TestRunAgentHookMalformedSessionIDNotStamped(t *testing.T) {
	t.Setenv("TMUX_PANE", "%7")
	captureWrite(t)
	sess := captureAgentSession(t)
	setHookStdin(t, `{"session_id":"has space"}`) // rejected by isValidSessionID
	origComm := processCommFn
	processCommFn = func(_ context.Context, _ int) string { return "claude" }
	t.Cleanup(func() { processCommFn = origComm })

	runAgentHook(context.Background(), "claude", "active")
	if sess.called {
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

func TestAgentRuntimeForNameResolvesComms(t *testing.T) {
	// The comm literal resolves the same descriptor as the provider token
	// (legacy installed lines pass the comm).
	rt, ok := agentRuntimeForName("kimi-code")
	if !ok || rt.provider != "kimi" {
		t.Errorf("agentRuntimeForName(kimi-code comm) = %+v, %v, want the kimi descriptor", rt, ok)
	}
	if _, ok := agentRuntimeForName("nosuchagent"); ok {
		t.Error("an unregistered name must not resolve")
	}
}

func TestAgentRuntimeForNameResolvesEveryRegisteredProvider(t *testing.T) {
	// Every registry provider resolves by BOTH its provider token and its comm
	// literal, and gemini's node-bundle comm is the documented exception.
	wantComm := map[string]string{
		"claude":   "claude",
		"codex":    "codex",
		"gemini":   "node",
		"copilot":  "copilot",
		"kimi":     "kimi-code",
		"opencode": "opencode",
		"agy":      "agy",
	}
	for provider, comm := range wantComm {
		rt, ok := agentRuntimeForName(provider)
		if !ok {
			t.Errorf("provider %q not registered", provider)
			continue
		}
		if rt.provider != provider || rt.comm != comm {
			t.Errorf("agentRuntimeForName(%q) = %+v, want provider=%q comm=%q", provider, rt, provider, comm)
		}
	}
}

func TestHookSessionIDPerProviderCasing(t *testing.T) {
	in := hookInput{SessionID: "snake-id", SessionIDCamel: "camel-id"}
	// snake_case providers read session_id; copilot's camelCase format reads
	// sessionId — the two never cross.
	for _, provider := range []string{"claude", "codex", "gemini", "kimi", "opencode"} {
		rt, _ := agentRuntimeForName(provider)
		if got := rt.hookSessionID(in); got != "snake-id" {
			t.Errorf("%s hookSessionID = %q, want snake-id", provider, got)
		}
	}
	rt, _ := agentRuntimeForName("copilot")
	if got := rt.hookSessionID(in); got != "camel-id" {
		t.Errorf("copilot hookSessionID = %q, want camel-id", got)
	}
}

func TestIsCompactSourcePerProvider(t *testing.T) {
	// claude and codex withhold the boot idle write for source=compact;
	// providers with no mid-turn source never match (their SessionStart
	// matcher set has no compact value at all).
	for _, provider := range []string{"claude", "codex"} {
		rt, _ := agentRuntimeForName(provider)
		if !rt.isCompactSource("compact") {
			t.Errorf("%s: source=compact must gate the boot write", provider)
		}
	}
	for _, provider := range []string{"gemini", "copilot", "kimi", "opencode"} {
		rt, _ := agentRuntimeForName(provider)
		if rt.isCompactSource("compact") {
			t.Errorf("%s: has no mid-turn compaction source, must never gate", provider)
		}
	}
}

// agentHookForms enumerates the two registered invocation forms of the hook
// command — the `rk agent hook` family member and the PERMANENT hidden
// `rk agent-hook` root alias — with the command instance whose --agent flag
// binding each form drives. Alias parity (identical behavior on both forms) is
// the load-bearing guarantee for installed hook lines.
var agentHookForms = []struct {
	name   string
	prefix []string
	cmd    *cobra.Command
}{
	{"family member (agent hook)", []string{"agent", "hook"}, agentHookFamilyCmd},
	{"permanent root alias (agent-hook)", []string{"agent-hook"}, agentHookAliasCmd},
}

func TestAgentHookCmdNeverErrorsOnMalformedInvocation(t *testing.T) {
	// The never-fail contract: NO invocation of EITHER form may return a non-nil
	// error from cobra (which would exit non-zero — a warning/blocking signal to
	// the harness). Missing state, extra args, and unknown flags must all return
	// nil. $TMUX_PANE unset guarantees no real tmux write is attempted.
	t.Setenv("TMUX_PANE", "")
	tail := [][]string{
		{"--agent", "claude"},           // missing state arg
		{"--agent", "claude", "a", "b"}, // extra args
		{"--bogus", "x"},                // unknown flag
		{"--agent"},                     // KNOWN flag missing its value (pflag error before RunE — needs SetFlagErrorFunc)
		{"--agent", "claude", "active"}, // valid state (no pane → no-op)
		{"--agent", "claude", "stamp"},  // stamp-only token (no pane → no-op)
		{"--agent", "claude", "bogus"},  // unknown token (no-op)
	}
	for _, form := range agentHookForms {
		for _, args := range tail {
			full := append(append([]string{}, form.prefix...), args...)
			_ = form.cmd.Flags().Set("agent", "claude") // reset the per-instance flag binding between runs
			rootCmd.SetArgs(full)
			err := rootCmd.Execute()
			if err != nil {
				t.Errorf("rk %v returned error %v; must always be nil (never-fail contract)", full, err)
			}
			// Explicit exit-code assertion: after the root SetFlagErrorFunc tags flag
			// errors usage-class (2), each instance's OWN SetFlagErrorFunc(→ nil) must
			// keep shadowing it so `--agent` (missing value) and unknown flags still
			// exit 0. Claude Code treats a hook exit 2 as *blocking* — this must never
			// surface.
			if code := exitCode(err); code != 0 {
				t.Errorf("rk %v exitCode = %d; must be 0 (never-fail contract; 2 would block the harness)", full, code)
			}
		}
	}
}

// TestAgentHookCmdAliasParityOnWritePath proves the two invocation forms are
// byte-equivalent on a real write: both drive the same RunE core, so a valid
// fire through either form writes the same @rk_agent_state value for the pane.
func TestAgentHookCmdAliasParityOnWritePath(t *testing.T) {
	t.Setenv("TMUX_PANE", "%7")
	setHookStdin(t, "") // no session id → no agent-session stamp to compare
	// The walk seam resolves every ancestor to claude so the pid is deterministic.
	origComm := processCommFn
	processCommFn = func(_ context.Context, _ int) string { return "claude" }
	t.Cleanup(func() { processCommFn = origComm })

	for _, form := range agentHookForms {
		rec := captureWrite(t)
		_ = form.cmd.Flags().Set("agent", "claude")
		rootCmd.SetArgs(append(append([]string{}, form.prefix...), "--agent", "claude", "active"))
		if err := rootCmd.Execute(); err != nil {
			t.Fatalf("%s: Execute() = %v, want nil (never-fail)", form.name, err)
		}
		if !rec.called || rec.pane != "%7" || rec.state != agentStateActive {
			t.Errorf("%s: write = (called=%v pane=%q state=%q), want (true, %%7, active)", form.name, rec.called, rec.pane, rec.state)
		}
		if rec.pid <= 0 {
			t.Errorf("%s: pid = %d, want the resolved (>0) claude pid", form.name, rec.pid)
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

// captureDualWriteArgv points the dual-write tmux seam at an argv recorder,
// returning the recorder for assertions.
func captureDualWriteArgv(t *testing.T) *[][]string {
	t.Helper()
	var captured [][]string
	orig := agentHookTmuxRun
	agentHookTmuxRun = func(_ context.Context, args []string) error {
		captured = append(captured, args)
		return nil
	}
	t.Cleanup(func() { agentHookTmuxRun = orig })
	return &captured
}

// assertDualWriteArgv pins the deprecation-window write contract: ONE tmux
// invocation whose argv sets the scope-named option AND the retired unscoped
// name to the identical value, chained by a discrete ";" argv element — tmux
// command chaining, no shell (the interpolation surface stays closed).
func assertDualWriteArgv(t *testing.T, args []string, pane, option, legacy, value string) {
	t.Helper()
	want := []string{"set-option", "-pt", pane, option, value, ";", "set-option", "-pt", pane, legacy, value}
	// A -S <socket> prefix may precede the chained commands; locate them.
	start := 0
	if len(args) >= 2 && args[0] == "-S" {
		start = 2
	}
	if len(args)-start != len(want) {
		t.Fatalf("argv = %v, want %v (one chained invocation, both names once each)", args, want)
	}
	for i, w := range want {
		if args[start+i] != w {
			t.Fatalf("argv[%d] = %q, want %q (full argv %v)", start+i, args[start+i], w, args)
		}
	}
}

func TestWriteAgentStateImplDualWritesBothNames(t *testing.T) {
	captured := captureDualWriteArgv(t)
	writeAgentStateImpl(context.Background(), "%3", agentStateActive, 4242)
	if len(*captured) != 1 {
		t.Fatalf("tmux invocations = %d, want 1 (chained dual-write)", len(*captured))
	}
	args := (*captured)[0]
	joined := strings.Join(args, " ")
	if strings.Count(joined, tmux.AgentStateOption) != 1 || strings.Count(joined, tmux.LegacyAgentStateOption) != 1 {
		t.Errorf("argv %v must carry %s and %s exactly once each", args, tmux.AgentStateOption, tmux.LegacyAgentStateOption)
	}
	// The value is epoch-stamped at write time; assert the shared value shape
	// (identical across both writes) rather than the exact epoch.
	var values []string
	for i, a := range args {
		if strings.HasPrefix(a, agentStateActive+":") {
			values = append(values, a)
			_ = i
		}
	}
	if len(values) != 2 || values[0] != values[1] {
		t.Errorf("dual-write values = %v, want two identical <state>:<epoch>:<pid> values", values)
	}
	if !strings.HasSuffix(values[0], ":4242") {
		t.Errorf("value %q missing the pid segment", values[0])
	}
	assertDualWriteArgv(t, args, "%3", tmux.AgentStateOption, tmux.LegacyAgentStateOption, values[0])
}

func TestWriteAgentSessionImplDualWritesBothNames(t *testing.T) {
	captured := captureDualWriteArgv(t)
	writeAgentSessionImpl(context.Background(), "%3", "claude", "6f0d9e2a-1c3b-4f7e-9a2d-8b5c4e1f0a37")
	if len(*captured) != 1 {
		t.Fatalf("tmux invocations = %d, want 1 (chained dual-write)", len(*captured))
	}
	args := (*captured)[0]
	assertDualWriteArgv(t, args, "%3", agentSessionOption, tmux.LegacyAgentSessionOption, "claude:6f0d9e2a-1c3b-4f7e-9a2d-8b5c4e1f0a37")
	// The retired two-generations-back name is never written.
	if slices.Contains(args, "@rk_chat") {
		t.Errorf("argv %v must never set @rk_chat", args)
	}
}

func TestDualWriteNeverFailsOnTmuxError(t *testing.T) {
	// The never-fail contract survives a failing chain (e.g. the second
	// set-option failing): the error is swallowed, not propagated.
	orig := agentHookTmuxRun
	agentHookTmuxRun = func(_ context.Context, _ []string) error { return fmt.Errorf("boom") }
	t.Cleanup(func() { agentHookTmuxRun = orig })
	writeAgentStateImpl(context.Background(), "%3", agentStateActive, 0)
	writeAgentSessionImpl(context.Background(), "%3", "claude", "abc123")
}

// --- multi-provider writer coverage (agent_registry.go descriptors) ----------

func TestRunAgentHookCodexStampCompactGate(t *testing.T) {
	t.Setenv("TMUX_PANE", "%9")
	// A codex SessionStart with source=compact fires mid-turn: the identity
	// re-stamps but NO idle write may clobber a live active state.
	setHookStdin(t, `{"session_id":"1a06319-6a63-7791-84df-86736cd58e2e","source":"compact","hook_event_name":"SessionStart"}`)
	stateRec := captureWrite(t)
	sessRec := captureAgentSession(t)
	runAgentHook(context.Background(), "codex", agentHookStampToken)
	if stateRec.called {
		t.Error("source=compact must withhold the boot idle write")
	}
	if !sessRec.called || sessRec.provider != "codex" || sessRec.id != "1a06319-6a63-7791-84df-86736cd58e2e" {
		t.Errorf("stamp = %+v, want codex identity re-stamped", sessRec)
	}
}

func TestRunAgentHookCodexStampStartupWritesIdle(t *testing.T) {
	t.Setenv("TMUX_PANE", "%9")
	setHookStdin(t, `{"session_id":"1a06319-6a63-7791-84df-86736cd58e2e","source":"startup","hook_event_name":"SessionStart"}`)
	stateRec := captureWrite(t)
	sessRec := captureAgentSession(t)
	origComm := processCommFn
	processCommFn = func(_ context.Context, _ int) string { return "codex" }
	t.Cleanup(func() { processCommFn = origComm })

	runAgentHook(context.Background(), "codex", agentHookStampToken)
	if !stateRec.called || stateRec.state != agentStateIdle {
		t.Errorf("startup stamp must write the boot idle state, got %+v", stateRec)
	}
	if stateRec.pid <= 0 {
		t.Errorf("pid = %d, want the resolved (>0) codex pid", stateRec.pid)
	}
	if !sessRec.called || sessRec.provider != "codex" {
		t.Errorf("stamp = %+v, want codex provider token", sessRec)
	}
}

func TestRunAgentHookCopilotCamelCasePayload(t *testing.T) {
	t.Setenv("TMUX_PANE", "%11")
	// Copilot's camelCase event format carries sessionId; the stamp must use
	// the canonical provider token.
	setHookStdin(t, `{"sessionId":"0dd0cf59-31dd-4565-9973-3b34f665b354","cwd":"/tmp","timestamp":1788900000000}`)
	stateRec := captureWrite(t)
	sessRec := captureAgentSession(t)
	runAgentHook(context.Background(), "copilot", "active")
	if !stateRec.called || stateRec.state != agentStateActive {
		t.Errorf("state write = %+v, want active", stateRec)
	}
	if !sessRec.called || sessRec.provider != "copilot" || sessRec.id != "0dd0cf59-31dd-4565-9973-3b34f665b354" {
		t.Errorf("stamp = %+v, want copilot:<camelCase id>", sessRec)
	}
}

func TestRunAgentHookCopilotSnakePayloadNotStamped(t *testing.T) {
	t.Setenv("TMUX_PANE", "%11")
	// A snake_case payload under --agent copilot is the wrong casing contract —
	// no stamp (the state write still proceeds; never-fail, never-guess).
	setHookStdin(t, `{"session_id":"0dd0cf59-31dd-4565-9973-3b34f665b354"}`)
	sessRec := captureAgentSession(t)
	runAgentHook(context.Background(), "copilot", "active")
	if sessRec.called {
		t.Errorf("snake_case payload must not stamp for copilot, got %+v", sessRec)
	}
}

func TestRunAgentHookKimiStampsProviderTokenNotComm(t *testing.T) {
	t.Setenv("TMUX_PANE", "%13")
	// kimi's comm is kimi-code but the identity prefix is the provider token —
	// the transcript registry keys on `kimi`.
	setHookStdin(t, `{"session_id":"session_1a06319-6a63-7791-84df-86736cd58e2e","hook_event_name":"SessionStart","source":"startup"}`)
	sessRec := captureAgentSession(t)
	origComm := processCommFn
	processCommFn = func(_ context.Context, _ int) string { return "kimi-code" }
	t.Cleanup(func() { processCommFn = origComm })

	runAgentHook(context.Background(), "kimi", agentHookStampToken)
	if !sessRec.called || sessRec.provider != "kimi" {
		t.Errorf("stamp = %+v, want the kimi provider token (never kimi-code)", sessRec)
	}
}

func TestRunAgentHookGeminiWalksToNodeAncestor(t *testing.T) {
	t.Setenv("TMUX_PANE", "%15")
	// gemini is a bundled node script: the comm walk matches `node`.
	rec := captureWrite(t)
	origComm := processCommFn
	processCommFn = func(_ context.Context, _ int) string { return "node" }
	t.Cleanup(func() { processCommFn = origComm })

	runAgentHook(context.Background(), "gemini", "active")
	if !rec.called || rec.pid <= 0 {
		t.Errorf("gemini fire = %+v, want active with the resolved node pid", rec)
	}
}

func TestRunAgentHookUnknownProviderSilentNoOp(t *testing.T) {
	t.Setenv("TMUX_PANE", "%17")
	stateRec := captureWrite(t)
	sessRec := captureAgentSession(t)
	setHookStdin(t, `{"session_id":"abc"}`)
	runAgentHook(context.Background(), "antigravity", "active")
	runAgentHook(context.Background(), "antigravity", agentHookStampToken)
	if stateRec.called || sessRec.called {
		t.Errorf("an unregistered provider must write nothing, got state=%+v session=%+v", stateRec, sessRec)
	}
}

// --- agy (Antigravity CLI) writer coverage ------------------------------------

func TestRunAgentHookAgyConversationIDStamp(t *testing.T) {
	t.Setenv("TMUX_PANE", "%21")
	// agy's protojson payload carries conversationId; PreInvocation maps to
	// active and stamps agy:<conversationId>.
	setHookStdin(t, `{"conversationId":"ec33ebf9-0cba-4100-8142-c61503f6c587","invocationNum":3,"modelName":"auto"}`)
	stateRec := captureWrite(t)
	sessRec := captureAgentSession(t)
	origComm := processCommFn
	processCommFn = func(_ context.Context, _ int) string { return "agy" }
	t.Cleanup(func() { processCommFn = origComm })

	runAgentHook(context.Background(), "agy", "active")
	if !stateRec.called || stateRec.state != agentStateActive {
		t.Errorf("state write = %+v, want active", stateRec)
	}
	if stateRec.pid <= 0 {
		t.Errorf("pid = %d, want the resolved (>0) agy pid", stateRec.pid)
	}
	if !sessRec.called || sessRec.provider != "agy" || sessRec.id != "ec33ebf9-0cba-4100-8142-c61503f6c587" {
		t.Errorf("stamp = %+v, want agy:<conversationId>", sessRec)
	}
}

func TestRunAgentHookAgyStopFullyIdleGate(t *testing.T) {
	t.Setenv("TMUX_PANE", "%23")
	// Stop with fullyIdle absent/false must NOT write idle (background tasks
	// may still be running); fullyIdle=true writes idle. Identity stamps
	// either way.
	setHookStdin(t, `{"conversationId":"ec33ebf9-0cba-4100-8142-c61503f6c587","terminationReason":"model_stop"}`)
	stateRec := captureWrite(t)
	sessRec := captureAgentSession(t)
	runAgentHook(context.Background(), "agy", "idle")
	if stateRec.called {
		t.Error("Stop without fullyIdle must not write idle")
	}
	if !sessRec.called {
		t.Error("identity must still stamp on a gated idle fire")
	}

	setHookStdin(t, `{"conversationId":"ec33ebf9-0cba-4100-8142-c61503f6c587","fullyIdle":false}`)
	stateRec2 := captureWrite(t)
	runAgentHook(context.Background(), "agy", "idle")
	if stateRec2.called {
		t.Error("fullyIdle=false must not write idle")
	}

	setHookStdin(t, `{"conversationId":"ec33ebf9-0cba-4100-8142-c61503f6c587","fullyIdle":true}`)
	stateRec3 := captureWrite(t)
	runAgentHook(context.Background(), "agy", "idle")
	if !stateRec3.called || stateRec3.state != agentStateIdle {
		t.Errorf("fullyIdle=true must write idle, got %+v", stateRec3)
	}
}

func TestAgentStateHookCommandJSONShape(t *testing.T) {
	cmd := agentStateHookCommandJSON("/opt/homebrew/bin/rk", "idle", "agy")
	// Emits {} (a well-formed no-decision result) even outside tmux, and never
	// fails: the trailing echo is the last command.
	if !strings.Contains(cmd, `echo "{}"`) {
		t.Errorf("JSON wrapper must echo {} — agy parses hook stdout as a result object: %s", cmd)
	}
	if !strings.HasSuffix(cmd, `; echo "{}"'`) {
		t.Errorf("the {} echo must be unconditional (not gated on tmux): %s", cmd)
	}
	// Never emits a decision field.
	if strings.Contains(cmd, "decision") || strings.Contains(cmd, "allow") || strings.Contains(cmd, "deny") || strings.Contains(cmd, "force_continue") {
		t.Errorf("telemetry hook must never emit a decision: %s", cmd)
	}
}
