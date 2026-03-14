## Execution Order

Active changes, in dependency order:

1. `[vq7h]` Feature tests (tmux, keyboard nav, API) — test stable baseline before refactor
2. `[emla]` **1/3 Fixed Chrome Architecture** — layout skeleton, ChromeProvider, icon breadcrumbs
3. `[fjh1]` **2/3 Bottom Bar + Compose Buffer** — modifier keys, arrows, compose textarea (depends on 1/3)
4. ~~`[ol5d]` **3/3 Mobile Responsive Polish** — Line 2 collapse, touch targets, font scaling (depends on 1/3 + 2/3)~~ ✓ archived
5. ~~`[r7zs]` Playwright E2E tests — verify design spec end-to-end (depends on 1/3 + 2/3 + 3/3)~~ ✓ archived

Parallel (no dependencies on 1–5):
- `[zkem]` Session folder picker — directory autocomplete + quick picks

## Backlog

- [ ] 2026-03-03: Fall back to `#{session_path}` for project root detection — currently we derive the project root from window 0's `pane_current_path`, which breaks if the user has `cd`'d away. tmux exposes `#{session_path}` (the `-c start-directory` from session creation), which is immutable. A hybrid approach (prefer `session_path`, fall back to `pane_current_path`) would be more robust. Low priority — the current approach works for typical coding sessions.
- [x] [w70w] 2026-03-03: ~~Double esc - could have side effects - need a better shortcut~~ → `[3brm]` removed single-key shortcuts
- [ ] [63td] 2026-03-03: We would need buttons to delete this worktree and at the project level to delete all unused worktrees.
- [ ] [ar9l] 2026-03-03: Buttons to send Git PR and a way to keep checking its status.
- [x] [c1ro] 2026-03-03: ~~While creating a new window (a new session/project), how do we specify the CWD?~~ → `[zkem]` session folder picker
- [ ] [6bdn] 2026-03-03: Buttongs to control the 'wt-* workflow' - using wt-create to create a new worktree etc
- [ ] 2026-03-03: Add vitest tests for tmux session-group filtering — `listSessions()` must filter byobu-created derived sessions (e.g. `devshell-82` in group `devshell`) while keeping primaries and standalone sessions. Test cases: (1) standalone session (grouped=0) kept, (2) primary group member (name=group) kept, (3) derived copy (name≠group) filtered, (4) multiple groups with multiple copies, (5) empty/no sessions. Requires vitest framework setup first. See `docs/memory/run-kit/tmux-sessions.md`
- [x] [qeuz] 2026-03-03: ~~while typing an input - is there a way to overcome the latency? Make user input super smooth~~ → `[fjh1]` compose buffer
- [x] [bj8j] 2026-03-03: ~~can reserve the bottom bar for input - Ctrl, Alt, Cmd, Fn keys etc~~ → `[fjh1]` bottom bar
- [ ] [oibl] 2026-03-14: unable to scroll terminal on mobile
- [ ] [4hef] 2026-03-14: tapping on modifiers from bottom bar collapses the keyboard
- [ ] [wq7h] 2026-03-14: get ssl
