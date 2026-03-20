## Backlog

- [ ] [abcd] 2026-03-03: Fall back to `#{session_path}` for project root detection — currently we derive the project root from window 0's `pane_current_path`, which breaks if the user has `cd`'d away. tmux exposes `#{session_path}` (the `-c start-directory` from session creation), which is immutable. A hybrid approach (prefer `session_path`, fall back to `pane_current_path`) would be more robust. Low priority — the current approach works for typical coding sessions.
- [ ] [63td] 2026-03-03: We would need buttons to delete this worktree and at the project level to delete all unused worktrees.
- [ ] [ar9l] 2026-03-03: Buttons to send Git PR and a way to keep checking its status.
- [ ] [6bdn] 2026-03-03: Buttons to control the 'wt-* workflow' - using wt-create to create a new worktree etc
- [ ] [oibl] 2026-03-14: unable to scroll terminal on mobile
- [ ] [4hef] 2026-03-14: tapping on modifiers from bottom bar collapses the keyboard
- [ ] [wq7h] 2026-03-14: get ssl
- [ ] [rkx4] 2026-03-20: The text input dialog - show buttons at the bottom of that dialog in a section that represent 'most used commands' - Clicking on them enters that text in the input box - later parts of this list may also be exposed in the dashboard cards - a quick way send commands to different session. This could be used to send the text 'Create PR' or 'Merge PR' to sessions that are ready to do so
- [ ] [ljhu] 2026-03-20: At the bottom of the left panel, add 'Server: <dropdown>' which shows you the current tmux server you are connected to allows you to change it. Add these to Command Palette: 'Create tmux server' (should show a dialog where you can select a tmux server name), 'Kill tmux server', 'Switch tmux server'. Change run-kit behaviour to connect only to one server at a time. We no longer need the server label in the session entries
