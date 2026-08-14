---
description: "Map file — the UI patterns moved to the ui/ sub-domain; routes old ui-patterns.md section references (historical logs, code comments) to their new homes."
type: memory
---
# run-kit UI Patterns (moved)

This file's content was split into the [ui/](/run-kit/ui/index.md) sub-domain. It remains only so
historical references (`log.md` entries, code comments citing `ui-patterns.md § …`) keep resolving.
Do not add content here — write to the topic file instead.

| Old section (§) | New home |
|---|---|
| URL Structure, Session Tiles, Shell Grid Layout, Live Safe-Name Conversion, Session Creation Pattern, Instance Display Name, Session-to-Project Mapping, Activity Status | [ui/routes-and-shell](/run-kit/ui/routes-and-shell.md) |
| PR Status, Status Dot, Row-hover register flyout, Tooltips, Attention Surfacing | [ui/status-signals](/run-kit/ui/status-signals.md) |
| Window Views (Lens Model), Surface Layout, Right Rail, Iframe Window, Code Surface, Chat View | [ui/lenses-and-layout](/run-kit/ui/lenses-and-layout.md) |
| Boards View (pinning, board page, palette actions, hooks) | [ui/boards](/run-kit/ui/boards.md) |
| Notifications (Web Push), Update Notification | [ui/updates-and-notifications](/run-kit/ui/updates-and-notifications.md) |
| Chrome (Top Bar), Open split-button, Breadcrumb Dropdowns, Window Heading, Desktop-Shell Titlebar Strip + Waiting Badge Reporter | [ui/top-bar](/run-kit/ui/top-bar.md) |
| Sidebar (rows, Render Performance, Keyboard Navigation, multi-select, panels, zones, kill controls) | [ui/sidebar](/run-kit/ui/sidebar.md) |
| Bottom Bar, Docked Compose Strip, File Upload, iOS Keyboard Support | [ui/compose-and-bottom-bar](/run-kit/ui/compose-and-bottom-bar.md) |
| Keyboard Shortcuts (tiers, bindings, macros, overlay), Command Palette, Tmux Commands Dialog | [ui/keyboard-and-palette](/run-kit/ui/keyboard-and-palette.md) |
| Terminal Relay (frontend), Terminal Write Batching, Window-Switch Slide Transition, Terminal Addons/Font/Unicode, Touch Scroll | [ui/terminal](/run-kit/ui/terminal.md) |
| Visual Design (tokens, borders), Theme System, Hover-Animation Vocabulary, Logo Ring, Color Tinting, Instance Accent, row textures, Mobile Responsive | [ui/visual-design](/run-kit/ui/visual-design.md) |
| Component Conventions, Create Session / Spawn-Agent / Settings Dialogs, Zustand Window Store, Optimistic UI, Clipboard Utility | [ui/dialogs-and-state](/run-kit/ui/dialogs-and-state.md) |
| Design Decisions (173 entries) | distributed into each topic file's `## Design Decisions` section |
