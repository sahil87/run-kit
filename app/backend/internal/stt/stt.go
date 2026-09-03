// Package stt hosts the managed whisper.cpp speech-to-text install: the
// state-dir layout, the model-tag → ggml filename mapping, the presence
// probe, and the transcription subprocess. The install is a Constitution II
// state-dir carve-out: deleting the tree costs nothing but a re-install, and
// no request-time path treats it as anything but the whisper binary/model
// location.
package stt

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const (
	// DefaultModelTag is the settings-registry default for voice_stt_model.
	DefaultModelTag = "small.en"
	// defaultQuantization is the ggml quantization suffix every bare model tag
	// resolves to; large-v3-turbo ships only q5_0 quantized artifacts.
	defaultQuantization = "q5_1"
	turboModelTag       = "large-v3-turbo"
	turboQuantization   = "q5_0"

	// TranscribeTimeout bounds one whisper subprocess (short-utterance
	// latency band, mirroring the 30s build-operations budget).
	TranscribeTimeout = 30 * time.Second

	binName     = "whisper-cli"
	versionFile = "VERSION"
)

// ErrNotInstalled reports an absent binary or model file; HTTP callers map it
// to the remediation-carrying 503.
var ErrNotInstalled = errors.New("whisper is not installed")

// execCommandContext is the subprocess seam (the mux_send.go pattern): tests
// swap it to intercept the whisper invocation.
var execCommandContext = exec.CommandContext

// RootDir resolves the whisper state root: $XDG_STATE_HOME/run-kit/whisper
// when the env var is set, else ~/.local/state/run-kit/whisper.
func RootDir() (string, error) {
	if v := os.Getenv("XDG_STATE_HOME"); v != "" {
		return filepath.Join(v, "run-kit", "whisper"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolving whisper dir: %w", err)
	}
	return filepath.Join(home, ".local", "state", "run-kit", "whisper"), nil
}

// BinPath is the managed whisper-cli binary location.
func BinPath() (string, error) {
	root, err := RootDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "bin", binName), nil
}

// ModelFile maps a model tag to its ggml filename. A bare tag takes the
// default quantization (the turbo model ships q5_0 only); a tag that already
// carries a quantization suffix passes through unchanged.
func ModelFile(tag string) string {
	if tag == "" {
		tag = DefaultModelTag
	}
	if strings.Contains(tag, "-q") {
		return "ggml-" + tag + ".bin"
	}
	quant := defaultQuantization
	if tag == turboModelTag {
		quant = turboQuantization
	}
	return fmt.Sprintf("ggml-%s-%s.bin", tag, quant)
}

// ModelPath is the on-disk location of a model tag's ggml file.
func ModelPath(tag string) (string, error) {
	root, err := RootDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "models", ModelFile(tag)), nil
}

// Status reports the managed install's presence: binary path + executability,
// the pinned release tag recorded at install time, and the model file.
type Status struct {
	Installed  bool
	BinPath    string
	Version    string
	ModelTag   string
	ModelPath  string
	ModelBytes int64
}

// Probe inspects the state dir without side effects; a missing or partial
// install reports Installed=false rather than erroring. The binary is the
// managed bin/whisper-cli when present and executable, else a whisper-cli
// found on PATH (platforms with no published release archive, e.g. macOS via
// `brew install whisper-cpp`) — a PATH fallback carries no recorded version.
func Probe(modelTag string) Status {
	if modelTag == "" {
		modelTag = DefaultModelTag
	}
	st := Status{ModelTag: modelTag}
	bin, err := BinPath()
	if err != nil {
		return st
	}
	st.BinPath = bin
	model, err := ModelPath(modelTag)
	if err != nil {
		return st
	}
	st.ModelPath = model
	if info, err := os.Stat(bin); err == nil && !info.IsDir() && info.Mode()&0o111 != 0 {
		if tag, err := os.ReadFile(filepath.Join(filepath.Dir(bin), versionFile)); err == nil {
			st.Version = strings.TrimSpace(string(tag))
		}
	} else if pathBin, lookErr := exec.LookPath(binName); lookErr == nil {
		st.BinPath = pathBin
	} else {
		return st
	}
	info, err := os.Stat(model)
	if err != nil || info.IsDir() {
		return st
	}
	st.ModelBytes = info.Size()
	st.Installed = true
	return st
}

// TranscribeOptions parameterizes one whisper invocation. Vocabulary primes
// whisper's initial prompt with request-time derived terms (session/window/
// worktree names) so jargon-dense utterances resolve correctly.
type TranscribeOptions struct {
	WavPath    string
	ModelTag   string
	Vocabulary []string
}

// Transcribe runs whisper-cli over a 16kHz mono WAV file and returns the
// trimmed transcript. The subprocess is an argv slice under one
// TranscribeTimeout context (Constitution I); [BLANK_AUDIO] collapses to the
// empty transcript.
func Transcribe(ctx context.Context, opts TranscribeOptions) (string, error) {
	st := Probe(opts.ModelTag)
	if !st.Installed {
		return "", ErrNotInstalled
	}

	ctx, cancel := context.WithTimeout(ctx, TranscribeTimeout)
	defer cancel()

	args := []string{"-m", st.ModelPath, "-f", opts.WavPath, "-nt", "--no-prints"}
	if len(opts.Vocabulary) > 0 {
		args = append(args, "--prompt", strings.Join(opts.Vocabulary, ", "))
	}
	var stdout, stderr bytes.Buffer
	cmd := execCommandContext(ctx, st.BinPath, args...)
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("whisper-cli: %w (%s)", err, strings.TrimSpace(stderr.String()))
	}
	text := strings.TrimSpace(stdout.String())
	if text == "[BLANK_AUDIO]" {
		return "", nil
	}
	return text, nil
}
