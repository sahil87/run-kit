# Specifications Index

> **Specs are pre-implementation artifacts** — what you *planned*. They capture conceptual design
> intent, high-level decisions, and the "why" behind features. Specs are human-curated,
> flat in structure, and deliberately size-controlled for quick reading.
>
> Contrast with [`docs/memory/index.md`](../memory/index.md): memory files are *post-implementation* —
> what actually happened. Memory files are the authoritative source of truth for system behavior,
> maintained by `/fab-archive` hydration.
>
> **Ownership**: Specs are written and maintained by humans. No automated tooling creates or
> enforces structure here — organize files however makes sense for your project.

## Spec Locations

| Spec | Location |
|------|----------|
| Agent Orchestrator | [`docs/ao/`](../ao/) |
| fab-kit | `~/code/sahil87/fab-kit/docs/` (source: `~/code/sahil87/fab-kit/fab/.kit/`) |

## Project Specs

| Spec | Description |
|------|-------------|
| [API](api.md) | HTTP, SSE, and WebSocket endpoint specification — the target API surface |
| [Architecture](architecture.md) | System architecture, repository structure, data flow, build & deploy |
| [Project Plan](project-plan.md) | 4-phase reimplementation plan: scaffold → backend → frontend → cleanup |
| [Design Philosophy](design.md) | Core design principles and mental models behind fab-kit |
| [Short-Term Goal](short-term-goal.md) | Minimum viable product requirements and priorities |
| [Themes](themes.md) | Theme system architecture: ANSI palettes, derivation, tmux integration, import script |
