package frontend

import "embed"

// Dist embeds the frontend build output (app/frontend/dist/ copied here at build time).
// During development, the dist/ directory contains only .gitkeep, making the FS effectively empty.
//
//go:embed all:dist
var Dist embed.FS
