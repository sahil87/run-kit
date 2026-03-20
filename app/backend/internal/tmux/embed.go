package tmux

import "run-kit/build"

// DefaultConfigBytes returns the embedded tmux.conf content.
func DefaultConfigBytes() []byte {
	return build.TmuxConfig
}
