# Browser h1 connection-pool accounting — SSE vs WebSocket (spike)

**Date**: 2026-07-16
**Context**: Design evidence for the socket-unification effort (muxing terminal relays and
SSE streams into a fixed number of sockets). The load-bearing unknown: which stream types
actually occupy the browser's 6-per-origin HTTP/1.1 connection pool on plaintext origins,
and whether that pool is shared across tabs.

## Method

Throwaway harness (`spike-pool.mjs`, appendix below): a zero-dependency Node HTTP/1.1
server on `127.0.0.1:39871` (plaintext, keep-alive) with three endpoints — `/sse`
(text/event-stream, held open), `/ws` (minimal 101 handshake, held open), `/ping`
(instant 200, no-store) — driven by Playwright 1.59.1 headless engines:

| Engine | Version |
|--------|---------|
| Chromium | 147.0.7727.15 |
| Firefox | 148.0.2 |
| WebKit | 26.4 |

Each case runs on a fresh page (fresh pages, one shared browser context). "BLOCKED" =
the operation did not complete within its timeout (fetch 3s, SSE/WS open 4s); "ok" =
completed, with elapsed ms. Every SSE/WS open was individually confirmed via
`onopen` before proceeding.

## Results

| Case | Chromium | Firefox | WebKit |
|------|----------|---------|--------|
| **A** — 6 SSE established, then `fetch` | fetch **BLOCKED** | fetch ok (2ms) | fetch **BLOCKED** |
| **A2** — open 7 SSE | 6 open, **7th stalls** | 6 open, **7th stalls** | 6 open, **7th stalls** |
| **B** — 5 SSE + 1 established WS, then `fetch` | ok (1ms) | ok (1ms) | ok (1ms) |
| **C** — 6 SSE established, then open a WS | WS opens | WS **BLOCKED** | WS **BLOCKED** |
| **E** — 6 established WS, then `fetch` + 1 SSE | both ok | both ok | both ok |
| **D** — 3+3 SSE across two pages, `fetch` on each | both **BLOCKED** | both ok | both **BLOCKED** |

## Findings

1. **EventSource (SSE) holds a pool slot in every engine.** The cap is 6 per origin
   everywhere; a 7th SSE never connects (A2, unanimous).
2. **An *established* WebSocket holds NO h1 pool slot in any engine.** 5 SSE + 1 live WS
   leaves a slot free (B); 6 live WS block nothing (E). Once past the handshake, WS
   connections live outside the pool on all three engines.
3. **The WS *handshake* diverges — this is the sharpest finding.** On Firefox and WebKit,
   a saturated pool blocks new WebSocket handshakes entirely (C): **6 open SSE streams
   mean no new terminal relay can ever connect** on those engines (plaintext). Chromium
   lets handshakes through a full pool.
4. **The pool is shared across tabs** in Chromium and WebKit (D) — per-tab stream budgets
   aggregate. Firefox exempts plain fetches from its 6-persistent-connection cap (A, D:
   fetches succeed even at saturation), so on Firefox only *streams* starve each other,
   not request/response traffic.

## Implications for socket unification

- **SSE fan-out is the actual pool problem — not the terminal WebSockets.** The
  per-server session SSE + metrics SSE + chat SSE are what consume the 6 slots. The
  per-pane relay WSs, once connected, are invisible to the pool on every engine. This
  partially inverts the intuitive priority: the **state-socket change (SSE → one muxed
  WS) delivers the user-facing starvation fix**; the terminal relay mux is connection
  hygiene (TCP count, one reconnect path, fewer handshakes) rather than pool relief.
- **Firefox/WebKit make SSE consolidation urgent, not optional.** A 5-server host holds
  6 SSE slots (5 session + 1 metrics) → on Firefox and Safari-family engines, *no
  terminal can connect at all* (finding 3). This failure mode exists today.
- **Converting streams to WebSockets clears the pool almost entirely.** With state +
  chat + terminals all on WS, steady-state pool usage drops to ~zero; only transient
  fetches and proxied-iframe (`/proxy/{port}/`) traffic remain pool tenants.
- **Multi-tab scaling concern mostly evaporates.** Since established WSs are
  pool-exempt everywhere, N tabs × 2 WS aggregate to zero pool pressure. A SharedWorker
  socket owner is unnecessary for pool reasons (may still be worth it someday for
  server-side attach dedup).
- Prior debugging attributed part of the board-route starvation to "per-pane relay WSs"
  occupying slots — per finding 2 that attribution was wrong for established WSs
  (Chromium); the SSE fan-out + serial chunk fetches (+ possibly in-flight handshakes)
  carried that failure.

**Caveats**: headless Playwright builds on Linux loopback; Safari-proper may differ from
WebKit-GTK in pool details; HTTPS/h2 origins multiplex fetches+SSE onto one connection
and have none of these limits (WS still gets one TCP conn each — RFC 8441 ws-over-h2 is
not available with Go's stock server stack).

## Reproduction

Harness preserved below. Run: `cd app/frontend && node spike-pool.mjs` (needs
`@playwright/test` installed + browsers via `pnpm exec playwright install`).

<details>
<summary>spike-pool.mjs</summary>

```js
// Spike: h1 connection-pool accounting per browser engine.
import { chromium, firefox, webkit } from '@playwright/test';
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = 39871;
const BASE = `http://127.0.0.1:${PORT}`;

const PAGE_HTML = `<!doctype html><meta charset="utf-8"><title>pool spike</title>
<script>
window.streams = [];
window.openSSE = (n, timeoutMs) => {
  const opens = [];
  for (let i = 0; i < n; i++) {
    opens.push(new Promise((resolve) => {
      const es = new EventSource('/sse?i=' + i + '&r=' + Math.random());
      window.streams.push(es);
      const t = setTimeout(() => resolve('timeout'), timeoutMs);
      es.onopen = () => { clearTimeout(t); resolve('open'); };
    }));
  }
  return Promise.all(opens);
};
window.openWS = (timeoutMs) => new Promise((resolve) => {
  const ws = new WebSocket('ws://' + location.host + '/ws?r=' + Math.random());
  window.streams.push(ws);
  const t = setTimeout(() => resolve('timeout'), timeoutMs);
  ws.onopen = () => { clearTimeout(t); resolve('open'); };
  ws.onerror = () => { clearTimeout(t); resolve('error'); };
});
window.openWSMany = async (n, timeoutMs) => {
  const rs = [];
  for (let i = 0; i < n; i++) rs.push(await window.openWS(timeoutMs));
  return rs;
};
window.timedFetch = async (timeoutMs) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  const t0 = performance.now();
  try {
    const res = await fetch('/ping?r=' + Math.random(), { signal: ctl.signal, cache: 'no-store' });
    await res.text();
    return { result: 'ok', ms: Math.round(performance.now() - t0) };
  } catch {
    return { result: 'BLOCKED', ms: Math.round(performance.now() - t0) };
  } finally { clearTimeout(t); }
};
</script>ready`;

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
      res.end(PAGE_HTML);
    } else if (url.pathname === '/sse') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      res.write('retry: 60000\n\ndata: hello\n\n');
    } else if (url.pathname === '/ping') {
      res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      res.end('pong');
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'] || '';
    const accept = crypto
      .createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.on('data', () => {});
    socket.on('error', () => {});
  });
  return new Promise((res) => server.listen(PORT, '127.0.0.1', () => res(server)));
}

const SSE_T = 4000, WS_T = 4000, FETCH_T = 3000;

async function runEngine(browserType, label) {
  const browser = await browserType.launch();
  const context = await browser.newContext();
  const fresh = async () => {
    const p = await context.newPage();
    await p.goto(BASE);
    return p;
  };
  const results = {};

  { // A: 6 SSE -> fetch
    const p = await fresh();
    const sse = await p.evaluate(({ n, t }) => window.openSSE(n, t), { n: 6, t: SSE_T });
    const fetch = await p.evaluate((t) => window.timedFetch(t), FETCH_T);
    results['A  6 SSE -> fetch'] = { sseOpen: sse.filter((r) => r === 'open').length, fetch };
    await p.close();
  }
  { // A2: 7 SSE
    const p = await fresh();
    const sse = await p.evaluate(({ n, t }) => window.openSSE(n, t), { n: 7, t: SSE_T });
    results['A2 7 SSE'] = { sseOpen: sse.filter((r) => r === 'open').length, detail: sse };
    await p.close();
  }
  { // B: 5 SSE + 1 established WS -> fetch
    const p = await fresh();
    const sse = await p.evaluate(({ n, t }) => window.openSSE(n, t), { n: 5, t: SSE_T });
    const ws = await p.evaluate((t) => window.openWS(t), WS_T);
    const fetch = await p.evaluate((t) => window.timedFetch(t), FETCH_T);
    results['B  5 SSE + 1 WS -> fetch'] = { sseOpen: sse.filter((r) => r === 'open').length, ws, fetch };
    await p.close();
  }
  { // C: 6 SSE -> WS handshake
    const p = await fresh();
    const sse = await p.evaluate(({ n, t }) => window.openSSE(n, t), { n: 6, t: SSE_T });
    const ws = await p.evaluate((t) => window.openWS(t), WS_T);
    results['C  6 SSE -> WS'] = { sseOpen: sse.filter((r) => r === 'open').length, ws };
    await p.close();
  }
  { // E: 6 WS -> fetch + SSE
    const p = await fresh();
    const ws = await p.evaluate(({ n, t }) => window.openWSMany(n, t), { n: 6, t: WS_T });
    const fetch = await p.evaluate((t) => window.timedFetch(t), FETCH_T);
    const sse = await p.evaluate(({ n, t }) => window.openSSE(n, t), { n: 1, t: SSE_T });
    results['E  6 WS -> fetch, SSE'] = { wsOpen: ws.filter((r) => r === 'open').length, fetch, sse: sse[0] };
    await p.close();
  }
  { // D: 3+3 SSE across two pages -> fetch on both
    const p1 = await fresh();
    const p2 = await fresh();
    const s1 = await p1.evaluate(({ n, t }) => window.openSSE(n, t), { n: 3, t: SSE_T });
    const s2 = await p2.evaluate(({ n, t }) => window.openSSE(n, t), { n: 3, t: SSE_T });
    const f2 = await p2.evaluate((t) => window.timedFetch(t), FETCH_T);
    const f1 = await p1.evaluate((t) => window.timedFetch(t), FETCH_T);
    results['D  3+3 SSE across 2 pages -> fetch'] = {
      sseOpen: s1.filter((r) => r === 'open').length + s2.filter((r) => r === 'open').length,
      fetchP1: f1,
      fetchP2: f2,
    };
    await p1.close();
    await p2.close();
  }

  await browser.close();
  return { label, results };
}

const server = await startServer();
const out = [];
for (const [type, label] of [
  [chromium, 'chromium'],
  [firefox, 'firefox'],
  [webkit, 'webkit'],
]) {
  try {
    out.push(await runEngine(type, label));
    console.error(`${label} done`);
  } catch (e) {
    out.push({ label, error: String(e).slice(0, 300) });
    console.error(`${label} FAILED: ${e}`);
  }
}
server.close();
console.log(JSON.stringify(out, null, 2));
process.exit(0);
```

</details>
