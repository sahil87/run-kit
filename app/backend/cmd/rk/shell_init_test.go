package main

import (
	"bytes"
	"errors"
	"strings"
	"testing"
)

// runShellInitCaptured invokes runShellInit (the os.Exit-free core) against a
// fresh cobra command bound to rootCmd. This bypasses the RunE wrapper's
// os.Exit translation so tests can inspect the returned *exitCodeError
// directly.
func runShellInitCaptured(t *testing.T, args ...string) (string, string, error) {
	t.Helper()
	cmd := newShellInitCmd()
	// Attach to rootCmd so cmd.Root() resolves; not strictly required since
	// runShellInit uses the package-level rootCmd directly, but mirrors real
	// invocation shape.
	rootCmd.AddCommand(cmd)
	defer rootCmd.RemoveCommand(cmd)

	var stdout, stderr bytes.Buffer
	cmd.SetOut(&stdout)
	cmd.SetErr(&stderr)
	err := runShellInit(cmd, args)
	return stdout.String(), stderr.String(), err
}

func TestShellInitZshContainsBannerAndCompletion(t *testing.T) {
	out, _, err := runShellInitCaptured(t, "zsh")
	if err != nil {
		t.Fatalf("shell-init zsh: %v", err)
	}
	// Banner anchors.
	if !strings.Contains(out, "# rk(1) zsh completion") {
		t.Errorf("expected `# rk(1) zsh completion` banner, got:\n%s", out)
	}
	if !strings.Contains(out, `eval "$(rk shell-init zsh)"`) {
		t.Errorf("expected install hint with eval form, got:\n%s", out)
	}
	if !strings.Contains(out, "~/.zshrc") {
		t.Errorf("expected ~/.zshrc install location, got:\n%s", out)
	}
	if !strings.Contains(out, "intended for `eval`") {
		t.Errorf("expected eval-not-fpath note, got:\n%s", out)
	}
	// compinit lazy-load shim.
	if !strings.Contains(out, "$+functions[compdef]") {
		t.Errorf("expected lazy compinit shim, got:\n%s", out)
	}
	if !strings.Contains(out, "autoload -Uz compinit") {
		t.Errorf("expected `autoload -Uz compinit` in shim, got:\n%s", out)
	}
	// Cobra-generated function and compdef registration.
	if !strings.Contains(out, "compdef _rk rk") {
		t.Errorf("expected `compdef _rk rk` registration, got:\n%s", out)
	}
}

func TestShellInitZshDoesNotDefineShellFunctionWrapper(t *testing.T) {
	// Per the brief: rk has no bare-name dispatch or tool-form sugar, so the
	// shell-init output must NOT define an `rk()` shell function wrapper —
	// only the cobra completion function. Guards against accidentally copying
	// the hop/wt wrapper pattern into rk.
	out, _, err := runShellInitCaptured(t, "zsh")
	if err != nil {
		t.Fatalf("shell-init zsh: %v", err)
	}
	// `rk()` followed by `{` would indicate a function definition. The
	// cobra-generated completion DOES define `_rk()` (leading underscore) so
	// we have to anchor on the bare-name form.
	for _, line := range strings.Split(out, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "rk()") || strings.HasPrefix(trimmed, "rk ()") {
			t.Fatalf("expected NO `rk()` shell function wrapper, got line:\n%s", line)
		}
	}
}

func TestShellInitBashContainsBannerAndCompletion(t *testing.T) {
	out, _, err := runShellInitCaptured(t, "bash")
	if err != nil {
		t.Fatalf("shell-init bash: %v", err)
	}
	if !strings.Contains(out, "# rk(1) bash completion") {
		t.Errorf("expected `# rk(1) bash completion` banner, got:\n%s", out)
	}
	if !strings.Contains(out, `eval "$(rk shell-init bash)"`) {
		t.Errorf("expected install hint for bash, got:\n%s", out)
	}
	if !strings.Contains(out, "~/.bashrc") {
		t.Errorf("expected ~/.bashrc install location, got:\n%s", out)
	}
	// cobra V2 bash completion uses __start_rk as the entry function.
	if !strings.Contains(out, "__start_rk") {
		t.Errorf("expected cobra `__start_rk` completion fn, got:\n%s", out)
	}
}

func TestShellInitMissingShell(t *testing.T) {
	_, _, err := runShellInitCaptured(t)
	if err == nil {
		t.Fatal("expected error when no shell arg")
	}
	var ece *exitCodeError
	if !errors.As(err, &ece) {
		t.Fatalf("expected *exitCodeError, got %T: %v", err, err)
	}
	if ece.code != 2 {
		t.Errorf("expected exit code 2, got %d", ece.code)
	}
	if !strings.Contains(ece.msg, "missing shell") {
		t.Errorf("expected `missing shell` in message, got: %q", ece.msg)
	}
	if !strings.Contains(ece.msg, "zsh") || !strings.Contains(ece.msg, "bash") {
		t.Errorf("expected message to mention both zsh and bash, got: %q", ece.msg)
	}
}

func TestShellInitUnsupportedShell(t *testing.T) {
	_, _, err := runShellInitCaptured(t, "wsh")
	if err == nil {
		t.Fatal("expected error for unsupported shell")
	}
	var ece *exitCodeError
	if !errors.As(err, &ece) {
		t.Fatalf("expected *exitCodeError, got %T: %v", err, err)
	}
	if ece.code != 2 {
		t.Errorf("expected exit code 2, got %d", ece.code)
	}
	if !strings.Contains(ece.msg, "unsupported shell 'wsh'") {
		t.Errorf("expected `unsupported shell 'wsh'` in message, got: %q", ece.msg)
	}
}

func TestShellInitRegisteredOnRoot(t *testing.T) {
	// Ensure rootCmd.AddCommand wired shell-init alongside the auto-generated
	// `completion` subcommand. Both must coexist.
	//
	// Note: cobra registers the auto-generated `completion` subcommand lazily
	// during Execute() (via initDefaultCompletionCmd), so it isn't visible on
	// rootCmd.Commands() until then. We invoke `rk completion --help` against
	// a fresh buffer to trigger registration, then assert both subcommands are
	// present.
	rootCmd.SetArgs([]string{"completion", "--help"})
	rootCmd.SetOut(new(bytes.Buffer))
	rootCmd.SetErr(new(bytes.Buffer))
	// Restore args after the test so it doesn't leak into other tests.
	t.Cleanup(func() { rootCmd.SetArgs(nil) })
	if err := rootCmd.Execute(); err != nil {
		t.Fatalf("rk completion --help: %v", err)
	}

	var hasShellInit, hasCompletion bool
	for _, sub := range rootCmd.Commands() {
		switch sub.Name() {
		case "shell-init":
			hasShellInit = true
		case "completion":
			hasCompletion = true
		}
	}
	if !hasShellInit {
		t.Error("expected `shell-init` subcommand registered on rootCmd")
	}
	if !hasCompletion {
		t.Error("expected auto-generated `completion` subcommand still present on rootCmd after Execute")
	}
}
