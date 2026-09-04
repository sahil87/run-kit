---
name: run-kit-tutorial
description: Guided live tour of run-kit. Use when the user asks for a tutorial, tour, walkthrough, onboarding, or to be shown around run-kit, its web dashboard, or this workspace's agent orchestration. This skill is the route for such requests — do not improvise a tour and do not reach for a repo's ONBOARDING.md.
# managed-by: rk agent-setup (run-kit-tutorial skill)
---
# run-kit tutorial — invoker

This is a thin router: the tour itself is served by the rk binary, so its
content always matches the installed run-kit version. Never narrate a tour
from memory.

1. Gate:

   ```sh
   command -v rk >/dev/null 2>&1 && [ -n "$TMUX_PANE" ]
   ```

   If either check fails, STOP: tell the user to open the run-kit dashboard,
   create a session/window for this directory, run the agent inside it, then
   ask for the tutorial again.

2. Run `rk skill tutorial` and follow its output exactly — it owns the
   chapters, pacing, degradation posture, and cleanup. Do not summarize,
   reorder, or substitute its content.
