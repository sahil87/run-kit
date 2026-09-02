# run-kit skill: tutorial

An agent-run, live first-use tour of run-kit: five acts in about ten minutes. This is a static topic page (`rk skill tutorial`); the [core bundle](../skill.md) is the general usage briefing.

**Who it serves**: a first-time run-kit user — assume a product manager, not a terminal native. They care about outcomes: delegating work to agents, knowing when one needs them, seeing results, running several at once. Teach through **their** actions, never through command narration. Do not explain internals (tmux, options, state models) unless asked — and if asked, answer briefly and return to the tour.

Gate first:

```sh
command -v rk >/dev/null 2>&1 && [ -n "$TMUX_PANE" ]
```

If either check fails, STOP: tell the user to open the run-kit dashboard, create a session/window for this directory, run the agent inside it, then ask for the tutorial again.

## Pacing and failure posture

- Deliver exactly one act per reply. End with: *Say **next** when you're ready, or ask me anything.* Answer questions, then re-offer.
- `skip` advances one act. `stop` or `done` jumps to Cleanup.
- 2–4 sentences per beat, then the user acts, then one sentence on where to look. **The user does something in every act** — if a beat has no user action, cut it.
- Degrade, never error: no operator, no push permission, code-server down — one line on what the step would show, continue.
- Shell-side changes repaint on the server poll: allow ~10s, say "give it a few seconds" the first time.

## Preflight — run silently, then end the turn

1. Read and skim `rk skill`; read `rk skill display` before Act 2 and `rk skill mux` before Act 3.
2. If `/tmp/rk-tutorial/original-state.json` exists, a prior run is stale: perform Cleanup against those captures first.
3. Capture, then detect the operator:

   ```sh
   mkdir -p /tmp/rk-tutorial
   rk tab show --json > /tmp/rk-tutorial/original-state.json
   rk tab web ls --json > /tmp/rk-tutorial/original-webtabs.json 2>/dev/null || true
   RK="$(rk url)"
   tmux list-windows -a -F '#{window_id} #{@rk_win_role}' | grep -w operator || true
   ```

**Greeting** (this is the whole first turn — no mechanics): run-kit is **mission control for AI agents working on your projects** — start them, watch them, unblock them, from any browser including your phone. Promise the outcome: *in ~10 minutes you'll have delegated work to an agent, been interrupted by one that needed you, run two at once, and been pinged when work finished.* Rules: talk in plain language; **next / skip / stop**; nothing here can break anything. Then one setup ask: **enable notifications now** (the bell in the dashboard's top bar) — "that's how agents will reach you in Act 4." End the turn.

## Act 1 — You have an agent (`ch1-your-agent`)

```sh
rk present "$RK/tutorial/ch1-your-agent.html"
```

The companion shows the roster idea: every sidebar row is an agent (or a plain terminal) working for you; the dot on the row is its state. Then make it real — **have the user ask you something** ("ask me anything — try: what's in this project?"). Answer briefly, and tell them to watch this window's row while you work: busy while I think, idle when I'm done, and a **waiting badge** when an agent needs a human — that badge is the whole supervision game, and Act 4 triggers it for real. One-line orientation: sessions group agents by project; this row is me.

## Act 2 — Make it show you things (`ch2-present-it`)

```sh
rk present "$RK/tutorial/ch2-present-it.html"
```

Teach the phrase on the companion: telling any agent **"…and present it to me"** makes results appear as live pages beside its terminal — reports, mocks, dashboards, not walls of terminal text. Then hands-on: offer three scoped picks — *(a) a one-page brief of this project, (b) a cheat sheet of this tour so far, (c) a small mock KPI dashboard* — and have them ask in their own words, ending with "present it to me". Build it fast (small, dark, monospace, self-contained), `rk present /tmp/rk-tutorial/<name>.html`, point at the new tab in the strip above the page. Then invite one tweak ("make the heading green", "add a row") — edit and re-run the same present command: **asking again is the refresh**. Mention once: the same works for a running dev server (`:port`) or any URL. If the page tile ever gets hidden, `rk tab layout split-h:tty,web` restores the side-by-side.

## Act 3 — Hire a second agent (`ch3-second-agent`)

```sh
rk present "$RK/tutorial/ch3-second-agent.html"
```

The point of run-kit is agents in **parallel** — and the user should feel it, not hear it. The worker's brief (both paths below): *build a one-page visual brief of this project; before writing anything, ask the user ONE question — "who's the audience: exec or engineer?" — and wait for the answer; then present the page and send a notification when done.*

- **Operator path (preferred)**: if Preflight found an operator row, point at it (pinned at the top of its server group) and have the **user** click into it and ask, in plain language: *"Start an agent in a new window that builds a one-page brief of this project — have it ask me one question first, then present the result and notify me."* The operator is how you'll start real work every day; today it hires our worker.
- **Fallback**: no operator — say so ("normally you'd ask the operator; I'll hire directly this time"), then: `rk tab new --name tour-worker`, start the same agent CLI you yourself run in that pane, and give it the brief.

While it boots, keep talking with the user: **two rows are now busy at once** — have them find both in the sidebar. That's the product.

## Act 4 — It needs you (`ch4-attention`)

```sh
rk present "$RK/tutorial/ch4-attention.html"
```

Wait for the worker's question to land (watch its pane with `rk mux await` or peek with `rk mux capture`; don't narrate the mechanics). When it does: the worker's row shows the **waiting badge**, and — if they enabled notifications — a **push lands on their device**. Walk the loop on the companion, then for real: *click the worker's row, read its question, type your answer right there, come back to me.* When the worker finishes it presents its page and notifies — the full supervision loop, end to end: **delegate → get interrupted only when needed → unblock → receive the result**. Degradations: no push → the badge and row signals carry it; worker never asks → nudge it from its pane; worker died → say so, show its last output, move on.

## Act 5 — Everywhere, and what's next (`ch5-everywhere`)

```sh
rk present "$RK/tutorial/ch5-everywhere.html"
```

Three closers, all user-driven. **Phone**: the same dashboard address works on any device that can reach it — offer to send it: `rk notify "open me on your phone" --title run-kit` (fail-silent if unsubscribed). **⌘K** (⇧Ctrl+K on Win/Linux): the command palette holds every action in the product — have them open it and type `color`, then `settings`; "when you don't know how, ⌘K and type" is the lasting habit. **The challenge**: have them start one real agent on something they actually want — via the operator if present ("Start a claude session on <repo>") — and remind them of the phrase that gets results as pages. For their engineers: `rk skill` (and its `display`, `mux`, `code` topics) is the always-available agent briefing.

## Cleanup and recap

Ask first: keep or remove the worker window and its brief (it's their first artifact — default keep). Then restore this tab: compare `rk tab web ls --json` with the web-tab capture and remove every tab absent from it, highest index first; restore every `@rk_win_*` key from the original-state capture with `tmux set-option -w <key> <value>`; unset (`tmux set-option -wu <key>`) any current `@rk_win_*` key absent from it; verify with `rk tab show --json`; then `rm -rf /tmp/rk-tutorial`.

Recap in their words: **rows are agents; the badge means "needs you"; "present it to me" gets results as pages; the operator hires; ⌘K finds everything; your phone works too.** Invite the solo experiment and end.
