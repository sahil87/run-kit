# Tailscale HTTPS

run-kit binds to `127.0.0.1` by default. Some browser features (e.g., copy to clipboard) require HTTPS, and accessing run-kit from other machines on your tailnet does too. Tailscale Serve handles both with zero TLS config.

## Prerequisites

Enable HTTPS on your tailnet in the [Tailscale admin console](https://login.tailscale.com/admin/dns) under **DNS > HTTPS Certificates**.

## Quickstart

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

## Advanced: Custom hostname

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

## Advanced: Public access (Funnel)

To expose run-kit to the public internet (not just your tailnet):

```sh
tailscale funnel --bg http://localhost:3000
```

> **Warning:** Funnel makes your terminal relay publicly accessible. Only use this if you understand the security implications.
