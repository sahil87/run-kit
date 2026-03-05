# Archived Changes

- **260303-q8a9-configurable-port-host** — Made Next.js port, relay WebSocket port, and bind host configurable via CLI args and run-kit.yaml, replacing hardcoded constants that caused port conflicts, network exposure issues, and prevented multi-instance usage.
- **260303-yohq-drop-config-derive-from-tmux** — Removed run-kit.yaml config file and derived project state entirely from tmux session state, aligning with no-persistent-state and convention-over-configuration principles.
- **260303-vag8-unified-top-bar** — Unified two-line top bar with breadcrumb navigation, contextual action bars, inline kill buttons, and killSession API across all three pages.
- **260302-fl88-web-agent-dashboard** — Web-based agent orchestration dashboard with Next.js 15, tmux integration, and terminal relay for managing multiple Claude Code agent sessions across projects.
