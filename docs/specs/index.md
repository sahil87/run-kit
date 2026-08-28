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
| [Agent State](agent-state.md) | The `@rk_pane_agent_state` pane-option convention — two-tier ownership, value schema, writer/reader rules, shell reconciler, and the `rk agent setup` per-agent hook registry (cross-repo contract with fab-kit) |
| [API](api.md) | HTTP, SSE, and WebSocket endpoint specification — the target API surface |
| [Architecture](architecture.md) | System architecture, repository structure, data flow, build & deploy |
| [Code Bridge](code-bridge.md) | `rk code exec` + the `rk-code-bridge` code-server extension — run VS Code palette commands in the `code` lens from a shell over a same-user Unix socket under `$XDG_STATE_HOME/run-kit/cb/`; protocol, host resolution, security stance, distribution via `rk code-server install`, phasing |
| [CLI Layering](cli-layering.md) | Two-tool model — rk owns the tmux/agent substrate, fab owns pipeline choreography: delegation rules, the `rk mux`/`rk agent` grouping plan, hidden plumbing, the `fab pane` migration map, and the 8-part phased execution plan |
| [Project Plan](project-plan.md) | 4-phase reimplementation plan: scaffold → backend → frontend → cleanup |
| [Right Panel](right-panel.md) | Collapsible right panel on the terminal route — a second (substrate, lens) slot behind an icon rail: surface registry (web/code/agents), the `code` lens (code-server embed, git-root keyed), the companion-window convention, mobile sheet degradation, phasing |
| [Design Philosophy](design.md) | Core design principles and mental models behind fab-kit |
| [Short-Term Goal](short-term-goal.md) | Minimum viable product requirements and priorities |
| [Status Pyramid](status-pyramid.md) | Precedence model for status signals — tier ladder (PR > fab > agent > tmux), channel model (hue/shape/animation), attention overlay, decision table, rollups |
| [Surface Layout](surface-layout.md) | The center as a layout of surfaces — preset shapes × ordered surfaces × ratios, the `?layout=` state ladder, tile verbs, rail toggles, and the `@rk_win_lens`/view-switcher retirement map |
| [Themes](themes.md) | Theme system architecture: ANSI palettes, derivation, tmux integration, import script |
| [Window Views](window-views.md) | Rows are substrates, views are lenses — the parallel-view model (tty/web/chat/desktop): derived availability vs per-viewer choice, the shared switcher contract, two-species taxonomy, migration map for iframe / desktop (PR #71) / chat |

## Wiki

| Page | Description |
|------|-------------|
| [Competitive Landscape](../wiki/competitive-landscape.md) | Where run-kit sits among tmux dashboards, agent orchestrators, mobile clients, and server consoles — the two-lineages positioning and closest competitors |
| [Label Picker Design Studies](../wiki/label-picker-design-studies.html) | Interactive HTML design reference behind the 5-marker vocabulary, shade axis, paired-grid picker, and row textures (260723-wwoi + #452) — live OKLCH-derived swatches, the final pairing table, and the tried-and-rejected treatment gallery with rationale. Self-contained; open in a browser |
| [Picker Layout Studies](../wiki/picker-layout-studies.html) | Interactive HTML design study behind the banded B-H Label picker rework (260819-9hh6) — the four layout approaches (A/C/D parked, B-H chosen), the −-in-headers iteration (clear-cell glyph: ∅ → neutral minus, red rejected — the glyph-comparison strip), the 8-marker categorical vocabulary with the hatch↔hazard pairing, and the marker/flair motion split (rain/scan as flairs), every mock live with the shipped flair CSS. Self-contained; open in a browser |
| [Status Rail Design Studies](../wiki/status-rail-design-studies.html) | HTML mock (v4) behind the coarse-pointer right-edge status rail (#634/#639 and the continuous-strip extension) — the three-tier rail geometry, session/server cards with relocated cluster actions, Change color… card rows, held-rail highlight, and left-zone reclaim, with rejected treatments noted in captions. Self-contained; open in a browser |
| [Tab Note Design Studies](../wiki/tab-note-design-studies.html) | HTML design study for the `@rk_win_note` per-tab status note (260824-bb5n, #734) — the shipped surfaces (window flyout card note line with the 24h stale dimming, Set-note prompt, palette entries, annotate-tab operator row, the epoch:text schema/derive pipeline) plus the § 4 extension map (brief-me fold, whats-stuck note triage, board card subtitles, note search, handoff seeding — tracked as backlog [8fjh]). Self-contained; open in a browser |
