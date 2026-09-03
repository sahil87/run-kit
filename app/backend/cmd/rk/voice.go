package main

import (
	"context"

	"rk/internal/settings"
	"rk/internal/stt"

	"github.com/spf13/cobra"
)

// voiceInstallFn / voiceModelTagFn are the package-level seams over the
// installer entry point and the configured model tag (the code_server.go
// newCodeServerInstallerFn idiom), so tests substitute both without network or
// state-dir writes.
var (
	voiceInstallFn  = stt.Install
	voiceModelTagFn = func() string { return settings.Load().VoiceSTTModel }
)

var voiceCmd = &cobra.Command{
	Use:   "voice",
	Short: "Manage the voice round-trip (speech-to-text install)",
	Long: "Manage the voice round-trip's local speech-to-text provisioning. " +
		"`install` fetches the pinned whisper.cpp release binary (SHA256-verified " +
		"against the pinned digest, archive-containment enforced) and the " +
		"configured voice_stt_model ggml file into the state dir. It is " +
		"explicit-only: the daemon and the transcribe path never install — a " +
		"missing install surfaces as a doctor note and a transcribe-time " +
		"remediation pointing here.",
}

var voiceInstallCmd = &cobra.Command{
	Use:   "install",
	Short: "Download the pinned whisper binary and the configured model",
	Long: `Download the pinned whisper.cpp release binary archive for this platform and
the configured voice_stt_model ggml file into the state dir
($XDG_STATE_HOME/run-kit/whisper/), verifying the archive's SHA256 against the
pinned digest and enforcing archive containment on extraction.

Idempotent: when the installed binary already matches the pinned release and
the model file is present, nothing is downloaded. Fail-closed: a platform with
no pinned asset or digest, a digest mismatch, or an archive-escape entry aborts
with the previous install untouched.`,
	Args:         cobra.NoArgs,
	SilenceUsage: true,
	RunE:         runVoiceInstall,
}

func init() {
	voiceCmd.AddCommand(voiceInstallCmd)

	// Arg-count violations on the children are usage-class (exit 2). root.go's
	// central wrap loop covers only rootCmd's direct children, so nested
	// subcommands wrap their own validators here (the code-server idiom).
	for _, c := range voiceCmd.Commands() {
		if c.Args != nil {
			c.Args = usageArgs(c.Args)
		}
	}
}

func runVoiceInstall(cmd *cobra.Command, _ []string) error {
	sink := newSink(cmd)
	model := voiceModelTagFn()
	if model == "" {
		model = stt.DefaultModelTag
	}
	// cmd.Context() is set by Execute(); direct RunE invocations (the package's
	// test idiom) leave it nil, so fall back explicitly.
	ctx := cmd.Context()
	if ctx == nil {
		ctx = context.Background()
	}
	st, err := voiceInstallFn(ctx, stt.InstallOptions{
		ModelTag: model,
		Progress: func(msg string) { sink.Notef("%s\n", msg) },
	})
	if err != nil {
		return err
	}
	sink.Dataf("whisper %s installed: %s; model %s (%s)\n", st.Version, st.BinPath, st.ModelTag, st.ModelPath)
	return nil
}
