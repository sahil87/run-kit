# Install & access

How to install `rk`, keep it up to date, check your runtime, set up a development environment, and reach the dashboard over HTTPS.

## Install

run-kit ships as a Homebrew formula:

```bash
brew install sahil87/tap/rk
```

This puts the `rk` binary on your `PATH`. From there, a clean install to a working dashboard with one agent running is:

```bash
rk agent-setup                  # optional, once per machine: agent busy/waiting/idle in the dashboard
rk serve -d                     # start the dashboard daemon on :3000
open http://localhost:3000      # open the dashboard in your browser

# in any tmux session:
rk riff --skill /fab-discuss    # spawn an agent workspace
```

`rk agent-setup` installs agent-harness hooks into your user-global agent config (v1: Claude Code, `~/.claude/settings.json`) so windows running an agent report live **active/waiting/idle** state in the dashboard. It shows the settings diff and asks before writing; re-running is idempotent, and `rk agent-setup --uninstall` removes exactly the rk-owned entries. Until it's run (and agent sessions are restarted so new sessions pick up the hooks), agent state shows `—`. See [Agent state in the README](../../README.md#agent-state--rk-agent-setup) for how the hooks work.

## Upgrade

```bash
rk update
```

`rk update` pulls the latest version via Homebrew and restarts the daemon so the new binary takes effect immediately.

> **Upgrading from an earlier rk?** Older installs had the agent-hook *logic* inlined in `~/.claude/settings.json`. Run `rk agent-setup` once more to swap in the new delegating wrapper, then restart your agent sessions. Future hook fixes ship in the binary and track `rk update` with no re-setup.

## Prerequisites

`rk riff` requires:

- A running tmux session (`$TMUX` set).
- [`wt`](https://github.com/sahil87/wt) on your `PATH` — install via `brew install sahil87/tap/wt`, or via the toolkit meta-formula `brew install sahil87/tap/all`.
- The launcher (default `claude --dangerously-skip-permissions`) available.

When something breaks, run:

```bash
rk doctor
```

`rk doctor` checks tmux, `wt`, the launcher binary, port availability, and prints per-dependency status. Run this first when something isn't working.

## Development

Run `just doctor` to check development prerequisites (Node 20+, pnpm, tmux, just, Go 1.22+, air, direnv), then:

```bash
just setup
just dev       # watch mode (Go backend + Vite dev server)
just prod      # run from built binary
```

## Tailscale HTTPS

run-kit binds to `127.0.0.1` by default. Some browser features (e.g., copy to clipboard, and Web Push notifications — see below) require a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts), and accessing run-kit from other machines on your tailnet does too. Tailscale Serve handles both with zero TLS config.

> **Web Push & secure contexts**: the `rk notify` command pushes OS-level
> notifications to subscribed browsers (opt in via the `Cmd+K` palette →
> **Notifications: Enable push**). Web Push requires a secure context — **HTTPS
> or `localhost`**. Reaching run-kit on `localhost:3000` directly, or over the
> Tailscale HTTPS endpoint below, both qualify; plain HTTP to a remote host does
> not, and the browser will silently refuse to register the service worker.

### Prerequisites

Enable HTTPS on your tailnet in the [Tailscale admin console](https://login.tailscale.com/admin/dns) under **DNS > HTTPS Certificates**.

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

Serve run-kit under a stable hostname like `runner1.<tailnet>.ts.net` instead of the machine name — the URL survives moving rk to another host.

Services need a tagged node. Do these in order:

1. **Define the `tag:server` tag.** In [Access controls](https://login.tailscale.com/admin/acls), Visual editor → **Tags** → add a tag named `server`. Owners can be left empty.

2. **Re-register the node with the tag** (`--operator` lets you manage Tailscale without sudo afterward):

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
