package main

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"rk/internal/stt"

	"github.com/spf13/cobra"
)

// stubVoiceSeams substitutes the installer and model-tag seams, restoring the
// production defaults on cleanup.
func stubVoiceSeams(t *testing.T, install func(context.Context, stt.InstallOptions) (*stt.Status, error), modelTag string) {
	t.Helper()
	origInstall, origModel := voiceInstallFn, voiceModelTagFn
	voiceInstallFn = install
	voiceModelTagFn = func() string { return modelTag }
	t.Cleanup(func() {
		voiceInstallFn = origInstall
		voiceModelTagFn = origModel
	})
}

func TestVoiceCommandRegistered(t *testing.T) {
	var voice *cobra.Command
	for _, cmd := range rootCmd.Commands() {
		if cmd.Name() == "voice" {
			voice = cmd
			break
		}
	}
	if voice == nil {
		t.Fatal("expected 'voice' subcommand to be registered on rootCmd")
	}
	found := false
	for _, cmd := range voice.Commands() {
		if cmd.Name() == "install" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected 'install' subcommand under 'voice'")
	}
}

func TestVoiceInstallSuccess(t *testing.T) {
	var gotOpts stt.InstallOptions
	stubVoiceSeams(t, func(_ context.Context, opts stt.InstallOptions) (*stt.Status, error) {
		gotOpts = opts
		return &stt.Status{
			Installed: true, Version: "v9.9.9", ModelTag: opts.ModelTag,
			BinPath: "/state/run-kit/whisper/bin/whisper-cli", ModelPath: "/state/run-kit/whisper/models/ggml-small.en-q5_1.bin",
		}, nil
	}, "small.en")

	var data, chatter bytes.Buffer
	cmd := &cobra.Command{}
	cmd.SetOut(&data)
	cmd.SetErr(&chatter)

	if err := runVoiceInstall(cmd, nil); err != nil {
		t.Fatalf("runVoiceInstall: %v", err)
	}
	if gotOpts.ModelTag != "small.en" {
		t.Errorf("ModelTag = %q, want the configured small.en", gotOpts.ModelTag)
	}
	if gotOpts.Progress == nil {
		t.Error("Progress hook not wired")
	}
	gotOpts.Progress("half-way")
	if !strings.Contains(chatter.String(), "half-way") {
		t.Errorf("chatter = %q, want progress lines forwarded", chatter.String())
	}
	out := data.String()
	for _, want := range []string{"v9.9.9", "whisper-cli", "ggml-small.en-q5_1.bin"} {
		if !strings.Contains(out, want) {
			t.Errorf("success line missing %q: %q", want, out)
		}
	}
}

func TestVoiceInstallEmptyModelFallsBack(t *testing.T) {
	var gotOpts stt.InstallOptions
	stubVoiceSeams(t, func(_ context.Context, opts stt.InstallOptions) (*stt.Status, error) {
		gotOpts = opts
		return &stt.Status{Installed: true}, nil
	}, "")

	cmd := &cobra.Command{}
	if err := runVoiceInstall(cmd, nil); err != nil {
		t.Fatalf("runVoiceInstall: %v", err)
	}
	if gotOpts.ModelTag != stt.DefaultModelTag {
		t.Errorf("ModelTag = %q, want the default %q", gotOpts.ModelTag, stt.DefaultModelTag)
	}
}

func TestVoiceInstallErrorPropagates(t *testing.T) {
	stubVoiceSeams(t, func(context.Context, stt.InstallOptions) (*stt.Status, error) {
		return nil, errors.New("no pinned asset for this platform")
	}, "small.en")

	cmd := &cobra.Command{}
	cmd.SetOut(&bytes.Buffer{})
	cmd.SetErr(&bytes.Buffer{})
	err := runVoiceInstall(cmd, nil)
	if err == nil || !strings.Contains(err.Error(), "no pinned asset") {
		t.Fatalf("err = %v, want the installer failure surfaced", err)
	}
}
