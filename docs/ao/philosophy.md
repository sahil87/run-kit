# Philosophy

## Core Thesis

Running one AI agent in a terminal is easy. Running 30 across different issues, branches, and PRs is a coordination problem. Agent Orchestrator exists to solve that coordination problem.

## Push, Not Pull

The fundamental interaction model is **push-based**. The human spawns agents and walks away. Notifications bring them back only when human judgment is needed. The human never polls for status; the system surfaces what matters.

This inverts the typical developer-tool relationship where the human monitors a dashboard or terminal. Instead, the orchestrator monitors the agents and reaches out to the human through desktop notifications, Slack, webhooks, or any other configured channel.

## Two-Tier Event Handling

Events are split into two categories:

1. **Routine events** the system handles autonomously: CI failures get forwarded to the agent with fix instructions. Review comments get forwarded with "address each comment" instructions. Merge conflicts get forwarded with rebase instructions. These are all configurable via the `reactions` config.

2. **Judgment events** that require a human: agent stuck for too long, agent asking a question, PR approved and ready to merge (unless auto-merge is enabled), escalations after multiple failed retries.

The boundary between these is configurable per-project. A team comfortable with auto-merge can flip `approved-and-green.auto: true`. A team that wants to review every CI fix can set `ci-failed.auto: false`.

## Stateless Orchestrator

There is no database. Session state lives in flat key=value metadata files on disk. Event history lives in JSONL files that agents write natively. The orchestrator reads these files to determine what's happening and writes back to them when state transitions occur.

This means:
- No migration headaches
- Metadata is human-readable and editable (`cat`, `sed`, manual fixes)
- The orchestrator can crash and restart without data loss
- Multiple tools (CLI, dashboard, scripts) can read/write the same files
- Backward compatibility with bash scripts that pre-dated the TypeScript rewrite

## Convention Over Configuration

The config file requires only 3 fields per project: `path`, `repo`, `defaultBranch`. Everything else is auto-derived:

- Project ID: `basename(path)` (e.g., `~/repos/integrator` -> `integrator`)
- Session prefix: heuristic from project ID (`agent-orchestrator` -> `ao`, `integrator` -> `int`)
- Runtime data directory: hash-based under `~/.agent-orchestrator/`
- Session names: `{prefix}-{num}` (e.g., `ao-1`, `int-3`)
- Tmux session names: `{hash}-{prefix}-{num}` for global uniqueness
- SCM plugin: inferred from repo format (contains `/` -> GitHub)
- Tracker plugin: defaults to GitHub Issues

## Agent-Agnostic

The orchestrator doesn't know or care which AI agent is writing the code. The `Agent` interface abstracts away the differences between Claude Code, Codex, Aider, OpenCode, or any custom agent. Each agent plugin knows how to:

- Launch the agent with the right CLI flags
- Detect what the agent is doing (active, idle, waiting for input, exited)
- Extract session info (summary, cost, session ID for resume)
- Set up workspace hooks for automatic metadata updates

The same orchestrator instance can run different agents for different projects, or even different agents for different sessions within the same project via `--agent` override.

## Runtime-Agnostic

Where the agent runs is also pluggable. The default is tmux (because it's simple, ubiquitous, and allows humans to attach for debugging), but the same interfaces support Docker containers, Kubernetes pods, bare child processes, SSH sessions, or cloud sandboxes.

## Security First

Shell injection is treated as a show-stopper. The codebase enforces `execFile` over `exec` everywhere, passes arguments as arrays not template strings, and validates all external input. This is called out in the CLAUDE.md and enforced by code review.
