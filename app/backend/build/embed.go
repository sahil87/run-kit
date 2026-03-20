package build

import "embed"

// Frontend embeds the frontend build output (app/frontend/dist/ copied here at build time).
// During development, the frontend/ directory contains only .gitkeep, making the FS effectively empty.
//
//go:embed all:frontend
var Frontend embed.FS

// TmuxConfig holds the embedded default tmux.conf.
// Copied from configs/tmux/default.conf at build time (and by scripts/dev.sh for development).
//
//go:embed tmux.conf
var TmuxConfig []byte
