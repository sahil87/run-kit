# run-kit skill: tutorial

An agent-run, live first-use tour of run-kit: eight short chapters and a finale in about ten minutes. This is a static topic page (`rk skill tutorial`); the [core bundle](../skill.md) is the general usage briefing.

Gate first:

```sh
command -v rk >/dev/null 2>&1 && [ -n "$TMUX_PANE" ]
```

If either check fails, STOP: tell the user to open the run-kit dashboard, create a session/window for this directory, run the agent inside it, then ask for the tutorial again.

## Pacing and failure posture

- Deliver exactly one chapter per reply. End with: *Say **next** when you're ready, or ask me anything about what you just saw.* Answer questions, then re-offer the next chapter.
- `skip` advances one chapter. `stop` or `done` jumps to Cleanup.
- Use 2–4 sentences, perform the action, then give one sentence saying where to look. Never skip ahead or stack chapters.
- CLI option writes repaint on the server safety poll: allow up to ~12s and run one visible mutation per beat. Say "give it a few seconds" the first time. UI-originated writes repaint instantly.
- Degrade, never error. If code-server, push, or a companion page is unavailable, explain in one line, show what the step would do, and continue.

## Preflight — run silently, then end the turn

1. Read and skim `rk skill`; read `rk skill display` before Chapter 3 and `rk skill code` before Chapter 5.
2. If `/tmp/rk-tutorial/original-state.json` exists, a prior run is stale: perform Cleanup against those captures before continuing.
3. Capture the current tab before changing it:

   ```sh
   mkdir -p /tmp/rk-tutorial
   rk tab show --json > /tmp/rk-tutorial/original-state.json
   rk tab web ls --json > /tmp/rk-tutorial/original-webtabs.json 2>/dev/null || true
   RK="$(rk url)"
   ```

At each chapter's start, present its named companion with `rk present "$RK/tutorial/ch<N>-<slug>.html"`. Greet the user: run-kit is a web dashboard over tmux where people and agents share a workspace; this reversible tour opens an illustrated tab per chapter. Ask them to view this window in the dashboard, explain the pacing rule, and end the turn.

## Chapter 1 — Where am I (`ch1-orientation`)

```sh
rk present "$RK/tutorial/ch1-orientation.html"
tmux display-message -t "$TMUX_PANE" -p 'pane #{pane_id} · session #S · window #W'
rk url
```

Connect the live values to the companion's conceptual host → tmux server → session → window/tab → pane stack. Point to this session/window in the real sidebar and terminal tile; on desktop, the status bar mirrors current-window registers and active-pane identity on the left, with tmux server and host details on the right (`rk url` is command output, not a bar segment). Close the loop: tmux is the store, the dashboard derives and renders it; there is no database.

## Chapter 2 — Sidebar signals (`ch2-signals`)

```sh
rk present "$RK/tutorial/ch2-signals.html"
```

UI first, one action at a time: press the marker well at this window row's left edge; on a fine pointer drag across the 3×3 `manual/auto/blocked` × stage pad and release, while touch uses tap then pick. Ask for `auto:2`. Hover the row to see its flyout: `Change color…` plus the note line when set. Show ⌘K (⇧Ctrl+K on Win/Linux) searches for `marker`, `color`, and `note` (`Tab: Marker`, `Tab: Set Color`, `Window: Set note…`).

Close from the shell, one beat at a time, noting the poll delay and that `blocked` means "I'm stuck":

```sh
tmux set-option -w @rk_win_flair nyan
tmux set-option -w @rk_win_note "$(date +%s):tutorial in progress — chapter 2"
```

## Chapter 3 — Show, don't tell (`ch3-present`)

```sh
rk present "$RK/tutorial/ch3-present.html"
```

Explain agent → generated page → `rk present` → web tile; these companions use that path. Create a small dark monospace `/tmp/rk-tutorial/welcome.html` with a heading and timestamp, run `rk present /tmp/rk-tutorial/welcome.html`, edit its heading, and run the same command again: **re-present is the refresh verb**.

Teach the phrase **"present it to me"**, then role-flip: invite a small visual request, fulfill it next turn, present it, and point out the same recipe. Mention targets may also be a directory, `:port`, or external URL.

## Chapter 4 — Arranging the view (`ch4-layouts`)

```sh
rk present "$RK/tutorial/ch4-layouts.html"
```

The arrangement is shared `@rk_win_layout` state; toolbar and CLI write the same model. Run each line as a separate beat/reply: read the current value aloud, mutate, point to the top-bar surface toggles, then END with *tell me when you see it (can take ~10s) — then say next*.

```sh
rk tab layout
rk tab layout split-v:web,tty
rk tab layout --promote tty
rk tab layout split-h:tty,web
```

Mention `single:tty` collapses to terminal, but never run it mid-tour because it hides the companions.

## Chapter 5 — The code lens (`ch5-code`)

```sh
rk present "$RK/tutorial/ch5-code.html"
rk tab layout --add code
rk tab code set "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
```

After the poll beat, point to the code tile. If code-server is down, name the graceful empty state and continue. If `rk code hosts` prints a host, open README without a mouse:

```sh
rk code exec vscode.open "{\"\$uri\":\"file://$(git rev-parse --show-toplevel)/README.md\"}"
rk tab layout --rm code
```

## Chapter 6 — The web-tab strip (`ch6-webtabs`)

```sh
rk present "$RK/tutorial/ch6-webtabs.html"
rk tab web ls
```

Read the indexed tabs together (`*` is active, cap 8). Run `rk tab web select 1`; clicking a strip tab writes the same shared selection. Point to **↗ Open in browser** at the URL bar's right end and in frame-blocked errors; have the user try it. Tidy Ch1–Ch5 companions and `welcome.html` with `rk tab web rm <n>`, checking `rk tab web ls` after each because slots renumber densely; leave this chapter open.

## Chapter 7 — The command palette (`ch7-keyboard`)

```sh
rk present "$RK/tutorial/ch7-keyboard.html"
```

Every user-facing action is registered in the palette: ⌘K (⇧Ctrl+K on Win/Linux), then search `marker`, `layout`, and `web`; let the user run one. Settings is ⌘, in the desktop app, palette → `settings` in mac browsers (which reserve ⌘,), and ⇧Ctrl+, on Win/Linux. The Shortcuts tab toggles with ⌘/ on macOS or ⇧Ctrl+/ on Win/Linux and lists every binding; app bindings are remappable, while tmux bindings are locked. Takeaway: ⌘K is how to find what this tour omits.

## Chapter 8 — The operator (`ch8-operator`)

```sh
rk present "$RK/tutorial/ch8-operator.html"
```

An operator is the coordinating agent pinned at the top of its server group, below the server header and above its session rows. You ask it in plain language: *Start a claude session on <repo>*; *Start a kimi session*; *Start a claude session, but with codex workers*. If its row exists, invite one small ask; otherwise say it starts from the server page and leave that as day two.

## Finale — Attention, Cleanup, recap

An agent never moves the user's navigation; it uses sidebar signals and fail-silent push:

```sh
rk notify "tutorial complete 🎉 — you now know more than most" --title run-kit
```

### Cleanup

Read `/tmp/rk-tutorial/original-state.json` and `original-webtabs.json`. First compare `rk tab web ls --json` with the web-tab capture and remove every tab absent from it, highest index first so original tabs survive dense renumbering. Then, for every `@rk_win_*` key in the original-state capture, restore its value with `tmux set-option -w <key> <value>`. Inspect the current `rk tab show --json` and use `tmux set-option -wu <key>` for every current `@rk_win_*` key absent from the capture. Run `rk tab show --json` again and compare it with the original-state capture to verify the window state is restored, then:

```sh
rm -rf /tmp/rk-tutorial
```

Recap: **⌘K** finds actions; **"present it to me"** requests visuals; `rk present`, `rk tab layout`, `rk tab web`, `rk tab code set`, `rk code exec`, and `rk notify` are the agent verbs; marker/flyout signals and the operator carry human attention and delegation. Point to `rk skill` plus its `display`, `mux`, `code`, and `tutorial` topics, then invite one solo experiment.
