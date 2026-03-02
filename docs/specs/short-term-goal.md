At the minimum, I need:
* A good UX to access byobu / tmux sessions from a web UI - to easy run Agent session, inspired from ao
* An orchestrator inspired from ao and fab-kit to run agent sessions
* The main engine for development will be fab-kit
* It should be able to create new byobu sessions
* It should be able to create new windows in byobu sessions
* It should be represent those windows in the UI
* We need to go deep into the DX first - URL structures, types of pages (minimal, easy to manage)
* Its ok if only one terminal is linked to a worktree
* Primary way of working will be via worktrees
* Read the batch-scripts from fab-kit source code to understand how orchestration works currently
* There needs to be an easy improvement loop inbuilt in run-kit - it should be easy to restart run-kit after improvments (after run-kit works on itself for example) - include rollbacks in case of errors
* Use fab-kit as the engine. Many utilites already exist - eg: idea for backlog management, wt-* from worktree management, fab- commands for the agent.
* The UI should be slick (like ao)