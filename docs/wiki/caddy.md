# Caddy HTTPS Proxy

Use Caddy when you need features beyond basic reverse proxy (custom headers, rewrites, multiple upstreams) or want to keep Caddy in the stack for other reasons.

For a simpler zero-config approach, see [Tailscale Serve](tailscale.md#option-1-tailscale-serve-recommended).

## Prerequisites

- [Enable HTTPS](https://login.tailscale.com/admin/dns) on your tailnet (DNS > HTTPS Certificates)
- Run `just setup` to copy `Caddyfile.example` to `Caddyfile`

## 1. Set your hostname

In `.env.local`:

```sh
RK_HTTPS_HOST=your-machine.tailnet-name.ts.net
RK_HTTPS_PORT=3443   # optional, default 3443
```

## 2. Provision certs

```sh
mkdir -p keys
tailscale cert \
  --cert-file keys/$RK_HTTPS_HOST.crt \
  --key-file keys/$RK_HTTPS_HOST.key \
  $RK_HTTPS_HOST
```

This writes the cert/key pair to `keys/`. Certs are valid for 90 days — re-run when they expire.

## 3. Start Caddy

```sh
caddy run --config Caddyfile
```

Caddy reads the Caddyfile, loads your Tailscale certs from `keys/`, and proxies to the Go server. run-kit is available at:

```
https://your-machine.tailnet-name.ts.net:3443
```

## 4. Trust the CA (optional, for local browsers)

```sh
caddy trust
```

Installs Caddy's local CA into your system trust store so browsers don't show cert warnings.

## Caddyfile

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
# Stop Caddy
caddy stop --address :2020

# Or stop everything (Caddy + supervisor)
just down
```
