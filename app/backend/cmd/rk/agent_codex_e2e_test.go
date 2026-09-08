package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"rk/internal/tmux"
	"rk/internal/transcript"
)

// agent_codex_e2e_test.go — the Codex end-to-end proof, fully isolated: an
// isolated tmux server (rk-test-codex-<pid>-<ns>) and an isolated $CODEX_HOME,
// never touching a live user agent or the user's real codex config. The test
// installs via the REAL registry row, extracts the INSTALLED hook command from
// the written hooks.json, and executes it verbatim (the sh -c wrapper, exactly
// as Codex would post-trust) with a codex-shaped payload on stdin and
// TMUX/TMUX_PANE pointed at the isolated pane — proving the whole chain:
// install → hook fire → @rk_pane_agent_session/@rk_pane_agent_state on the
// pane → transcript resolution of the session's rollout file.
//
// The installed command embeds a shim path (not a real rk binary): the shim
// re-execs the test binary with a guard env var, and the child branch below
// dispatches the argv through the REAL cobra tree (execute()), so the
// production runAgentHook runs unmodified (the RK_RIFF_SUBPROC precedent in
// root_test.go).
//
// Codex's native trust review (non-managed hooks are skipped until trusted via
// /hooks) is an install-time user step the test does not simulate — executing
// the installed command directly IS the post-trust behavior. The
// --dangerously-bypass-hook-trust flag is not used anywhere.

// TestCodexHookEndToEnd runs the isolated install→fire→resolve chain.
func TestCodexHookEndToEnd(t *testing.T) {
	if os.Getenv("RK_HOOK_SUBPROC") == "1" {
		// Child: run the installed argv through the real CLI dispatch. The shim
		// appends the hook argv after `--`, so flag.Args() carries it.
		rootCmd.SetArgs(flag.Args())
		execute()
		os.Exit(0) // unreachable when execute() errored — it os.Exits itself
	}

	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available — skipping integration test")
	}
	server := fmt.Sprintf("rk-test-codex-%d-%d", os.Getpid(), time.Now().UnixNano())
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if out, err := exec.CommandContext(ctx, "tmux", "-L", server, "new-session", "-d", "-s", "boot").CombinedOutput(); err != nil {
		t.Skipf("could not start isolated tmux server %q: %v\n%s", server, err, string(out))
	}
	t.Cleanup(func() {
		killCtx, cancelKill := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelKill()
		_ = exec.CommandContext(killCtx, "tmux", "-L", server, "kill-server").Run()
	})
	tmuxOut := func(args ...string) string {
		t.Helper()
		c, cxl := context.WithTimeout(context.Background(), 5*time.Second)
		defer cxl()
		out, err := exec.CommandContext(c, "tmux", append([]string{"-L", server}, args...)...).CombinedOutput()
		if err != nil {
			t.Fatalf("tmux %v: %v\n%s", args, err, string(out))
		}
		return strings.TrimSpace(string(out))
	}
	socket := tmuxOut("display-message", "-p", "#{socket_path}")
	pane := tmuxOut("display-message", "-p", "#{pane_id}")

	// Isolated codex home + the registry's codex row installed with --yes.
	codexHome := t.TempDir()
	t.Setenv("CODEX_HOME", codexHome)
	t.Setenv("COPILOT_HOME", "")
	t.Setenv("KIMI_CODE_HOME", "")
	var codexCfg agentConfig
	for _, ac := range agentRegistry(t.TempDir()) {
		if ac.provider == "codex" {
			codexCfg = ac
		}
	}
	if codexCfg.provider == "" {
		t.Fatal("codex registry row missing")
	}

	// The shim stands in for the rk binary: it re-execs the test binary into
	// the child branch above with the hook argv carried after `--`.
	shim := filepath.Join(t.TempDir(), "rk-shim")
	shimBody := "#!/bin/sh\nexec " + os.Args[0] + " -test.run '^TestCodexHookEndToEnd$' -- \"$@\"\n"
	if err := os.WriteFile(shim, []byte(shimBody), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := validateHookPath(shim); err != nil {
		t.Fatalf("shim path must pass validateHookPath: %v", err)
	}
	applyYes(t, codexCfg, shim, false)

	// Extract the INSTALLED SessionStart command verbatim from hooks.json —
	// the test executes what the install wrote, not a reconstructed string.
	settings, err := readSettings(codexCfg.settingsPath)
	if err != nil {
		t.Fatal(err)
	}
	hookCommandFor := func(event string) string {
		t.Helper()
		for _, e := range asSlice(asMap(settings["hooks"])[event]) {
			for _, h := range asSlice(asMap(e)["hooks"]) {
				if cmd, _ := asMap(h)["command"].(string); strings.Contains(cmd, " agent hook ") {
					return cmd
				}
			}
		}
		t.Fatalf("no rk command installed for %s", event)
		return ""
	}

	sessionID := "01a06319-6a63-7791-84df-86736cd58e2e"
	fire := func(command, payload string) {
		t.Helper()
		c, cxl := context.WithTimeout(context.Background(), 10*time.Second)
		defer cxl()
		// Execute the installed sh -c wrapper verbatim — exactly what Codex
		// runs for a command hook.
		cmd := exec.CommandContext(c, "/bin/sh", "-c", command)
		cmd.Env = []string{
			"PATH=" + os.Getenv("PATH"),
			"TMUX=" + socket + ",1,0",
			"TMUX_PANE=" + pane,
			"RK_HOOK_SUBPROC=1",
		}
		cmd.Stdin = strings.NewReader(payload)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("installed hook command failed: %v\n%s", err, string(out))
		}
	}
	paneOption := func(name string) string {
		return tmuxOut("show-options", "-pqv", "-t", pane, name)
	}

	// 1. SessionStart (startup): stamps identity AND the boot idle state.
	fire(hookCommandFor("SessionStart"),
		`{"session_id":"`+sessionID+`","transcript_path":null,"cwd":"/tmp","hook_event_name":"SessionStart","source":"startup"}`)
	if got := paneOption(tmux.AgentSessionOption); got != "codex:"+sessionID {
		t.Errorf("@rk_pane_agent_session = %q, want codex:%s", got, sessionID)
	}
	// The legacy dual-write lands too (deprecation window).
	if got := paneOption(tmux.LegacyAgentSessionOption); got != "codex:"+sessionID {
		t.Errorf("@rk_pane_chat = %q, want the dual-written identity", got)
	}
	state := paneOption(tmux.AgentStateOption)
	if !strings.HasPrefix(state, "idle:") {
		t.Errorf("@rk_pane_agent_state = %q, want the boot idle write", state)
	}

	// 2. A PreToolUse fire moves the pane to active.
	fire(hookCommandFor("PreToolUse"),
		`{"session_id":"`+sessionID+`","hook_event_name":"PreToolUse","tool_name":"Bash","turn_id":"t1"}`)
	if got := paneOption(tmux.AgentStateOption); !strings.HasPrefix(got, "active:") {
		t.Errorf("after PreToolUse @rk_pane_agent_state = %q, want active:*", got)
	}

	// 3. A mid-turn compaction re-stamps identity but must NOT clobber active.
	fire(hookCommandFor("SessionStart"),
		`{"session_id":"`+sessionID+`","hook_event_name":"SessionStart","source":"compact"}`)
	if got := paneOption(tmux.AgentStateOption); !strings.HasPrefix(got, "active:") {
		t.Errorf("source=compact clobbered the live state: %q, want active:* preserved", got)
	}
	if got := paneOption(tmux.AgentSessionOption); got != "codex:"+sessionID {
		t.Errorf("identity after compact = %q, want re-stamped codex identity", got)
	}

	// 4. A Stop fire lands idle (turn end).
	fire(hookCommandFor("Stop"),
		`{"session_id":"`+sessionID+`","hook_event_name":"Stop","stop_hook_active":false}`)
	if got := paneOption(tmux.AgentStateOption); !strings.HasPrefix(got, "idle:") {
		t.Errorf("after Stop @rk_pane_agent_state = %q, want idle:*", got)
	}

	// 5. The session's rollout transcript resolves from the stamped identity —
	// the seam fix-tab-name's operator request consumes.
	dayDir := filepath.Join(codexHome, "sessions", "2026", "09", "09")
	if err := os.MkdirAll(dayDir, 0o755); err != nil {
		t.Fatal(err)
	}
	rollout := filepath.Join(dayDir, "rollout-2026-09-09T10-00-00-"+sessionID+".jsonl")
	if err := os.WriteFile(rollout, []byte("{\"type\":\"session_meta\",\"session_id\":\""+sessionID+"\"}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := transcript.Path("codex", sessionID)
	if err != nil {
		t.Fatalf("transcript.Path(codex) = %v", err)
	}
	if got != rollout {
		t.Errorf("transcript.Path = %q, want %q", got, rollout)
	}
}

// TestAgyHookEndToEnd is the Antigravity arm of the isolated end-to-end proof:
// isolated tmux server + isolated HOME; the registry's agy row installed for
// real; the INSTALLED PreInvocation/Stop commands extracted from the written
// hooks.json and executed verbatim (as agy runs them post-install), with
// protojson payloads on stdin. Asserts identity + active, the fullyIdle gate
// on Stop, the {} no-decision stdout contract, and transcript resolution via
// the documented brain/<conversationId>/ layout. No live agent touched.
func TestAgyHookEndToEnd(t *testing.T) {
	if os.Getenv("RK_HOOK_SUBPROC") == "agy" {
		rootCmd.SetArgs(flag.Args())
		execute()
		os.Exit(0)
	}

	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available — skipping integration test")
	}
	server := fmt.Sprintf("rk-test-agy-%d-%d", os.Getpid(), time.Now().UnixNano())
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if out, err := exec.CommandContext(ctx, "tmux", "-L", server, "new-session", "-d", "-s", "boot").CombinedOutput(); err != nil {
		t.Skipf("could not start isolated tmux server %q: %v\n%s", server, err, string(out))
	}
	t.Cleanup(func() {
		killCtx, cancelKill := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelKill()
		_ = exec.CommandContext(killCtx, "tmux", "-L", server, "kill-server").Run()
	})
	tmuxOut := func(args ...string) string {
		t.Helper()
		c, cxl := context.WithTimeout(context.Background(), 5*time.Second)
		defer cxl()
		out, err := exec.CommandContext(c, "tmux", append([]string{"-L", server}, args...)...).CombinedOutput()
		if err != nil {
			t.Fatalf("tmux %v: %v\n%s", args, err, string(out))
		}
		return strings.TrimSpace(string(out))
	}
	socket := tmuxOut("display-message", "-p", "#{socket_path}")
	pane := tmuxOut("display-message", "-p", "#{pane_id}")

	home := t.TempDir()
	t.Setenv("CODEX_HOME", "")
	t.Setenv("COPILOT_HOME", "")
	t.Setenv("KIMI_CODE_HOME", "")
	var agyCfg agentConfig
	for _, ac := range agentRegistry(home) {
		if ac.provider == "agy" {
			agyCfg = ac
		}
	}
	if agyCfg.provider == "" {
		t.Fatal("agy registry row missing")
	}

	shim := filepath.Join(t.TempDir(), "rk-shim")
	shimBody := "#!/bin/sh\nexec " + os.Args[0] + " -test.run '^TestAgyHookEndToEnd$' -- \"$@\"\n"
	if err := os.WriteFile(shim, []byte(shimBody), 0o755); err != nil {
		t.Fatal(err)
	}
	applyYes(t, agyCfg, shim, false)

	settings, err := readSettings(agyCfg.settingsPath)
	if err != nil {
		t.Fatal(err)
	}
	rkEntry := asMap(settings[rkNamedHookKey])
	if rkEntry == nil {
		t.Fatal("run-kit named hook missing from installed hooks.json")
	}
	flatCommand := func(event string) string {
		t.Helper()
		for _, h := range asSlice(rkEntry[event]) {
			if cmd, _ := asMap(h)["command"].(string); strings.Contains(cmd, " agent hook ") {
				return cmd
			}
		}
		t.Fatalf("no rk command installed for %s", event)
		return ""
	}

	conversationID := "ec33ebf9-0cba-4100-8142-c61503f6c587"
	fire := func(command, payload string) string {
		t.Helper()
		c, cxl := context.WithTimeout(context.Background(), 10*time.Second)
		defer cxl()
		cmd := exec.CommandContext(c, "/bin/sh", "-c", command)
		cmd.Env = []string{
			"PATH=" + os.Getenv("PATH"),
			"HOME=" + home,
			"TMUX=" + socket + ",1,0",
			"TMUX_PANE=" + pane,
			"RK_HOOK_SUBPROC=agy",
		}
		cmd.Stdin = strings.NewReader(payload)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("installed hook command failed: %v\n%s", err, string(out))
		}
		return string(out)
	}
	paneOption := func(name string) string {
		return tmuxOut("show-options", "-pqv", "-t", pane, name)
	}

	// PreInvocation: active + identity, and the {} no-decision stdout contract.
	out := fire(flatCommand("PreInvocation"),
		`{"conversationId":"`+conversationID+`","invocationNum":1,"modelName":"auto","workspacePaths":["/tmp"]}`)
	if strings.TrimSpace(out) != "{}" {
		t.Errorf("hook stdout = %q, want exactly {} (the no-decision result)", out)
	}
	if got := paneOption(tmux.AgentSessionOption); got != "agy:"+conversationID {
		t.Errorf("@rk_pane_agent_session = %q, want agy:%s", got, conversationID)
	}
	if got := paneOption(tmux.AgentStateOption); !strings.HasPrefix(got, "active:") {
		t.Errorf("after PreInvocation @rk_pane_agent_state = %q, want active:*", got)
	}

	// Stop with fullyIdle=false must NOT idle (background tasks may run).
	fire(flatCommand("Stop"),
		`{"conversationId":"`+conversationID+`","terminationReason":"model_stop","fullyIdle":false}`)
	if got := paneOption(tmux.AgentStateOption); !strings.HasPrefix(got, "active:") {
		t.Errorf("Stop(fullyIdle=false) clobbered state: %q, want active:* preserved", got)
	}

	// Stop with fullyIdle=true lands idle.
	fire(flatCommand("Stop"),
		`{"conversationId":"`+conversationID+`","terminationReason":"model_stop","fullyIdle":true}`)
	if got := paneOption(tmux.AgentStateOption); !strings.HasPrefix(got, "idle:") {
		t.Errorf("after Stop(fullyIdle) @rk_pane_agent_state = %q, want idle:*", got)
	}

	// The conversation resolves through the documented brain layout (the
	// adapter's root seam honors $HOME via os.UserHomeDir in this process).
	t.Setenv("HOME", home)
	logDir := filepath.Join(home, ".gemini", "antigravity-cli", "brain", conversationID, ".system_generated", "logs")
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		t.Fatal(err)
	}
	transcriptPath := filepath.Join(logDir, "transcript.jsonl")
	if err := os.WriteFile(transcriptPath, []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := transcript.Path("agy", conversationID)
	if err != nil {
		t.Fatalf("transcript.Path(agy) = %v", err)
	}
	if got != transcriptPath {
		t.Errorf("transcript.Path = %q, want %q", got, transcriptPath)
	}
}
