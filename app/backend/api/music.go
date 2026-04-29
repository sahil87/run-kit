package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"strings"
)

// MusicBackend abstracts the system media layer so handlers can be tested without
// a real nowplaying-cli binary or running music player.
type MusicBackend interface {
	NowPlaying() (NowPlayingResponse, error)
	Control(action string) error
}

// NowPlayingResponse is the JSON shape returned by GET /api/music/now-playing.
type NowPlayingResponse struct {
	Title       string  `json:"title"`
	Artist      string  `json:"artist"`
	State       string  `json:"state"`       // "playing", "paused", or "stopped"
	App         string  `json:"app"`         // source app/identifier
	Duration    float64 `json:"duration"`    // total track length in seconds
	ElapsedTime float64 `json:"elapsedTime"` // current position in seconds
}

// nowplayingCLI is the production MusicBackend using the nowplaying-cli binary.
type nowplayingCLI struct{}

func (nowplayingCLI) NowPlaying() (NowPlayingResponse, error) {
	out, err := exec.Command("nowplaying-cli", "get", "title", "artist", "playbackRate", "duration", "elapsedTime").Output()
	if err != nil {
		return NowPlayingResponse{State: "stopped"}, err
	}

	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) < 3 {
		return NowPlayingResponse{State: "stopped"}, nil
	}

	title := strings.TrimSpace(lines[0])
	artist := strings.TrimSpace(lines[1])
	rate := strings.TrimSpace(lines[2])

	if title == "" || title == "null" {
		return NowPlayingResponse{State: "stopped"}, nil
	}

	state := "paused"
	if rate == "1" {
		state = "playing"
	}

	var duration, elapsedTime float64
	if len(lines) >= 4 {
		fmt.Sscanf(strings.TrimSpace(lines[3]), "%f", &duration)
	}
	if len(lines) >= 5 {
		fmt.Sscanf(strings.TrimSpace(lines[4]), "%f", &elapsedTime)
	}

	return NowPlayingResponse{
		Title:       title,
		Artist:      artist,
		State:       state,
		App:         "nowplaying",
		Duration:    duration,
		ElapsedTime: elapsedTime,
	}, nil
}

func (nowplayingCLI) Control(action string) error {
	cmd := nowplayingCommand(action)
	if cmd == "" {
		return nil
	}
	return exec.Command("nowplaying-cli", cmd).Run()
}

// musicBackend returns the server's MusicBackend, defaulting to nowplayingCLI.
func (s *Server) musicBackend() MusicBackend {
	if s.music != nil {
		return s.music
	}
	return nowplayingCLI{}
}

func (s *Server) handleMusicNowPlaying(w http.ResponseWriter, r *http.Request) {
	resp, _ := s.musicBackend().NowPlaying()
	writeJSON(w, http.StatusOK, resp)
}

type MusicControlRequest struct {
	Action string `json:"action"` // "play", "pause", "next", "previous"
}

func (s *Server) handleMusicControl(w http.ResponseWriter, r *http.Request) {
	var req MusicControlRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if nowplayingCommand(req.Action) == "" {
		writeError(w, http.StatusBadRequest, "unknown action")
		return
	}

	if err := s.musicBackend().Control(req.Action); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to control media")
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func nowplayingCommand(action string) string {
	switch action {
	case "play":
		return "play"
	case "pause":
		return "pause"
	case "toggle":
		return "togglePlayPause"
	case "next":
		return "next"
	case "previous":
		return "previous"
	default:
		return ""
	}
}
