---
description: "Repository layout at directory granularity — app/backend (cmd/rk, internal, api, frontend, build), app/frontend, app/code-bridge, app/desktop, config, scripts, .github, fab, docs — with pointers to the files that own the per-file detail."
type: memory
---
# run-kit Architecture — Repository Layout

## Repository Structure

The tree below stops at directory granularity on purpose. Per-file detail lives in the file that owns
the corresponding surface — the CLI table in [cli](/run-kit/architecture/cli.md), the package table in
[backend-packages](/run-kit/architecture/backend-packages.md), the endpoint tables in
[api-and-sockets](/run-kit/api-and-sockets.md), and the build pipeline in
[build-and-release](/run-kit/build-and-release.md) — so that adding a file changes one place, not two.

```
app/
  backend/            # Go module — the rk binary
    cmd/rk/           # Cobra CLI entry point: main.go calls execute(); root.go registers every subcommand;
                      #   one file (or file family) per subcommand — see architecture/cli.md
      skill/          # committed embed copies of docs/site/skill.md (skill.md) and the code.md/display.md/gui.md/messaging.md/mux.md/tutorial.md
                      #   topic pages (synced by scripts/sync-skill.sh; //go:embed source for `rk skill`)
    internal/         # Go packages, one row each in architecture/backend-packages.md; the tmux runner
                      #   (architecture/tmux-runner.md) and the PR-status collector (architecture/pr-status.md) have their own files
    api/              # HTTP + WebSocket handlers — one file per resource domain, router.go (chi router, CORS/logger/recovery
                      #   middleware, route registration), spa.go (SPA static serving) — see api-and-sockets.md
    frontend/         # embed.go (//go:embed all:dist → embed.FS) + dist/ (Vite output copied here at build time; .gitkeep for dev)
    build/            # build-artifact embed dir — build/embed.go (//go:embed all:frontend + all:codebridge + tmux.conf);
                      #   codebridge/ holds the rk-code-bridge VSIX + VERSION sidecar copied at build time (see code-bridge.md)
    go.mod, go.sum
  frontend/           # Vite + React SPA — single-view UI (see the ui/ sub-domain)
    public/tutorial/  # the single self-contained tutorial companion page (five hash-addressed chapters), copied into the production dist
  code-bridge/        # rk-code-bridge VS Code extension (TypeScript, pnpm) — the code-bridge socket server (see code-bridge.md)
  desktop/            # Electron desktop viewer shell — self-contained pnpm package (see desktop-shell.md)
config/
  tmux.conf           # tmux config for the runkit server (status bar, keybindings, sources tmux.d/*.conf)
VERSION               # Semver source of truth (e.g. 0.1.0) — injected via ldflags (see build-and-release.md)
scripts/              # build.sh (frontend → copy dist → copy tmux.conf → go build), release.sh (bump VERSION, tag, push),
                      #   sync-skill.sh (skill bundle + topic pages → cmd/rk/skill/), dev-desktop.sh, build-desktop.sh,
                      #   test-*.sh / pw.sh (test harness) — see build-and-release.md and architecture/testing.md
.github/              # workflows/release.yml (v* tag → cross-compile 4 targets → GitHub Release → Homebrew tap; desktop jobs
                      #   attach packages) and formula-template.rb (Homebrew formula template) — see build-and-release.md
fab/                  # Fab-kit project config + changes
docs/                 # memory/ (post-implementation truth), specs/ (pre-implementation intent), site/ (published pages), wiki/ (design studies)
justfile              # Task runner — one-line recipes delegating to scripts/ (Constitution VIII)
```
