package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"rk/internal/present"
	"rk/internal/tmux"
	"rk/internal/validate"

	"github.com/spf13/cobra"
)

// rk present <target> — the one-verb "show this to the user": resolve a
// file/dir/port/URL target, derive its @rk_url value, and attach it to the
// caller's own tmux window (or, with --window, a fresh standalone iframe
// window). It never WRITES the viewer's layout — layout persistence is
// per-viewer client state (docs/specs/surface-layout.md R7/L3) — but a viewer
// mounted on this window's route who observes the @rk_url transition MAY see
// the web tile auto-open transiently (render-time only, nothing persisted);
// other viewers get the rail availability signal, and --notify is the
// out-of-band nudge.
//
// Exit codes follow the toolkit convention (Principle 4): 0 success, 1
// operational failure (not in tmux, missing file, unreachable port, tmux
// failure), 2 usage error (no target, unknown flag). Only the --notify send
// deviates — fail-silent per rk notify's documented contract. Stdout carries
// exactly the resolved URL (data — printed even under --quiet); diagnostics
// go to stderr.

// presentCmdTimeout bounds every tmux subprocess the command spawns
// (Constitution §I: 5-10s for short-lived tmux helpers).
const presentCmdTimeout = 5 * time.Second

var (
	presentWindowFlag string
	presentNotifyFlag string
)

var presentCmd = &cobra.Command{
	Use:   "present <target> [--window[=name]] [--notify[=msg]]",
	Short: "Show a file, directory, port, or URL to the user as a web tile",
	Long: "Attach web content to the user's view. The target resolves to one of:\n" +
		"  ./mock.html          a file — served live, attached to this window\n" +
		"  ./dist/              a directory — served live (index.html default)\n" +
		"  :5173                a local port already serving — attached via /proxy/5173/\n" +
		"  http://localhost:N/… same, rewritten to the relative /proxy/N/… form\n" +
		"  https://…            an external URL — attached verbatim\n\n" +
		"By default the content attaches to the caller's own tmux window (@rk_url),\n" +
		"and the resolved URL prints to stdout (relative for /present and /proxy\n" +
		"targets, absolute for external URLs). --window spawns a standalone\n" +
		"iframe window instead; --notify sends a Web Push after attaching (fail-silent).\n" +
		"A viewer currently on this window's route may see the web tile auto-open\n" +
		"transiently (render-time only, nothing persisted); layout persistence stays\n" +
		"per-viewer.",
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		return runPresent(cmd, args[0])
	},
}

// presentFlagAuto is the NoOptDefVal sentinel for --window/--notify: cobra
// only honors "flag without a value" when NoOptDefVal is non-empty, so a bare
// `--window` parses to this sentinel (derive the default) while `--window=x`
// carries x. The value is impossible to type as a real name/message.
const presentFlagAuto = "\x00auto"

func init() {
	// NoOptDefVal sentinel + Changed() distinguishes a bare --window/--notify
	// (use the derived default) from an absent flag and from --flag=value.
	presentCmd.Flags().StringVar(&presentWindowFlag, "window", "",
		"Spawn a standalone iframe window instead of attaching to this window (optional name; defaults from the target)")
	presentCmd.Flags().Lookup("window").NoOptDefVal = presentFlagAuto
	presentCmd.Flags().StringVar(&presentNotifyFlag, "notify", "",
		"Send a Web Push after attaching (optional message; defaults to \"presenting <basename>\")")
	presentCmd.Flags().Lookup("notify").NoOptDefVal = presentFlagAuto
}

// present*Fn are package-level seams so runPresent can be tested without a
// live tmux server or push endpoint (the role.go pattern); the defaults
// delegate to internal/tmux / internal/present / the rk notify send path.
var (
	presentOriginalTMUXFn = func() string { return tmux.OriginalTMUX }
	presentRunOutputFn    = func(ctx context.Context, args []string) ([]byte, error) {
		return tmux.RunOutput(ctx, args, tmux.RunOpts{})
	}
	presentSetWindowOptionsFn = func(ctx context.Context, windowID, server string, ops []tmux.WindowOptionOp) error {
		return tmux.SetWindowOptions(ctx, windowID, server, ops)
	}
	presentCreateWindowFn = func(session, name, cwd, server string, ops []tmux.WindowOptionOp) error {
		return tmux.CreateWindowWithOptions(session, name, cwd, server, ops)
	}
	presentCreateWindowIDFn = func(session, name, cwd, server string, ops []tmux.WindowOptionOp) (string, error) {
		return tmux.CreateWindowWithOptionsID(session, name, cwd, server, ops)
	}
	presentProbeFn  = func(ctx context.Context, port int) error { return present.ProbePort(ctx, port) }
	presentNotifyFn = sendNotify
	presentNowFn    = func() int64 { return time.Now().Unix() }
)

// Window option keys this command writes. @rk_type is touched ONLY by the
// --window arm — attaching to the caller's own window must not steal its
// default view (HINT_ORDER gives a web default hint only via @rk_type=iframe).
const (
	presentURLOption  = "@rk_url"
	presentRootOption = "@rk_present_root"
	presentTypeOption = "@rk_type"
)

// runPresent is the testable core: parse → probe → attach (or create) → print
// → optionally notify. Every tmux call runs under one bounded context.
func runPresent(cmd *cobra.Command, arg string) error {
	cwd, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("resolve working directory: %w", err)
	}
	target, err := present.ParseTarget(arg, cwd)
	if err != nil {
		return err
	}

	parent := cmd.Context()
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, presentCmdTimeout)
	defer cancel()

	// Best-effort reachability probe for port/local-URL targets only.
	if target.NeedsProbe() {
		if err := presentProbeFn(ctx, target.Port); err != nil {
			return err
		}
	}

	var url string
	if cmd.Flags().Changed("window") {
		url, err = presentViaNewWindow(ctx, cmd, target)
	} else {
		url, err = presentAttach(ctx, target)
	}
	if err != nil {
		return err
	}

	sink := newSink(cmd)
	sink.Dataf("%s\n", url)

	// --notify is fail-silent by contract (rk notify): after a successful
	// attach, send and swallow any failure.
	if cmd.Flags().Changed("notify") {
		msg := presentNotifyFlag
		if msg == presentFlagAuto {
			msg = "presenting " + target.Name
		}
		presentNotifyFn(ctx, "", msg)
	}
	return nil
}

// callerContext resolves the caller's tmux context: the -S socket prefix from
// the ORIGINAL $TMUX (internal/tmux's init() strips $TMUX from the process —
// see writeAgentStateImpl for the full rationale) and the server name the
// ?server= query param and the -L primitives address it by (socket basename,
// matching ListServers naming). Returns ok=false when $TMUX is unset or
// malformed — the caller decides whether that is fatal.
func callerContext() (prefix []string, serverName string, ok bool) {
	tmuxEnv := presentOriginalTMUXFn()
	prefix = tmuxSocketArgs(tmuxEnv)
	if len(prefix) == 0 {
		return nil, "", false
	}
	socket := tmuxEnv
	if i := strings.IndexByte(socket, ','); i >= 0 {
		socket = socket[:i]
	}
	return prefix, filepath.Base(socket), true
}

// presentAttach implements the default arm: set @rk_url (and, for file/dir
// targets, @rk_present_root) on the caller's OWN window, located via
// $TMUX_PANE. No window creation, no API call, no layout mutation.
func presentAttach(ctx context.Context, target present.Target) (string, error) {
	pane := os.Getenv("TMUX_PANE")
	if pane == "" {
		return "", fmt.Errorf("not inside a tmux pane ($TMUX_PANE is unset) — use --window to spawn a standalone window")
	}
	prefix, serverName, ok := callerContext()
	if !ok {
		return "", fmt.Errorf("cannot derive this pane's tmux server socket from $TMUX (unset or malformed) — refusing to target the default server")
	}

	out, err := presentRunOutputFn(ctx, append(prefix, "display-message", "-pt", pane, "#{window_id}"))
	if err != nil {
		return "", fmt.Errorf("resolve current window: %w", err)
	}
	windowID := strings.TrimSpace(string(out))
	if errMsg := validate.ValidateWindowID(windowID, "Window ID"); errMsg != "" {
		return "", fmt.Errorf("resolve current window: %s", errMsg)
	}

	url := target.URL(windowID, serverName, presentNowFn)
	urlOp := url
	ops := []tmux.WindowOptionOp{{Key: presentURLOption, Value: &urlOp}}
	if target.NeedsRoot() {
		root := target.Root
		ops = append(ops, tmux.WindowOptionOp{Key: presentRootOption, Value: &root})
	} else {
		// Clear any stale serve root left by a previous file/dir present on
		// this window — otherwise /present/{windowId}/... would keep serving
		// the old filesystem root after the window moved on to a port/URL
		// target (nil Value = set-option -u).
		ops = append(ops, tmux.WindowOptionOp{Key: presentRootOption, Value: nil})
	}
	if err := presentSetWindowOptionsFn(ctx, windowID, serverName, ops); err != nil {
		return "", fmt.Errorf("attach to window %s: %w", windowID, err)
	}
	return url, nil
}

// presentViaNewWindow implements the --window arm: create a standalone iframe
// window in the caller's session carrying @rk_type=iframe + @rk_url (+ root
// for file/dir targets). For file/dir targets the /present/ URL embeds the
// NEW window's id, so creation runs with @rk_type alone (atomic at creation)
// and the id-dependent options follow in one SetWindowOptions batch.
func presentViaNewWindow(ctx context.Context, cmd *cobra.Command, target present.Target) (string, error) {
	name := presentWindowFlag
	if name == presentFlagAuto {
		name = presentWindowName(target)
	} else if errMsg := validate.ValidateNewName(name, "Window name"); errMsg != "" {
		return "", fmt.Errorf("--window name: %s", errMsg)
	}

	// Session resolution: the caller's current session when inside tmux;
	// outside a pane, the default server's current session (resolvable only
	// when a server is running — otherwise operational failure).
	pane := os.Getenv("TMUX_PANE")
	prefix, serverName, _ := callerContext()
	var session string
	var err error
	if pane != "" {
		if len(prefix) == 0 {
			return "", fmt.Errorf("cannot derive this pane's tmux server socket from $TMUX (unset or malformed)")
		}
		session, err = presentCallerValue(ctx, append(prefix, "display-message", "-pt", pane, "#{session_name}"))
	} else {
		serverName = "default"
		session, err = presentCallerValue(ctx, []string{"display-message", "-p", "#{session_name}"})
	}
	if err != nil {
		return "", fmt.Errorf("resolve target session: %w", err)
	}

	iframe := "iframe"
	if target.NeedsRoot() {
		id, err := presentCreateWindowIDFn(session, name, "", serverName,
			[]tmux.WindowOptionOp{{Key: presentTypeOption, Value: &iframe}})
		if err != nil {
			return "", fmt.Errorf("create window: %w", err)
		}
		url := target.URL(id, serverName, presentNowFn)
		urlOp := url
		root := target.Root
		if err := presentSetWindowOptionsFn(ctx, id, serverName, []tmux.WindowOptionOp{
			{Key: presentURLOption, Value: &urlOp},
			{Key: presentRootOption, Value: &root},
		}); err != nil {
			return "", fmt.Errorf("attach window %s: %w", id, err)
		}
		return url, nil
	}

	url := target.URL("", serverName, presentNowFn)
	urlOp := url
	if err := presentCreateWindowFn(session, name, "", serverName, []tmux.WindowOptionOp{
		{Key: presentTypeOption, Value: &iframe},
		{Key: presentURLOption, Value: &urlOp},
	}); err != nil {
		return "", fmt.Errorf("create window: %w", err)
	}
	return url, nil
}

// presentCallerValue runs a display-message-style tmux read and returns the
// trimmed single-line output.
func presentCallerValue(ctx context.Context, args []string) (string, error) {
	out, err := presentRunOutputFn(ctx, args)
	if err != nil {
		return "", err
	}
	v := strings.TrimSpace(string(out))
	if v == "" {
		return "", fmt.Errorf("empty response from tmux")
	}
	return v, nil
}

// presentWindowName derives the default standalone-window name from the
// target: basename (or host / port-<port>), with colons, periods, and spaces
// replaced by "-" (the port-<port> precedent — ValidateNewName forbids them).
// An unusable remainder falls back to "present".
func presentWindowName(target present.Target) string {
	name := strings.Map(func(r rune) rune {
		switch r {
		case ':', '.', ' ':
			return '-'
		}
		return r
	}, target.Name)
	if validate.ValidateNewName(name, "Window name") != "" {
		return "present"
	}
	return name
}
