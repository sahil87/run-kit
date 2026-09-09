//go:build !linux

package gui

// RunningApps is a no-op off Linux: nothing runs under rk's control on other
// OSes (macOS spawns nothing — Screen Sharing is the substrate).
func RunningApps(procRoot, display string, exclude map[int]bool) ([]App, error) {
	return nil, nil
}
