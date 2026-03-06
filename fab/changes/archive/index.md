# Archived Changes

- **260307-uzsa-navbar-breadcrumb-dropdowns** — Added breadcrumb dropdown menus for switching between projects and windows directly from the navbar, using a split click-target pattern (name navigates, chevron opens dropdown).
- **260307-r3yv-action-buttons-rename-kill** — Added Rename window action to both project and terminal pages, and shortened "Kill Window" label to "Kill".
- **260307-kqio-image-upload-claude-terminal** — Added image upload to Claude Code terminal sessions via drag-drop, clipboard paste, and file picker in the run-kit web UI.
- **260307-f3o9-ios-keyboard-viewport-overlap** — Fixed iOS keyboard covering the terminal by handling visualViewport scroll events and compensating for offset, keeping the bottom bar and terminal visible while typing.
- **260307-8n60-fix-ios-terminal-touch-scroll** — Fixed iOS Safari terminal touch scrolling by preventing page scroll when touching the xterm terminal area.
- **260306-0ahl-perf-sse-chrome-sessions** — Parallelized session enrichment, deduplicated SSE connections with shared polling, and split ChromeContext to eliminate cascade re-renders.
- **260305-zkem-session-folder-picker** — Added session folder picker with server-side directory autocomplete and quick picks from existing session paths for creating sessions rooted in specific directories.
- **260305-vq7h-feature-tests-tmux-keyboard-api** — Added feature tests for the three most logic-dense modules: tmux session parsing, keyboard navigation hook, and sessions API POST handler.
- **260305-fjh1-bottom-bar-compose-buffer** — Added bottom bar with modifier keys, arrow keys, and compose buffer for latency-tolerant input on terminal pages, enabling mobile and remote server usability.
- **260305-emla-fixed-chrome-architecture** — Refactored root layout to own the chrome skeleton with ChromeProvider context, TopBarChrome with icon breadcrumbs, fixed-height Line 2, and standardized max-width across all pages.
- **260303-07iq-setup-vitest** — Set up Vitest testing infrastructure as the foundational test framework, enabling test-alongside strategy for all subsequent changes.
- **260303-q8a9-configurable-port-host** — Made Next.js port, relay WebSocket port, and bind host configurable via CLI args and run-kit.yaml, replacing hardcoded constants that caused port conflicts, network exposure issues, and prevented multi-instance usage.
- **260303-yohq-drop-config-derive-from-tmux** — Removed run-kit.yaml config file and derived project state entirely from tmux session state, aligning with no-persistent-state and convention-over-configuration principles.
- **260303-vag8-unified-top-bar** — Unified two-line top bar with breadcrumb navigation, contextual action bars, inline kill buttons, and killSession API across all three pages.
- **260302-fl88-web-agent-dashboard** — Web-based agent orchestration dashboard with Next.js 15, tmux integration, and terminal relay for managing multiple Claude Code agent sessions across projects.
