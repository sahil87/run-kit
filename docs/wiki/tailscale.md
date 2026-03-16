# Tailscale HTTPS

run-kit binds to `127.0.0.1` by default — to access it from other machines on your tailnet over HTTPS, you need a TLS-terminating reverse proxy. Two approaches:

| Approach | Complexity | Cert management | Flexibility |
|----------|-----------|-----------------|-------------|
| **Tailscale Serve** | Zero config | Automatic | Basic reverse proxy only |
| **Caddy + `tailscale cert`** | Caddyfile + env vars | Manual provisioning | Full Caddy feature set |

For most setups, **Tailscale Serve is the recommended approach**.

## Prerequisites

Both approaches require:

```sh
# One-time: allow your user to manage Tailscale without sudo
just ts-setup
# (runs: sudo tailscale set --operator=$USER)
```

Enable HTTPS on your tailnet in the [Tailscale admin console](https://login.tailscale.com/admin/dns) under **DNS > HTTPS Certificates**.

## Option 1: Tailscale Serve (recommended)

Tailscale Serve acts as a reverse proxy with automatic TLS — no Caddy, no cert files, no config.

```sh
# Proxy HTTPS traffic to the run-kit Go server
tailscale serve https / http://localhost:3000
```

That's it. run-kit is now available at:

```
https://your-machine.tailnet-name.ts.net
```

### Custom service name (better URL)

Use a Tailscale service to serve run-kit under a dedicated hostname like `runner1.tailnet-name.ts.net` instead of the machine name:

```sh
tailscale serve --service=svc:runner1 http://localhost:3000
```

This gives you `https://runner1.tailnet-name.ts.net` — a clean URL that can be moved between machines without changing.

**Prerequisite:** Services require the node to be a **tagged node**. In your [Tailscale ACL policy](https://login.tailscale.com/admin/acls):

1. Define a tag and grant yourself ownership:

   ```jsonc
   "tagOwners": {
     "tag:server": ["your-email@example.com"]
   }
   ```

2. Re-register the node with the tag:

   ```sh
   sudo tailscale up --advertise-tags=tag:server
   ```

3. Now the service command works:

   ```sh
   tailscale serve --service=svc:runner1 http://localhost:3000
   ```

> **Note:** Tagging a node removes the association with your user identity — ACL rules that grant access by user won't apply. Make sure your ACLs grant the tag access to what it needs.

To check status or remove:

```sh
tailscale serve status
tailscale serve off
```

### Tailscale Funnel (public access)

To expose run-kit to the public internet (not just your tailnet):

```sh
tailscale funnel https / http://localhost:3000
```

> **Warning:** Funnel makes your terminal relay publicly accessible. Only use this if you understand the security implications.

## Option 2: Caddy + `tailscale cert`

Use this if you need Caddy features (custom headers, rewrites, multiple upstreams) or want to keep Caddy in the stack for other reasons.

### 1. Set your hostname

In `.env.local`:

```sh
RK_HTTPS_HOST=your-machine.tailnet-name.ts.net
RK_HTTPS_PORT=3443   # optional, default 3443
```

### 2. Provision certs

```sh
just ts
```

This runs `tailscale cert` and writes the cert/key pair to `keys/`. Certs are valid for 90 days — re-run when they expire.

### 3. Start Caddy

```sh
just https
```

Caddy reads the Caddyfile, loads your Tailscale certs from `keys/`, and proxies to the Go server. run-kit is available at:

```
https://your-machine.tailnet-name.ts.net:3443
```

### 4. Trust the CA (optional, for local browsers)

```sh
just trust
```

Installs Caddy's local CA into your system trust store so browsers don't show cert warnings.

### Caddyfile

The default `Caddyfile.example` (copied to `Caddyfile` by `just setup`) handles TLS termination and reverse proxy:

```caddy
{$RK_HTTPS_HOST:localhost}:{$RK_HTTPS_PORT:3443} {
    tls keys/{$RK_HTTPS_HOST:localhost}.crt keys/{$RK_HTTPS_HOST:localhost}.key
    reverse_proxy localhost:{$RK_PORT:3000}
}
```

All values are configurable via environment variables.

## Stopping

```sh
# Stop Caddy + supervisor
just down

# Or just Caddy
caddy stop --address :2020

# Or just Tailscale Serve
tailscale serve off
```
