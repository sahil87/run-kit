package main

import "os/exec"

// agent_registry.go — the shared runtime registry of supported agent harnesses.
//
// One descriptor per provider carries everything the HOOK WRITER needs at fire
// time — the process comm literal (ancestor-walk pid validation), the hook
// payload's session-id field shape, and the SessionStart source that fires
// mid-turn — deliberately decoupled from the installer's per-harness config
// placement and format (agent_setup.go). A provider MUST resolve here without
// carrying a Claude-shaped installer entry; the two axes vary independently
// (e.g. a provider whose hooks the user hand-installed still writes state).
//
// The canonical PROVIDER token is what `@rk_pane_agent_session` carries as its
// prefix and what internal/transcript adapters register under. `comm` is the
// process name `ps -o comm=` reports for the harness process (kimi's binary is
// `kimi` but the process runs as `kimi-code`; gemini is a bundled node script,
// so its comm is `node`). Both provider token and comm resolve a descriptor —
// installed hook lines of every generation pass the provider token, and the
// comm match keeps any hand-written line that passed the comm working.

// agentRuntime is one provider's runtime descriptor.
type agentRuntime struct {
	// provider is the canonical lowercase wire token (the
	// @rk_pane_agent_session prefix and the transcript registry key).
	provider string
	// binary is the harness's PATH binary name — the install gate (rk agent
	// setup wires only harnesses present on the machine) and the display
	// handle. Empty when no installer exists for the provider.
	binary string
	// comm is the process-name literal the comm-validated ancestor walk
	// matches (agent_hook.go's resolveAgentPID).
	comm string
	// sessionIDField is the hook payload field carrying the session identity:
	// `session_id` for most harnesses, `sessionId` for Copilot CLI's camelCase
	// event format, `conversationId` for Antigravity CLI's protojson payloads.
	sessionIDField string
	// compactSource is the SessionStart `source` value that fires MID-TURN
	// (context compaction), for which the stamp token's boot idle write is
	// withheld. Empty when the harness's SessionStart has no mid-turn source
	// (gemini's matcher covers startup|resume|clear only; kimi/copilot start
	// sources are startup|resume(/new); agy has no SessionStart at all).
	compactSource string
	// needsJSONOutput reports that the harness parses hook stdout as a JSON
	// result object (agy's hook contract): the installed wrapper emits `{}`
	// after reporting, so the fire is a well-formed no-decision result — an
	// absent decision field means default behavior everywhere (never an
	// allow/deny or forced continuation emitted for telemetry).
	needsJSONOutput bool
	// idleRequiresFullyIdle gates the idle STATE write on the payload's
	// `fullyIdle: true` (agy's Stop fires when the execution loop terminates,
	// including with background tasks still running — only a fully-idle stop
	// is the at-rest signal). An unparseable or fullyIdle-less payload skips
	// the idle write (fail-safe); the identity stamp still proceeds.
	idleRequiresFullyIdle bool
}

// hookSourceCompact is the claude/codex SessionStart source that fires
// mid-turn (context compaction): the stamp token's idle write is withheld for
// it.
const hookSourceCompact = "compact"

// agentRuntimes is the runtime registry. Evidence per entry (verified
// 2026-09-09 against current vendor docs and the installed versions — the
// versioned matrix lives in docs/site/agent-hooks.md):
//
//   - claude: Claude Code hooks, ~/.claude/settings.json (comm `claude`).
//   - codex: Codex CLI 0.153.4 hooks (stable, on by default),
//     ~/.codex/hooks.json; payload session_id; SessionStart sources
//     startup|resume|clear|compact (comm `codex`).
//   - gemini: Gemini CLI 0.54.4 settings.json hooks; payload session_id
//     (comm `node` — a bundled node script).
//   - copilot: Copilot CLI 1.0.78 hook files, ~/.copilot/hooks/*.json;
//     camelCase events carry sessionId (comm `copilot`).
//   - kimi: Kimi Code CLI 0.41.0 [[hooks]] in ~/.kimi-code/config.toml;
//     payload session_id (comm `kimi-code`, though the binary is `kimi`).
//   - opencode: OpenCode 1.18.25 plugin event stream; the installed plugin
//     (marker-owned run-kit.js) pipes a session_id payload itself (comm
//     `opencode`).
//   - agy: Antigravity CLI 1.1.11 hooks.json (named hooks; PreInvocation/Stop
//     flat handlers), ~/.gemini/config/hooks.json; protojson payloads carry
//     conversationId (comm `agy`).
func agentRuntimes() []agentRuntime {
	return []agentRuntime{
		{provider: "claude", binary: "claude", comm: "claude", sessionIDField: "session_id", compactSource: hookSourceCompact},
		{provider: "codex", binary: "codex", comm: "codex", sessionIDField: "session_id", compactSource: hookSourceCompact},
		{provider: "gemini", binary: "gemini", comm: "node", sessionIDField: "session_id"},
		{provider: "copilot", binary: "copilot", comm: "copilot", sessionIDField: "sessionId"},
		{provider: "kimi", binary: "kimi", comm: "kimi-code", sessionIDField: "session_id"},
		{provider: "opencode", binary: "opencode", comm: "opencode", sessionIDField: "session_id"},
		{provider: "agy", binary: "agy", comm: "agy", sessionIDField: "conversationId", needsJSONOutput: true, idleRequiresFullyIdle: true},
	}
}

// agentRuntimeForName resolves a descriptor by provider token OR comm literal
// (both name spaces route here so an installed line and a transcript adapter
// can never disagree about which descriptor a fire means). ok=false for an
// unknown provider — the hook writer's silent no-op path.
func agentRuntimeForName(name string) (agentRuntime, bool) {
	for _, rt := range agentRuntimes() {
		if rt.provider == name || rt.comm == name {
			return rt, true
		}
	}
	return agentRuntime{}, false
}

// hookSessionID extracts the session id from a parsed hook payload using the
// provider's payload shape (agentRuntime.sessionIDField).
func (rt agentRuntime) hookSessionID(in hookInput) string {
	switch rt.sessionIDField {
	case "sessionId":
		return in.SessionIDCamel
	case "conversationId":
		return in.ConversationID
	default:
		return in.SessionID
	}
}

// isCompactSource reports whether source is this provider's mid-turn
// compaction SessionStart source — the one source for which the stamp token's
// boot idle write is withheld. A provider with no mid-turn source (empty
// compactSource) never matches.
func (rt agentRuntime) isCompactSource(source string) bool {
	return rt.compactSource != "" && source == rt.compactSource
}

// agentBinaryOnPathFn is a package-level seam so the installer's PATH gate is
// testable without depending on the host machine's binaries.
var agentBinaryOnPathFn = func(bin string) bool {
	_, err := exec.LookPath(bin)
	return err == nil
}

// agentBinaryOnPath reports whether the provider's harness binary resolves on
// PATH. An unknown provider reports false (nothing to gate installs for).
func agentBinaryOnPath(provider string) bool {
	rt, ok := agentRuntimeForName(provider)
	if !ok || rt.binary == "" {
		return false
	}
	return agentBinaryOnPathFn(rt.binary)
}

// providerBinary returns the harness binary name for display, falling back to
// the provider token.
func (ac agentConfig) providerBinary() string {
	if rt, ok := agentRuntimeForName(ac.provider); ok && rt.binary != "" {
		return rt.binary
	}
	return ac.provider
}
