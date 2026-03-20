# Caddy HTTPS Proxy

Use Caddy when you need features beyond basic reverse proxy (custom headers, rewrites, multiple upstreams) or want to keep Caddy in the stack for other reasons.

For a simpler zero-config approach, see [Tailscale Serve](tailscale.md#option-1-tailscale-serve-recommended).

## Prerequisites

- [Enable HTTPS](https://login.tailscale.com/admin/dns) on your tailnet (DNS > HTTPS Certificates)
- Run `just setup` to copy `Caddyfile.example` to `Caddyfile`

## 1. Edit Caddyfile

After `just setup` copies `Caddyfile.example` to `Caddyfile`, replace `your-machine.ts-home.ts.net` with your actual Tailscale hostname.

## 2. Provision certs

```sh
mkdir -p keys
tailscale cert \
  --cert-file keys/your-machine.ts-home.ts.net.crt \
  --key-file keys/your-machine.ts-home.ts.net.key \
  your-machine.ts-home.ts.net
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
your-machine.ts-home.ts.net:3443 {
    tls keys/your-machine.ts-home.ts.net.crt keys/your-machine.ts-home.ts.net.key
    reverse_proxy localhost:{$RK_PORT:3000}
}
```

## Stopping

```sh
# Stop Caddy
caddy stop --address :2020

# Or stop everything (Caddy + supervisor)
just down
```
