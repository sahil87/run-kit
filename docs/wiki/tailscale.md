# Tailscale HTTPS

run-kit binds to `127.0.0.1` by default — to access it from other machines on your tailnet over HTTPS, you need a TLS-terminating reverse proxy. Two approaches:

| Approach | Complexity | Cert management | Flexibility |
|----------|-----------|-----------------|-------------|
| **Tailscale Serve** | Zero config | Automatic | Basic reverse proxy only |
| **[Caddy](caddy.md) + `tailscale cert`** | Caddyfile + env vars | Manual provisioning | Full Caddy feature set |

For most setups, **Tailscale Serve is the recommended approach**.

## Prerequisites

Enable HTTPS on your tailnet in the [Tailscale admin console](https://login.tailscale.com/admin/dns) under **DNS > HTTPS Certificates**.

## Option 1: Tailscale Serve (recommended)

Tailscale Serve acts as a reverse proxy with automatic TLS — no Caddy, no cert files, no config.

```sh
# Proxy HTTPS traffic to the run-kit Go server
tailscale serve --bg http://localhost:3000
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

**Setup:** Services require a **tagged node** and some ACL configuration. In your [Tailscale ACL policy](https://login.tailscale.com/admin/acls):

1. Define a tag, grant yourself ownership, and auto-approve service advertisements:

   ```jsonc
   "tagOwners": {
     "tag:server": ["your-email@example.com"]
   },
   "autoApprovers": {
     "services": {
       "svc:runner1": ["tag:server"]
     }
   }
   ```

2. Re-register the node with the tag and allow your user to manage Tailscale without sudo:

   ```sh
   sudo tailscale up --advertise-tags=tag:server --operator=$USER
   ```

3. In the [admin console](https://login.tailscale.com/admin/machines), find the `svc:runner1` service and add `tcp:443` as an endpoint. Without this, you'll see "required ports are missing" even though the service is advertising.

4. Now the service command works:

   ```sh
   tailscale serve --bg --service=svc:runner1 http://localhost:3000
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

For full Caddy setup (cert provisioning, Caddyfile config, trust), see [Caddy HTTPS Proxy](caddy.md).

## Stopping

```sh
# Tailscale Serve
tailscale serve off

# Caddy
caddy stop --address :2020

# Everything (supervisor + Caddy)
just down
```
