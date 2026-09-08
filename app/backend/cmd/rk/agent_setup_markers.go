package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// agent_setup_markers.go — the kindMarkerFile and kindMarkerBlock installer
// kinds (agent_setup.go's agentConfig): whole marker-owned files (copilot's
// hooks/run-kit.json, opencode's run-kit.js plugin) and the marker-owned
// [[hooks]] block inside kimi's user-owned config.toml. Both share the
// ownership discipline of the tmux guard shim: rk creates/replaces/removes
// exactly what it owns, and a foreign marker-less target is never touched.

// --- ownership ---------------------------------------------------------------

// markerFileOwned reports whether file content is wholly rk-owned. Two shapes:
//   - files carrying the managed-by comment marker (opencode's JS plugin) are
//     rk-authored outright;
//   - a JSON hooks file (copilot) is rk-owned only when it parses AND every
//     hook entry's command carries an rk invocation marker — a MIXED file (the
//     user's own entries plus one rk-marked command, or a user-edited copy of
//     our file) is deliberately NOT treated as ours, so install/uninstall can
//     never overwrite or delete unrelated user hooks. A file with zero
//     command entries is not ours either.
func markerFileOwned(content string) bool {
	if strings.Contains(content, skillManagedByMarker) {
		return true
	}
	var doc map[string]any
	if json.Unmarshal([]byte(content), &doc) != nil {
		return false
	}
	hooks := asMap(doc["hooks"])
	if hooks == nil {
		return false
	}
	n := 0
	for _, ev := range hooks {
		for _, e := range asSlice(ev) {
			cmd, ok := asMap(e)["command"].(string)
			if !ok || (!strings.Contains(cmd, rkHookMarkerAgentHook) && !strings.Contains(cmd, rkHookMarkerAgentHookFamily)) {
				return false
			}
			n++
		}
	}
	return n > 0
}

// applyAgentMarkerFile installs (or --uninstall removes) a whole marker-owned
// file: ac.fileContent(rkPath) is the desired content. Mirrors
// installTmuxShimFile's discipline: a marker-less foreign file (including a
// zero-byte one) is left untouched; an already-current file is a no-op; a
// change is shown as a diff (--dry-run) or a one-line summary, then written on
// consent with the parent dir created. Uninstall removes only an owned file;
// absent is silent. The now-empty parent dir is pruned best-effort on removal.
func applyAgentMarkerFile(sink outputSink, reader *bufio.Reader, ac agentConfig, rkPath string, uninstall bool, cons consent) error {
	current, exists, err := readFileIfExists(ac.filePath)
	if err != nil {
		return fmt.Errorf("%s: read %s: %w", ac.name, ac.filePath, err)
	}

	if uninstall {
		if !exists {
			return nil
		}
		if !markerFileOwned(current) {
			sink.Notef("%s: %s carries no rk marker — leaving it untouched (rk only removes files it owns).\n", ac.name, ac.filePath)
			return nil
		}
		ok, err := cons.authorizeWrite(sink.data, reader, fmt.Sprintf("%s: dry run — %s left in place (nothing removed).", ac.name, ac.filePath), fmt.Sprintf("Remove %s? [y/N] ", ac.filePath))
		if err != nil {
			return err
		}
		if !ok {
			if !cons.dryRun {
				sink.Notef("%s: %s left in place (nothing removed).\n", ac.name, ac.filePath)
			}
			return nil
		}
		if err := os.Remove(ac.filePath); err != nil {
			return fmt.Errorf("%s: remove %s: %w", ac.name, ac.filePath, err)
		}
		// Best-effort prune of the file's dir (os.Remove refuses non-empty
		// dirs, so this can never delete anything else).
		_ = os.Remove(filepath.Dir(ac.filePath))
		sink.Notef("%s: removed %s.\n", ac.name, ac.filePath)
		return nil
	}

	if exists && !markerFileOwned(current) {
		sink.Notef("%s: %s exists without an rk marker — leaving it untouched (rk only overwrites files it owns).\n", ac.name, ac.filePath)
		return nil
	}
	desired := ac.fileContent(rkPath)
	if current == desired {
		sink.Notef("%s: %s already installed — nothing to do.\n", ac.name, ac.filePath)
		return nil
	}

	header := fmt.Sprintf("%s: will install %s", ac.name, ac.filePath)
	if exists {
		header = fmt.Sprintf("%s: will update the rk-owned %s", ac.name, ac.filePath)
	}
	if cons.dryRun {
		renderArtifactDiff(cons.diffWriter(sink), header, strings.TrimSuffix(current, "\n"), strings.TrimSuffix(desired, "\n"))
	} else {
		fmt.Fprintf(cons.diffWriter(sink), "%s (rk-owned file, %d lines).\n", header, len(strings.Split(strings.TrimSuffix(desired, "\n"), "\n")))
	}
	ok, err := cons.authorizeWrite(sink.data, reader, fmt.Sprintf("%s: dry run — no file written.", ac.name), "\nWrite this file? [y/N] ")
	if err != nil {
		return err
	}
	if !ok {
		if !cons.dryRun {
			sink.Notef("%s: skipped (no file written).\n", ac.name)
		}
		return nil
	}

	if err := os.MkdirAll(filepath.Dir(ac.filePath), 0o755); err != nil {
		return fmt.Errorf("%s: create %s: %w", ac.name, filepath.Dir(ac.filePath), err)
	}
	if err := os.WriteFile(ac.filePath, []byte(desired), ac.fileMode); err != nil {
		return fmt.Errorf("%s: write %s: %w", ac.name, ac.filePath, err)
	}
	// WriteFile's perm applies only on create — re-assert the mode explicitly.
	if err := os.Chmod(ac.filePath, ac.fileMode); err != nil {
		return fmt.Errorf("%s: chmod %s: %w", ac.name, ac.filePath, err)
	}
	sink.Notef("%s: wrote %s.\n", ac.name, ac.filePath)
	return nil
}

// applyAgentMarkerBlock upserts (install) or strips (uninstall) the
// marker-owned block in a user-owned file, mirroring
// applyTmuxGuardPathBlocks: a file already in the desired state is a no-op; a
// malformed existing block (begin without end, or a duplicated begin) refuses
// modification with a skip note rather than guessing at the region's extent;
// surrounding user content is preserved byte-exactly (upsertMarkerBlock /
// removeMarkerBlock own that contract). The file is created on install when
// absent.
func applyAgentMarkerBlock(sink outputSink, reader *bufio.Reader, ac agentConfig, rkPath string, uninstall bool, cons consent) error {
	begin, end, block := ac.blockContent(rkPath)

	current, err := readSkill(ac.blockPath)
	if err != nil {
		return fmt.Errorf("%s: read %s: %w", ac.name, ac.blockPath, err)
	}

	var next string
	var blockErr error
	if uninstall {
		next, blockErr = removeMarkerBlock(current, begin, end)
	} else {
		next, blockErr = upsertMarkerBlock(current, begin, end, block)
	}
	if blockErr != nil {
		// Refuse, don't guess: rk cannot know the region's extent.
		sink.Notef("%s: %s: %v — leaving the file untouched (repair or remove the block by hand, then re-run).\n", ac.name, ac.blockPath, blockErr)
		return nil
	}
	if next == current {
		if !uninstall {
			sink.Notef("%s: hooks block already present in %s — nothing to do.\n", ac.name, ac.blockPath)
		}
		return nil
	}

	action := "add"
	if uninstall {
		action = "remove"
	}
	header := fmt.Sprintf("%s: will %s the rk hooks block in %s", ac.name, action, ac.blockPath)
	if cons.dryRun {
		// Render ONLY the marker-owned region, never the whole file: a block
		// target (kimi's config.toml) routinely carries user secrets (API
		// keys), and a full-file dry-run diff would echo them to the terminal
		// during a routine preview.
		currentBlock := "(no rk block present)"
		lines := strings.Split(current, "\n")
		if start, stop, found, err := markerBlockBounds(lines, begin, end); err == nil && found {
			currentBlock = strings.Join(lines[start:stop+1], "\n")
		}
		proposedBlock := "(block removed)"
		if !uninstall {
			proposedBlock = block
		}
		renderArtifactDiff(cons.diffWriter(sink), header, currentBlock, proposedBlock)
	} else {
		out := cons.diffWriter(sink)
		fmt.Fprintf(out, "%s:\n", header)
		for _, line := range strings.Split(strings.TrimSuffix(block, "\n"), "\n") {
			fmt.Fprintf(out, "  %s\n", line)
		}
	}
	ok, err := cons.authorizeWrite(sink.data, reader, fmt.Sprintf("%s: dry run — %s not modified.", ac.name, ac.blockPath), "\nWrite these changes? [y/N] ")
	if err != nil {
		return err
	}
	if !ok {
		if !cons.dryRun {
			sink.Notef("%s: skipped %s (no changes written).\n", ac.name, ac.blockPath)
		}
		return nil
	}

	mode := os.FileMode(0o600)
	if info, statErr := os.Stat(ac.blockPath); statErr == nil {
		mode = info.Mode().Perm()
	}
	if err := os.MkdirAll(filepath.Dir(ac.blockPath), 0o755); err != nil {
		return fmt.Errorf("%s: create %s: %w", ac.name, filepath.Dir(ac.blockPath), err)
	}
	if err := os.WriteFile(ac.blockPath, []byte(next), mode); err != nil {
		return fmt.Errorf("%s: write %s: %w", ac.name, ac.blockPath, err)
	}
	sink.Notef("%s: wrote %s.\n", ac.name, ac.blockPath)
	return nil
}

// --- agy (kindJSONHooksMerge, named-hooks document) ---------------------------

// rkNamedHookKey is the single top-level hook name rk owns in an Antigravity
// hooks.json (a named-hooks document: every other top-level key is the user's
// or a plugin's and is never touched).
const rkNamedHookKey = "run-kit"

// agyNamedHookEntry builds the run-kit named hook: FLAT handler arrays for
// agy's flat events (PreInvocation/Stop — tool events use matcher groups,
// which run-kit deliberately never registers: their contract answers
// permission decisions). Handlers carry the JSON-output wrapper (agy's
// contract parses stdout as a result object; `{}` is the no-decision answer).
func agyNamedHookEntry(rkPath string) map[string]any {
	handler := func(state string) map[string]any {
		return map[string]any{
			"type":    "command",
			"command": agentStateHookCommandJSON(rkPath, state, "agy"),
			"timeout": 30,
		}
	}
	return map[string]any{
		"PreInvocation": []any{handler(agentStateActive)},
		"Stop":          []any{handler(agentStateIdle)},
	}
}

// mergeNamedHook replaces rk's named entry in place (idempotent); every other
// named hook is preserved untouched.
func mergeNamedHook(settings map[string]any, rkPath string) {
	settings[rkNamedHookKey] = agyNamedHookEntry(rkPath)
}

// unmergeNamedHook removes exactly rk's named entry.
func unmergeNamedHook(settings map[string]any) {
	delete(settings, rkNamedHookKey)
}

// countRkOwned counts rk-owned hook artifacts for the consent summary: the
// named-key presence for a namedHooksDoc, else the marker-carrying entry count
// across the events tree.
func countRkOwned(ac agentConfig, settings map[string]any) int {
	if ac.namedHooksDoc {
		if _, ok := settings[rkNamedHookKey]; ok {
			return 1
		}
		return 0
	}
	return countRkEntries(settings)
}

// --- copilot (kindMarkerFile, JSON) ------------------------------------------

// copilotHooks is the Copilot CLI event mapping (agentRegistry's copilot row
// carries the same slice — one list drives both the file content and the
// consent summary). camelCase event names select Copilot's camelCase payload
// (sessionId) — see docs.github.com/en/copilot/reference/hooks-reference
// (verified 2026-09-09, CLI 1.0.78).
var copilotHooks = []agentHook{
	{event: "sessionStart", state: agentHookStampToken},
	{event: "userPromptSubmitted", state: agentStateActive},
	{event: "preToolUse", state: agentStateActive},
	{event: "permissionRequest", state: agentStateWaiting},
	{event: "notification", matcher: "permission_prompt|elicitation_dialog", state: agentStateWaiting},
	{event: "notification", matcher: "agent_idle", state: agentStateIdle},
	{event: "agentStop", state: agentStateIdle},
}

// copilotHooksFile renders $COPILOT_HOME/hooks/run-kit.json: {"version": 1,
// "hooks": {<event>: [entries]}} with FLAT command entries (matcher rides the
// entry itself — Copilot's shape is not Claude's nested one). The wrapper
// command is the same stable delegating sh -c line every harness gets; the
// never-fail exit-0 contract is load-bearing here because Copilot's preToolUse
// command hooks deny the tool call on any non-zero exit.
func copilotHooksFile(rkPath string) string {
	hooks := map[string]any{}
	for _, h := range copilotHooks {
		entry := map[string]any{
			"type":    "command",
			"command": agentStateHookCommand(rkPath, h.state, "copilot"),
		}
		if h.matcher != "" {
			entry["matcher"] = h.matcher
		}
		hooks[h.event] = append(asSlice(hooks[h.event]), entry)
	}
	data, err := json.MarshalIndent(map[string]any{"version": 1, "hooks": hooks}, "", "  ")
	if err != nil {
		return ""
	}
	return string(append(data, '\n'))
}

// --- kimi (kindMarkerBlock, TOML) --------------------------------------------

// kimiHooksBlockBegin/End delimit the marker-owned [[hooks]] region in kimi's
// config.toml (same begin/end discipline as the tmux guard PATH block).
const (
	kimiHooksBlockBegin = "# >>> rk agent hooks >>>"
	kimiHooksBlockEnd   = "# <<< rk agent hooks <<<"
)

// kimiHooks is the Kimi Code event mapping (verified 2026-09-09 against
// moonshotai.github.io/kimi-code hooks docs, CLI 0.41.0). SessionStart sources
// are startup|resume — no mid-turn compaction source exists, so the stamp
// token's compact gate is inert for kimi.
var kimiHooks = []agentHook{
	{event: "SessionStart", state: agentHookStampToken},
	{event: "TurnStarted", state: agentStateActive},
	{event: "PreToolUse", state: agentStateActive},
	{event: "PermissionRequest", state: agentStateWaiting},
	{event: "Stop", state: agentStateIdle},
}

// kimiHooksBlock renders the marker-owned TOML region: one [[hooks]]
// array-of-tables entry per mapped event, carrying ONLY the documented fields
// (event, matcher, command) — kimi refuses to load a config whose [[hooks]]
// entries carry unknown fields. The block is appended to (or replaced within)
// the user's config.toml; no TOML parser is involved.
func kimiHooksBlock(rkPath string) (begin, end, block string) {
	var b strings.Builder
	b.WriteString(kimiHooksBlockBegin + "\n")
	for _, h := range kimiHooks {
		b.WriteString("[[hooks]]\n")
		fmt.Fprintf(&b, "event = %s\n", tomlBasicString(h.event))
		if h.matcher != "" {
			fmt.Fprintf(&b, "matcher = %s\n", tomlBasicString(h.matcher))
		}
		fmt.Fprintf(&b, "command = %s\n", tomlBasicString(agentStateHookCommand(rkPath, h.state, "kimi")))
		b.WriteString("\n")
	}
	b.WriteString(kimiHooksBlockEnd + "\n")
	return kimiHooksBlockBegin, kimiHooksBlockEnd, b.String()
}

// tomlBasicString renders s as a TOML basic string. The embedded hook command
// carries double quotes (around the rk path), so `"` and `\` are escaped; the
// path itself is pre-validated by validateHookPath (no ' " $ ` \), and event
// names/matchers are fixed registry literals.
func tomlBasicString(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	return `"` + s + `"`
}

// --- opencode (kindMarkerFile, JS plugin) ------------------------------------

// opencodePluginFile renders ~/.config/opencode/plugins/run-kit.js — the only
// hook surface OpenCode has is its plugin event stream (no declarative command
// hooks), so the adapter is a small JS plugin that maps events onto the SAME
// stable `rk agent hook` interface every other harness's installed wrapper
// calls. Verified against opencode.ai/docs/plugins and the installed
// @opencode-ai/plugin + @opencode-ai/sdk 1.18.25 types (2026-09-09):
//
//   - session.created      → stamp  (identity + boot idle)
//   - session.status busy  → active
//   - permission.updated   → waiting (the 1.18.25 event name; newer docs split
//     it into permission.asked/permission.replied)
//   - session.idle         → idle
//
// (tool.execute.before exists in 1.18.25 only as a separate plugin-hook key
// with a different signature — never as an event-stream type — so it is not
// mapped; session.status busy covers the active signal.)
//
// ROOT-SESSION RULE (the intake's child-contamination ban): the event stream
// is instance-wide — child/subagent sessions fire the SAME session.* events
// (Session.parentID, sdk types.gen.d.ts), and `rk agent hook` stamps identity
// on every id-carrying fire, so an unfiltered plugin would let a child replace
// the pane's root identity or complete its turn. Every event's session id is
// therefore resolved through client.session.get (parentID absent = root),
// memoized for the opencode process's lifetime; child and unresolvable
// sessions are ignored. This also covers RESUMED roots, which fire no new
// session.created — their first status/idle event resolves parentage the same
// way.
//
// Never-fail parity: the plugin no-ops outside tmux and swallows every error —
// a hook error must never break the agent. It uses node:child_process (not the
// Bun-only `$` shell) so the SAME file also runs under plain node — which is
// how the isolated test executes the installed plugin byte-for-byte.
func opencodePluginFile(rkPath string) string {
	return `// ` + skillManagedByMarker + ` — installed by ` + "`rk agent setup`" + `; do not edit
// (re-running setup replaces this file in place; --uninstall removes it).
//
// Reports OpenCode ROOT-session lifecycle events to run-kit through the stable
// ` + "`rk agent hook`" + ` interface (the same binary entry point the other harnesses'
// installed wrappers call). Child/subagent sessions (Session.parentID set) and
// unresolvable session ids are ignored, so a subagent can never replace the
// pane's root identity or complete its turn. Never fails the agent: no-ops
// outside tmux and swallows every error.
const RK = "` + rkPath + `";

const EVENT_TOKEN = {
  "session.created": "stamp",
  "session.idle": "idle",
  "permission.updated": "waiting",
};

// rootCache memoizes sessionID → isRoot for the life of the opencode process:
// one parentage lookup per session, not per event.
const rootCache = new Map();

async function isRootSession(client, id) {
  if (!id || !client || !client.session || typeof client.session.get !== "function") return false;
  if (rootCache.has(id)) return rootCache.get(id);
  let root = false;
  try {
    const res = await client.session.get({ path: { id } });
    root = !!(res && res.data && !res.data.parentID);
  } catch {
    root = false; // unresolvable session: fail closed (never stamp a maybe-child)
  }
  rootCache.set(id, root);
  return root;
}

function sessionIDOf(event) {
  const p = event.properties || {};
  return p.sessionID || (p.info && p.info.id) || "";
}

// report invokes the stable rk hook interface with the payload on stdin,
// via node:child_process (Bun-compatible; also runs under plain node, which is
// how the isolated test drives this file). Never throws.
async function report(token, id) {
  try {
    const { spawn } = await import("node:child_process");
    await new Promise((resolve) => {
      const child = spawn(RK, ["agent", "hook", "--agent", "opencode", token], { stdio: ["pipe", "ignore", "ignore"] });
      child.on("error", () => resolve());
      child.on("close", () => resolve());
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify({ session_id: id }));
    });
  } catch {
    // never-fail: a hook error must never break the agent
  }
}

export const runKit = async ({ client }) => ({
  event: async ({ event }) => {
    try {
      if (!process.env.TMUX_PANE) return;
      let token = EVENT_TOKEN[event.type];
      const status = event.properties && event.properties.status;
      if (event.type === "session.status" && status && status.type === "busy") {
        token = "active";
      }
      if (!token) return;
      const id = sessionIDOf(event);
      if (!(await isRootSession(client, id))) return;
      await report(token, id);
    } catch {
      // never-fail
    }
  },
});
`
}
