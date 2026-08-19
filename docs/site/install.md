# Install & access

How to install `run-kit`, keep it up to date, check your runtime, set up a development environment, and reach the dashboard over HTTPS.

## Install

Install via the [shll toolkit](https://shll.ai) bootstrap:

```bash
curl -fsSL https://shll.ai/install | sh -s -- run-kit
```

This installs run-kit (plus the shll meta-CLI) via Homebrew, handling tap trust automatically, and puts the `run-kit` binary on your `PATH`. The formula also installs `rk` as a fully interchangeable short alias, so every command below works the same whether you type `run-kit` or `rk`. From there, a clean install to a working dashboard with one agent running is:

```bash
run-kit agent setup             # optional, once per machine: agent busy/waiting/idle in the dashboard
run-kit daemon start            # start the dashboard daemon on :3000
open http://localhost:3000      # open the dashboard in your browser

# in a tmux session (tmux new -s work if you aren't in one):
run-kit riff                    # spawn an agent workspace (--skill /name picks the slash-command)
```

On a Mac, the [desktop app](#desktop-app-macos) is an alternative front door: `run-kit desktop install`, then open **Run Kit.app** — its welcome page starts the daemon for you (one **Start & connect** click) and can also connect to run-kit on other machines over SSH or a URL, so the `daemon start` and `open` steps above collapse into opening the app.

The last step also needs [`wt`](https://github.com/sahil87/wt) and your agent CLI on `PATH` — see [Prerequisites](#prerequisites) below.

`run-kit agent setup` installs agent-harness hooks into your user-global agent config (v1: Claude Code, `~/.claude/settings.json`) so windows running an agent report live **active/waiting/idle** state in the dashboard. It shows the settings diff and asks before writing; re-running is idempotent, and `run-kit agent setup --uninstall` removes exactly the run-kit-owned entries. Until it's run (and agent sessions are restarted so new sessions pick up the hooks), agent state shows `—`. See [Agent state in the README](https://github.com/sahil87/run-kit/blob/main/README.md#agent-state--run-kit-agent-setup) for how the hooks work.

## tmux version (≥ 3.4)

run-kit requires **tmux 3.4 or newer**. The version is checked at runtime against whatever `tmux` your `PATH` resolves: `run-kit daemon start` prints a one-line warning below the floor (and still starts), `run-kit doctor` reports the version on its tmux row, and `run-kit remote connect` refuses outright below 3.4 — its tunnel windows pass remote host input as tmux argv, which only ≥ 3.4 executes without going through a shell.

The recommended upgrade path is Homebrew on **both** platforms:

```bash
brew upgrade tmux     # macOS
brew install tmux     # Linux — your distro's tmux is too old on older LTS releases
```

Two caveats:

- **PATH order matters.** On Linux, `brew shellenv` must put Homebrew's bin **before** `/usr/bin`, or the distro tmux keeps winning and the runtime check keeps warning — it probes the `tmux` your `PATH` actually resolves, which is exactly the binary run-kit uses.
- **Upgrades are latent.** An upgraded binary takes effect only at the next `tmux kill-server` — the running tmux server keeps its old binary, and the upgrade itself never kills your sessions.

## Upgrade

```bash
run-kit update
```

`run-kit update` pulls the latest version via Homebrew and restarts the daemon so the new binary takes effect immediately. It covers the CLI and daemon only — the desktop app updates separately, via `run-kit desktop update` or the app's **Restart to Update** menu item (see [Desktop app (macOS)](#desktop-app-macos)).

> **Upgrading from an earlier run-kit?** Older installs had the agent-hook *logic* inlined in `~/.claude/settings.json`. Run `run-kit agent setup` once more to swap in the new delegating wrapper, then restart your agent sessions. Future hook fixes ship in the binary and track `run-kit update` with no re-setup.

## Desktop app (macOS)

The optional desktop shell wraps your dashboard in a native window and frees the browser-reserved `⌘` keyboard tier. Install and update it with the CLI:

```bash
run-kit desktop install    # fetch the latest release DMG, install to /Applications
run-kit desktop update     # same, but a no-op when already current
run-kit desktop status     # installed vs latest version (read-only)
```

The CLI path is the primary one for a reason: the DMGs are ad-hoc signed (no notarization), so a browser download is stamped with `com.apple.quarantine` and Gatekeeper blocks the app on every install and update. Quarantine comes from the *downloading application* — command-line tools don't apply it — so the CLI produces a quarantine-free install that opens cleanly every time, verifying the download itself (SHA256 against the release digest when available, plus `codesign --verify --deep --strict`) before installing. Use `--path <dir>` to install somewhere other than `/Applications`, and `--version <tag>` to pin a specific release.

Without the CLI, the fallback is manual: download the DMG for your architecture from [GitHub Releases](https://github.com/sahil87/run-kit/releases), drag **Run Kit.app** into Applications, and clear quarantine via System Settings → Privacy & Security → **Open Anyway** (or `xattr -dr com.apple.quarantine "/Applications/Run Kit.app"`) — repeated on every manual update.

Inside the app, the welcome page offers three ways to connect, in descending order of "already have it here": **This Mac** (detects the local install and daemon state; one **Start & connect** button starts the daemon when needed — post-connect control lives under **Hosts → Local Daemon** in the menu), **over SSH** (`run-kit remote` under the hood: registers the machine, installs run-kit there if missing, starts its daemon, opens a tunnel), and **a URL** (any reachable `run-kit serve` instance, e.g. the Tailscale HTTPS endpoint below). The app never starts or stops the daemon on its own — every daemon action is an explicit click, and your tmux sessions survive all of them.

## Prerequisites

`run-kit riff` requires:

- A running tmux session (`$TMUX` set).
- [`wt`](https://github.com/sahil87/wt) on your `PATH` — included with the [full-toolkit install](https://shll.ai), or `shll install wt`.
- The launcher (default `claude --dangerously-skip-permissions`) available.

When something breaks, run:

```bash
run-kit doctor
```

`run-kit doctor` checks tmux, `wt`, the launcher binary, port availability, and prints per-dependency status. Run this first when something isn't working.

## Development

Run `just doctor` to check development prerequisites (Node 20+, pnpm, tmux, just, Go 1.22+, air, direnv), then:

```bash
just setup
just dev       # watch mode (Go backend + Vite dev server)
just prod      # run from built binary
```

## Tailscale HTTPS

run-kit binds to `127.0.0.1` by default. Some browser features (e.g., copy to clipboard, and Web Push notifications — see below) require a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts), and accessing run-kit from other machines on your tailnet does too. Tailscale Serve handles both with zero TLS config.

> **Web Push & secure contexts**: the `run-kit notify` command pushes OS-level
> notifications to subscribed browsers (opt in via the `Cmd+K` palette →
> **Notifications: Enable push**). Web Push requires a secure context — **HTTPS
> or `localhost`**. Reaching run-kit on `localhost:3000` directly, or over the
> Tailscale HTTPS endpoint below, both qualify; plain HTTP to a remote host does
> not, and the browser will silently refuse to register the service worker.

### Prerequisites

Enable HTTPS on your tailnet in the [Tailscale admin console](https://login.tailscale.com/admin/dns) under **DNS > HTTPS Certificates**.

Then let your user manage Tailscale without sudo (one-time — `tailscale serve` needs root or the designated operator):

```sh
sudo tailscale set --operator=$USER
```

### Quickstart

```sh
tailscale serve --bg http://localhost:3000
```

run-kit is now available at:

```
https://<machine>.<tailnet>.ts.net
```

To check status or stop:

```sh
tailscale serve status
tailscale serve off
```

### Advanced: Custom hostname

Serve run-kit under a stable hostname like `runner1.<tailnet>.ts.net` instead of the machine name — the URL survives moving run-kit to another host.

Services need a tagged node. Do these in order:

1. **Define the `tag:server` tag.** In [Access controls](https://login.tailscale.com/admin/acls), Visual editor → **Tags** → add a tag named `server`. Owners can be left empty.

2. **Re-register the node with the tag.** Tags can only be requested via `tailscale up` (there is no `tailscale set --advertise-tags`), and `up` errors unless every non-default pref is re-stated — so `--operator` is repeated here, not newly set:

   ```sh
   sudo tailscale up --advertise-tags=tag:server --operator=$USER
   ```

3. **Add the HTTPS endpoint.** In the [machines console](https://login.tailscale.com/admin/machines), open the `svc:runner1` service and add `tcp:443`. Skip this and you'll get "required ports are missing" even while the service advertises.

4. **Serve:**

   ```sh
   tailscale serve --bg --service=svc:runner1 http://localhost:3000
   ```

5. **Approve the service.** Open the [Services](https://login.tailscale.com/admin/services) page, find the pending `svc:runner1` advertisement under **Service hosts**, and click **Approve**. The service is inactive until you do.

run-kit is now at `https://runner1.<tailnet>.ts.net`.

> **Note:** Tagging a node drops its user-identity association — user-based ACL grants stop applying. Make sure your ACLs grant the tag what it needs.

> **Tip:** If you advertise services often, you can skip the manual approval in step 5. In the [Access controls](https://login.tailscale.com/admin/acls) **JSON editor**, add an `autoApprovers` block as a top-level key (there's no Visual editor control for service approval), then save — leave the existing `grants` block untouched:
>
> ```jsonc
> "autoApprovers": {
>   "services": {
>     "svc:runner1": ["tag:server"]
>   }
> },
> ```

### Advanced: Public access (Funnel)

To expose run-kit to the public internet (not just your tailnet):

```sh
tailscale funnel --bg http://localhost:3000
```

> **Warning:** Funnel makes your terminal relay publicly accessible. Only use this if you understand the security implications.
