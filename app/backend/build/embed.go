package build

import "embed"

// Frontend embeds the frontend build output (app/frontend/dist/ copied here at build time).
// During development, the frontend/ directory contains only .gitkeep, making the FS effectively empty.
//
//go:embed all:frontend
var Frontend embed.FS
