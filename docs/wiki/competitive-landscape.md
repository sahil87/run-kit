# Competitive Landscape

> Where run-kit sits among tmux dashboards, parallel coding-agent orchestrators, mobile
> agent clients, and server consoles. Written during an exploratory discussion session
> (2026-07-01); tool facts verified against primary sources where flagged. Star counts,
> versions, and dates in this space drift week to week — treat them as approximate.

---

## The one-line thesis

**run-kit isn't an agent tool — it's the terminal underneath.** It exposes your tmux remotely
and phone-first; a coding agent is just *one of the things you run in a pane* (equally a build, a
REPL, an ssh session, `htop`). That makes run-kit **agent-agnostic by construction** — it doesn't
wrap an agent conversation, it sits below it. So it descends from **two** lineages at once and is
the rare tool in their overlap.

| Lineage A — ops / server console | Lineage B — agent orchestrator |
|----------------------------------|--------------------------------|
| Operate a box from a browser: terminals, services, logs. State mirrors the CLI. | Run N coding agents at once, each isolated in a git worktree; review, merge. |
| **e.g.** Cockpit · Webmin · code-server · ttyd-over-tmux | **e.g.** Claude Squad · Conductor · Crystal · CC Remote Control |
| …but agent-blind, single-box, not built for the parallel-worktree flow. | …but agent-coupled (speaks only agent-protocol) and mostly desktop / TUI. |

**run-kit is the overlap:** a remote, phone-usable, tmux-native terminal console that happens to be
perfectly shaped for running N coding agents in parallel — without being coupled to any one of them.
The agent tools can't become general consoles (they only speak agent-protocol); the consoles aren't
built for the worktree / parallel-agent flow.

---

## The capability matrix

Scored on run-kit's own axes. **●** = first-class · **◐** = partial / adjacent · **○** = absent.
"Agent-agnostic" = exposes a general terminal (run a build, a REPL, ssh, *or* an agent), not a
wrapped agent conversation. "tmux native" = tmux is the session substrate, not an optional backend.

| Tool | Agent-agnostic | tmux native | Parallel orch. | Web UI | Mobile-first | Worktree/agent | No DB / derived | License |
|------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--|
| **run-kit** | ● | ● | ● | ● | ● | ● | ● | private |
| *— Lineage A: ops / server consoles (agent-blind) —* | | | | | | | | |
| Cockpit (Red Hat) | ● | ○ | ○ | ● | ◐ | ○ | ● | LGPL |
| Webmin | ● | ○ | ○ | ● | ○ | ○ | ◐ | BSD |
| code-server / Coder | ● | ○ | ○ | ● | ◐ | ◐ | ○ | MIT/AGPL |
| ttyd · gotty · Wetty | ● | ◐ | ○ | ● | ◐ | ○ | ● | OSS |
| *— The overlap: web/mobile dashboards over tmux agents —* | | | | | | | | |
| Webmux (Windmill Labs) | ◐ | ● | ● | ● | ● | ● | ● | MIT |
| guppi | ◐ | ● | ◐ | ● | ◐ | ○ | ● | MIT |
| Agent of Empires (Mozilla.ai) | ◐ | ● | ● | ● | ● | ● | ◐ | MIT |
| amux | ○ | ● | ● | ● | ● | ● | ◐ | MIT* |
| Codeman | ◐ | ● | ● | ● | ● | ○ | ◐ | MIT |
| agentdock | ○ | ● | ● | ● | ● | ● | ◐ | MIT |
| *— Lineage B: agent orchestrators (agent-coupled) —* | | | | | | | | |
| Claude Squad | ◐ | ● | ● | ○ | ○ | ● | ● | AGPL |
| Conductor (Melty Labs) | ○ | ○ | ● | ○ | ○ | ● | ◐ | commercial |
| CC Remote Control (Anthropic) | ○ | ○ | ○ | ● | ● | ◐ | ○ | first-party |
| Happy / Omnara | ○ | ○ | ◐ | ● | ● | ○ | ○ | OSS / comm. |
| Sculptor (Imbue) | ○ | ○ | ● | ◐ | ○ | ○ | ○ | MIT |

\* amux is MIT + Commons Clause (free self-host, commercial resale restricted).

---

## Lineage A — the ops console run-kit replaces

- **Cockpit** (Red Hat, LGPL) — the reference web console for a Linux box: terminals, services,
  logs, storage, containers, networking, all in the browser. Its creed is a striking parallel to
  run-kit's: *use the same system APIs the CLI uses; everything you do is visible and reversible
  from the terminal, and vice versa.* Cockpit derives from system APIs; run-kit derives from **tmux
  + filesystem** (no DB). This is the lineage run-kit modernizes — tmux-native, phone-first, shaped
  for the parallel-agent flow Cockpit never imagined.
- **Webmin** (BSD) — the classic, heavier server-admin panel. Same "operate the box from a browser"
  intent, opposite ergonomics: config-form heavy, desktop-era, no live-terminal board or mobile.
- **code-server / Coder** (MIT/AGPL) — VS Code in the browser, with a web terminal as one panel.
  The terminal is incidental to an editor/CDE; run-kit makes the terminal board the *whole* product.
- **ttyd · gotty · Wetty** (OSS) — the bare floor: expose one shell or tmux over a browser via
  xterm.js + WebSocket. `ttyd tmux new -A` is the canonical web-attached-tmux recipe. run-kit's
  rendering layer sits on this exact plumbing, then stacks the sidebar tree, SSE status, fab badges,
  and multi-server board on top. Agent-blind and worktree-blind.

---

## The overlap — web/mobile dashboards over tmux agents

The heart of the competitive set — new and crowded, mostly MIT, mostly shipped or majorly updated
in the last few months of the survey window.

- **Webmux** (Windmill Labs, MIT) — **closest twin overall.** Web dashboard + CLI owning tmux
  layouts and the git-worktree lifecycle directly; explicitly **no database** — state derived from
  tmux + worktrees (verified in its docs). Live terminals over WS, a simplified mobile agents UI,
  PR/CI status, Docker sandboxing, Linear→worktree automation. Leans somewhat agent-aware; company-
  backed. run-kit's most serious open-source competitor.
- **guppi** (MIT) — **closest architectural twin.** Single Go binary + embedded React, xterm-over-
  WebSocket, tmux *control mode*, a session sidebar, state read straight from tmux — run-kit's stack
  almost exactly, and like run-kit a thin terminal layer (not agent-coupled). Weaker: early, monitor-
  only (no orchestration/worktrees), thin on mobile. run-kit = guppi + orchestration + worktrees +
  real mobile.
- **Agent of Empires** (Mozilla.ai-supported, MIT) — TUI *and* mobile-first web/PWA over tmux +
  worktrees + Docker sandbox; broadest agent support; QR/passphrase remote. Most popular in the
  cluster. TUI-first with the web view as a companion; more agent-aware than run-kit's pure-terminal
  stance.
- **amux** (MIT + Commons Clause) — single-file Python control plane for *dozens* of unattended
  agents in tmux + worktrees; self-healing watchdog, fleet rate-limit handling, PWA + native iOS,
  inter-agent channels, kanban, SQLite queue. A heavy *agent* OS tilted toward unattended fleets;
  run-kit stays a minimal, agnostic terminal board.
- **agentdock** (MIT) — React/Vite + Bun/Hono dashboard, parallel agents in tmux + worktrees, a
  **sidebar tree with grouping + pinning**, keyboard switching, mobile/PWA. The closest *feature*
  match after Webmux; agent-aware via CC lifecycle hooks; a self-described side project.
- **Codeman** (MIT) — the most *mature* web-over-tmux UI (~90 releases): up to 20 parallel agents,
  60fps xterm.js, swipe nav, QR mobile auth over a Cloudflare tunnel, mosh-style local echo, respawn
  loops. Matches the web+tmux+mobile shape and polish, but no documented worktree story and adds an
  orchestration engine + `state.json` where run-kit stays thin.

---

## Lineage B — agent orchestrators, agent-coupled

They wrap the conversation; run-kit doesn't.

- **Claude Squad** (AGPL) — Go TUI managing many CC / Codex / Gemini / Aider agents, each in its own
  tmux session + worktree. Category leader. Closest on **substrate & philosophy** (tmux + worktree-
  per-agent) but **terminal-only** — the web/mobile gap run-kit fills. *"Claude Squad with a phone
  screen"* is a fair pitch for run-kit.
- **CC Remote Control** (Anthropic, first-party, launched Feb 2026 — *verified against
  code.claude.com/docs*) — bridges a **single** local Claude Code session to the iOS/Android/web app;
  a window into *one* conversation. Outbound-HTTPS-only (never opens inbound ports); registers with
  the Anthropic API and polls; has a `--spawn worktree` session mode and push notifications; **free on
  every plan.** Overlaps run-kit only on the narrow *"control one agent from my phone"* slice — it's
  **single-session, agent-attached, no board, no multi-agent orchestration**, and not tmux-native. It
  can't show you a tmux of builds + REPLs + five agents at once. Complementary more than competitive,
  despite being the loudest first-party entrant.
- **Conductor** (Melty Labs, commercial) — polished native Mac app, parallel CC/Codex/Cursor agents
  in worktrees, diff+merge UI. Same worktree model, opposite delivery: macOS desktop, no web, no
  mobile, no tmux, agent-bound.
- **Happy / Omnara** — mobile-first CC clients. Happy (MIT, E2E-encrypted iOS+Android+web, very
  popular) and Omnara (YC-S25, voice, push approvals). Rich mobile, but bespoke agent relays — agent-
  bound, no tmux, no general terminal. They own *"talk to your agent from your phone,"* not *"operate
  your machine."*
- **Sculptor** (Imbue, MIT) — each agent in its own Docker container (isolation over worktrees),
  synced back to the local repo on demand. A different isolation primitive entirely; overlaps only on
  "many agents in parallel."

Also seen in the wider orchestrator field (desktop/cloud, not tmux-web): **Crystal** (Electron,
deprecated Feb 2026 → paid successor Nimbalyst), **Vibe Kanban** (parent Bloop shut down early 2026,
community-maintained since), **Terragon** (cloud CC wrapper — shut down, open-sourced, now points
users to Anthropic's Claude Code on the web).

---

## Closest direct competitors (ranked by overlap)

Ranked by how completely each hits run-kit's full combination — *agent-agnostic terminal + tmux-native
+ parallel-orchestration + web + mobile + worktrees + no-DB.*

1. **Webmux** — closest overall. Same architecture *and* the same derive-don't-store philosophy.
2. **guppi** — closest architecturally; a thin terminal layer like run-kit, but early and monitor-only.
3. **Agent of Empires & amux** — the two most mature OSS tools hitting the full combo; both tilt more
   agent-aware than run-kit.
4. **Claude Squad** — the tmux + worktree leader, but a TUI; the strongest proof run-kit's web/mobile
   framing is a real, unfilled gap.
5. **Cockpit** — not an agent tool at all, but the *console* run-kit replaces and a philosophical
   sibling (derive-from-system-APIs ≈ derive-from-tmux). No tool but run-kit currently sits in both
   this lineage and the agent one.

Honorable mentions by axis: **Codeman** (most mature web-over-tmux UI), **Recon** (closest derive-
don't-store, but a Rust TUI), **agentdock** (closest feature match), **Happy** (strongest OSS mobile
CC client).

---

## Strategic takeaway

The defensible position **isn't** "remote access to an agent" — Anthropic (Remote Control), Happy, and
Omnara already own that, single-session. run-kit's lane is the **overlap nobody else fills**: an
agent-agnostic, tmux-native terminal console (Cockpit's job, done phone-first and modern) that's
**also** a parallel-agent board (Claude Squad's job, served to a browser). The agent is just a tool
you happen to run in a pane.

Only **Webmux** and **guppi** genuinely sit in that overlap today, and both have gaps run-kit can
press — guppi's mobile + orchestration; both tools' multi-server board density and pure-terminal
agnosticism.

The biggest threat is **not** another indie tool — it's the risk of the "control your agent from your
phone" hook being commoditized (as Anthropic's first-party Remote Control does for single sessions).
That pushes run-kit's real differentiation toward **multi-agent / multi-server monitoring density** and
**agent-agnosticism**, not remote access alone.

**One-liner:** *"Cockpit for the agent era — your tmux, remote and phone-first, that happens to run N
agents in parallel."*

> This positioning drives the current README framing and several backlog items (host-console home,
> session/window tile grid with previews, service tiles) — the features that make the "console"
> claim true in the product, not just in prose.
