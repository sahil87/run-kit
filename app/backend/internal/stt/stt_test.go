package stt

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

// fakeInstall fabricates a whisper install under a temp XDG_STATE_HOME and
// points the state root at it: bin/whisper-cli (0755, script as content),
// bin/VERSION, and models/ggml-small.en-q5_1.bin. Returns the state root.
func fakeInstall(t *testing.T, script, version string, model []byte) string {
	t.Helper()
	xdg := t.TempDir()
	t.Setenv("XDG_STATE_HOME", xdg)
	root := filepath.Join(xdg, "run-kit", "whisper")
	for _, dir := range []string{filepath.Join(root, "bin"), filepath.Join(root, "models")} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatalf("MkdirAll: %v", err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "bin", "whisper-cli"), []byte(script), 0755); err != nil {
		t.Fatalf("WriteFile binary: %v", err)
	}
	if version != "" {
		if err := os.WriteFile(filepath.Join(root, "bin", "VERSION"), []byte(version), 0644); err != nil {
			t.Fatalf("WriteFile VERSION: %v", err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "models", "ggml-small.en-q5_1.bin"), model, 0644); err != nil {
		t.Fatalf("WriteFile model: %v", err)
	}
	return root
}

func TestModelFile(t *testing.T) {
	for _, tc := range []struct {
		tag  string
		want string
	}{
		{"small.en", "ggml-small.en-q5_1.bin"},
		{"large-v3-turbo", "ggml-large-v3-turbo-q5_0.bin"},
		{"", "ggml-small.en-q5_1.bin"},
		{"small.en-q5_1", "ggml-small.en-q5_1.bin"},
		{"tiny.en", "ggml-tiny.en-q5_1.bin"},
	} {
		if got := ModelFile(tc.tag); got != tc.want {
			t.Errorf("ModelFile(%q) = %q, want %q", tc.tag, got, tc.want)
		}
	}
}

func TestRootDir(t *testing.T) {
	t.Run("XDG_STATE_HOME set", func(t *testing.T) {
		xdg := t.TempDir()
		t.Setenv("XDG_STATE_HOME", xdg)
		got, err := RootDir()
		if err != nil {
			t.Fatalf("RootDir: %v", err)
		}
		if want := filepath.Join(xdg, "run-kit", "whisper"); got != want {
			t.Errorf("RootDir() = %q, want %q", got, want)
		}
	})

	t.Run("unset falls back to ~/.local/state", func(t *testing.T) {
		orig, had := os.LookupEnv("XDG_STATE_HOME")
		if err := os.Unsetenv("XDG_STATE_HOME"); err != nil {
			t.Fatalf("Unsetenv: %v", err)
		}
		t.Cleanup(func() {
			if had {
				os.Setenv("XDG_STATE_HOME", orig)
			}
		})
		home, err := os.UserHomeDir()
		if err != nil {
			t.Fatalf("UserHomeDir: %v", err)
		}
		got, err := RootDir()
		if err != nil {
			t.Fatalf("RootDir: %v", err)
		}
		if want := filepath.Join(home, ".local", "state", "run-kit", "whisper"); got != want {
			t.Errorf("RootDir() = %q, want %q", got, want)
		}
	})
}

func TestProbeEmptyStateDir(t *testing.T) {
	t.Setenv("XDG_STATE_HOME", t.TempDir())
	// Scrub PATH so a host whisper-cli cannot trip the fallback arm.
	t.Setenv("PATH", t.TempDir())
	st := Probe("")
	if st.Installed {
		t.Error("Probe on an empty state dir: Installed = true, want false")
	}
	if st.Version != "" || st.ModelBytes != 0 {
		t.Errorf("Probe on an empty state dir: Version=%q ModelBytes=%d, want empty/0", st.Version, st.ModelBytes)
	}
	if !strings.HasSuffix(st.BinPath, filepath.Join("bin", "whisper-cli")) {
		t.Errorf("BinPath = %q, want .../bin/whisper-cli", st.BinPath)
	}
	if !strings.HasSuffix(st.ModelPath, filepath.Join("models", "ggml-small.en-q5_1.bin")) {
		t.Errorf("ModelPath = %q, want .../models/ggml-small.en-q5_1.bin", st.ModelPath)
	}
}

func TestProbeFabricatedInstall(t *testing.T) {
	model := []byte("fake-model-bytes")
	fakeInstall(t, "#!/bin/sh\nexit 0\n", "v1.8.0\n", model)

	st := Probe("small.en")
	if !st.Installed {
		t.Fatal("Probe on a fabricated install: Installed = false, want true")
	}
	if st.Version != "v1.8.0" {
		t.Errorf("Version = %q, want %q", st.Version, "v1.8.0")
	}
	if st.ModelBytes != int64(len(model)) {
		t.Errorf("ModelBytes = %d, want %d", st.ModelBytes, len(model))
	}
	if st.ModelTag != "small.en" {
		t.Errorf("ModelTag = %q, want %q", st.ModelTag, "small.en")
	}
}

func TestProbePartialInstall(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	t.Run("non-executable binary", func(t *testing.T) {
		root := fakeInstall(t, "#!/bin/sh\nexit 0\n", "", []byte("m"))
		if err := os.Chmod(filepath.Join(root, "bin", "whisper-cli"), 0644); err != nil {
			t.Fatalf("Chmod: %v", err)
		}
		if st := Probe("small.en"); st.Installed {
			t.Error("Installed = true with a non-executable binary, want false")
		}
	})

	t.Run("missing model", func(t *testing.T) {
		root := fakeInstall(t, "#!/bin/sh\nexit 0\n", "", []byte("m"))
		if err := os.Remove(filepath.Join(root, "models", "ggml-small.en-q5_1.bin")); err != nil {
			t.Fatalf("Remove: %v", err)
		}
		if st := Probe("small.en"); st.Installed {
			t.Error("Installed = true with a missing model, want false")
		}
	})
}

// TestProbePathFallback: with no managed binary, a whisper-cli on PATH is the
// binary of record (no recorded version) — the macOS posture, where the
// pinned release publishes no CLI archive.
func TestProbePathFallback(t *testing.T) {
	state := t.TempDir()
	t.Setenv("XDG_STATE_HOME", state)
	pathDir := t.TempDir()
	pathBin := filepath.Join(pathDir, "whisper-cli")
	if err := os.WriteFile(pathBin, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	t.Setenv("PATH", pathDir)
	models := filepath.Join(state, "run-kit", "whisper", "models")
	if err := os.MkdirAll(models, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(filepath.Join(models, "ggml-small.en-q5_1.bin"), []byte("m"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	st := Probe("small.en")
	if !st.Installed {
		t.Fatal("Probe with a PATH binary + model: Installed = false, want true")
	}
	if st.BinPath != pathBin {
		t.Errorf("BinPath = %q, want the PATH binary %q", st.BinPath, pathBin)
	}
	if st.Version != "" {
		t.Errorf("Version = %q, want empty for a PATH fallback", st.Version)
	}
}

// swapExec replaces the subprocess seam with a recorder that delegates to the
// real exec.CommandContext, so the fake on-disk whisper-cli script actually
// runs while the test observes the argv and context it was invoked with.
func swapExec(t *testing.T) (calls *[][]string, deadlineSeen *bool) {
	t.Helper()
	var argv [][]string
	sawDeadline := true
	orig := execCommandContext
	execCommandContext = func(ctx context.Context, name string, args ...string) *exec.Cmd {
		if _, ok := ctx.Deadline(); !ok {
			sawDeadline = false
		}
		argv = append(argv, append([]string{name}, args...))
		return orig(ctx, name, args...)
	}
	t.Cleanup(func() { execCommandContext = orig })
	return &argv, &sawDeadline
}

func TestTranscribeNotInstalled(t *testing.T) {
	t.Setenv("XDG_STATE_HOME", t.TempDir())
	t.Setenv("PATH", t.TempDir())
	called := 0
	orig := execCommandContext
	execCommandContext = func(ctx context.Context, name string, args ...string) *exec.Cmd {
		called++
		return orig(ctx, name, args...)
	}
	t.Cleanup(func() { execCommandContext = orig })

	_, err := Transcribe(context.Background(), TranscribeOptions{WavPath: filepath.Join(t.TempDir(), "in.wav")})
	if !errors.Is(err, ErrNotInstalled) {
		t.Fatalf("Transcribe with no install: err = %v, want ErrNotInstalled", err)
	}
	if called != 0 {
		t.Errorf("subprocess spawned %d times without an install, want 0", called)
	}
}

func TestTranscribeArgvAndOutput(t *testing.T) {
	fakeInstall(t, "#!/bin/sh\nprintf 'hello world\\n'\n", "v1", []byte("m"))
	calls, deadlineSeen := swapExec(t)

	model, err := ModelPath("small.en")
	if err != nil {
		t.Fatalf("ModelPath: %v", err)
	}
	wav := filepath.Join(t.TempDir(), "in.wav")
	got, err := Transcribe(context.Background(), TranscribeOptions{
		WavPath:    wav,
		ModelTag:   "small.en",
		Vocabulary: []string{"tmux", "fab", "run-kit"},
	})
	if err != nil {
		t.Fatalf("Transcribe: %v", err)
	}
	if got != "hello world" {
		t.Errorf("transcript = %q, want %q", got, "hello world")
	}
	if !*deadlineSeen {
		t.Error("whisper invoked without a timeout context")
	}
	if len(*calls) != 1 {
		t.Fatalf("subprocess calls = %d, want 1", len(*calls))
	}
	bin, err := BinPath()
	if err != nil {
		t.Fatalf("BinPath: %v", err)
	}
	want := []string{bin, "-m", model, "-f", wav, "-nt", "--no-prints", "--prompt", "tmux, fab, run-kit"}
	if !reflect.DeepEqual((*calls)[0], want) {
		t.Errorf("argv = %v, want %v", (*calls)[0], want)
	}
}

func TestTranscribeNoVocabularyOmitsPrompt(t *testing.T) {
	fakeInstall(t, "#!/bin/sh\nprintf 'x\\n'\n", "", []byte("m"))
	calls, _ := swapExec(t)

	if _, err := Transcribe(context.Background(), TranscribeOptions{WavPath: "in.wav"}); err != nil {
		t.Fatalf("Transcribe: %v", err)
	}
	for _, arg := range (*calls)[0] {
		if arg == "--prompt" {
			t.Errorf("--prompt present without vocabulary: %v", (*calls)[0])
		}
	}
}

func TestTranscribeTrimsAndCollapsesBlankAudio(t *testing.T) {
	for _, tc := range []struct {
		name   string
		script string
		want   string
	}{
		{"trims whitespace", "#!/bin/sh\nprintf '  spaced out  \\n\\n'\n", "spaced out"},
		{"blank audio collapses to empty", "#!/bin/sh\nprintf '[BLANK_AUDIO]\\n'\n", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fakeInstall(t, tc.script, "", []byte("m"))
			got, err := Transcribe(context.Background(), TranscribeOptions{WavPath: "in.wav"})
			if err != nil {
				t.Fatalf("Transcribe: %v", err)
			}
			if got != tc.want {
				t.Errorf("transcript = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestTranscribeFailure(t *testing.T) {
	fakeInstall(t, "#!/bin/sh\necho boom >&2\nexit 1\n", "", []byte("m"))
	_, err := Transcribe(context.Background(), TranscribeOptions{WavPath: "in.wav"})
	if err == nil {
		t.Fatal("Transcribe with a failing whisper-cli: err = nil, want error")
	}
	if errors.Is(err, ErrNotInstalled) {
		t.Errorf("err = %v, must not be ErrNotInstalled", err)
	}
	if !strings.Contains(err.Error(), "boom") {
		t.Errorf("err = %v, want the stderr diagnostic carried", err)
	}
}

func TestTranscribeDeadlineBounds(t *testing.T) {
	fakeInstall(t, "#!/bin/sh\nprintf 'x\\n'\n", "", []byte("m"))
	var deadline time.Time
	orig := execCommandContext
	execCommandContext = func(ctx context.Context, name string, args ...string) *exec.Cmd {
		deadline, _ = ctx.Deadline()
		return orig(ctx, name, args...)
	}
	t.Cleanup(func() { execCommandContext = orig })

	before := time.Now()
	if _, err := Transcribe(context.Background(), TranscribeOptions{WavPath: "in.wav"}); err != nil {
		t.Fatalf("Transcribe: %v", err)
	}
	if deadline.Before(before.Add(TranscribeTimeout-time.Second)) || deadline.After(time.Now().Add(TranscribeTimeout)) {
		t.Errorf("deadline = %v, want ~%v from invocation", deadline, TranscribeTimeout)
	}
}
