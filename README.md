# run-kit

Web-based agent orchestration dashboard. Monitor and interact with tmux sessions from the browser — session overview, live terminal windows, and fab-kit integration for change tracking.

## Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [pnpm](https://pnpm.io/)
- [tmux](https://github.com/tmux/tmux) installed and on your `PATH`

## Getting Started

1. **Install dependencies**

   ```sh
   pnpm install
   ```

2. **Create your config file**

   Copy the example and add your project paths:

   ```sh
   cp run-kit.example.yaml run-kit.yaml
   ```

   Edit `run-kit.yaml`:

   ```yaml
   projects:
     my-project:
       path: ~/code/my-project
       fab_kit: true
   ```

   Each project entry needs a `path` (absolute or `~`-prefixed). Set `fab_kit: true` if the project uses fab-kit for change management.

3. **Start in development mode**

   ```sh
   pnpm dev
   ```

   This starts both the Next.js dev server ([http://localhost:3000](http://localhost:3000)) and the terminal relay (port 3001) in a single process. Ctrl+C stops both.

   To run them separately (e.g., for isolated logs), use `pnpm dev:next` and `pnpm relay` in separate terminals.

4. **Start in production mode**

   Build and run both services with the supervisor:

   ```sh
   pnpm supervisor
   ```

   The supervisor manages the Next.js server and terminal relay as a single unit, with health checks and automatic rollback on failure.
