# Archived Changes

- **260305-zkem-session-folder-picker** — Added session folder picker with server-side directory autocomplete and quick picks from existing session paths for creating sessions rooted in specific directories.
- **260305-vq7h-feature-tests-tmux-keyboard-api** — Added feature tests for the three most logic-dense modules: tmux session parsing, keyboard navigation hook, and sessions API POST handler.
- **260305-fjh1-bottom-bar-compose-buffer** — Added bottom bar with modifier keys, arrow keys, and compose buffer for latency-tolerant input on terminal pages, enabling mobile and remote server usability.
- **260305-emla-fixed-chrome-architecture** — Refactored root layout to own the chrome skeleton with ChromeProvider context, TopBarChrome with icon breadcrumbs, fixed-height Line 2, and standardized max-width across all pages.
- **260303-07iq-setup-vitest** — Set up Vitest testing infrastructure as the foundational test framework, enabling test-alongside strategy for all subsequent changes.
- **260303-q8a9-configurable-port-host** — Made Next.js port, relay WebSocket port, and bind host configurable via CLI args and run-kit.yaml, replacing hardcoded constants that caused port conflicts, network exposure issues, and prevented multi-instance usage.
- **260303-yohq-drop-config-derive-from-tmux** — Removed run-kit.yaml config file and derived project state entirely from tmux session state, aligning with no-persistent-state and convention-over-configuration principles.
- **260303-vag8-unified-top-bar** — Unified two-line top bar with breadcrumb navigation, contextual action bars, inline kill buttons, and killSession API across all three pages.
- **260302-fl88-web-agent-dashboard** — Web-based agent orchestration dashboard with Next.js 15, tmux integration, and terminal relay for managing multiple Claude Code agent sessions across projects.
