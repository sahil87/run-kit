# Install & access

How to install `run-kit`, keep it up to date, check your runtime, set up a development environment, and reach the dashboard over HTTPS.

## Install

Install via the [shll toolkit](https://shll.ai) bootstrap:

```bash
curl -fsSL https://shll.ai/install | sh -s -- run-kit
```

This installs run-kit (plus the shll meta-CLI) via Homebrew, handling tap trust automatically, and puts the `run-kit` binary on your `PATH`. The formula also installs `rk` as a fully interchangeable short alias, so every command below works the same whether you type `run-kit` or `rk`. From there, a clean install to a working dashboard with one agent running is:

```bash
run-kit agent-setup             # optional, once per machine: agent busy/waiting/idle in the dashboard
run-kit daemon start            # start the dashboard daemon on :3000
open http://localhost:3000      # open the dashboard in your browser

# in a tmux session (tmux new -s work if you aren't in one):
run-kit riff                    # spawn an agent workspace (--skill /name picks the slash-command)
```

The last step also needs [`wt`](https://github.com/sahil87/wt) and your agent CLI on `PATH` — see [Prerequisites](#prerequisites) below.

`run-kit agent-setup` installs agent-harness hooks into your user-global agent config (v1: Claude Code, `~/.claude/settings.json`) so windows running an agent report live **active/waiting/idle** state in the dashboard. It shows the settings diff and asks before writing; re-running is idempotent, and `run-kit agent-setup --uninstall` removes exactly the run-kit-owned entries. Until it's run (and agent sessions are restarted so new sessions pick up the hooks), agent state shows `—`. See [Agent state in the README](https://github.com/sahil87/run-kit/blob/main/README.md#agent-state--run-kit-agent-setup) for how the hooks work.

## Upgrade

```bash
run-kit update
```

`run-kit update` pulls the latest version via Homebrew and restarts the daemon so the new binary takes effect immediately.

> **Upgrading from an earlier run-kit?** Older installs had the agent-hook *logic* inlined in `~/.claude/settings.json`. Run `run-kit agent-setup` once more to swap in the new delegating wrapper, then restart your agent sessions. Future hook fixes ship in the binary and track `run-kit update` with no re-setup.

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
