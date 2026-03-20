package tmux

import (
	_ "embed"
)

// DefaultConfig holds the embedded default tmux.conf.
// During development, the file may not exist — use DefaultConfigBytes() to check safely.
//
//go:embed tmux.conf
var defaultConfig []byte

// DefaultConfigBytes returns the embedded tmux.conf content.
func DefaultConfigBytes() []byte {
	return defaultConfig
}
