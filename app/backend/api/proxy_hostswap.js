// Sibling host-swap shim (subdomain mode). An app served at its own origin —
// {port}.{base}:{rkPort} (base is `localhost` for the zero-config loopback mode,
// or a configured wildcard base_domain) — may still dial a hardcoded absolute
// loopback URL for a sibling service (ws://localhost:4495/…). On a remote viewer
// that hits their own dead loopback. This rewrites any localhost/127.0.0.1 URL to
// its per-port subdomain on the SAME run-kit origin ({sibPort}.{base}:{rkPort}),
// which the host router forwards to 127.0.0.1:{sibPort}. Deterministic call-time
// rewrite — no timing, no location spoofing.
//
// Host-generic: the base is derived from the served host at runtime (the served
// hostname's leading `{port}.` label stripped), so the shim is identical whether
// the app is at {port}.localhost or {port}.apps.example.com — nothing is
// templated in.
(function () {
  "use strict";
  var RKPORT = location.port;
  // Base = the served hostname with its own leading "{port}." label removed:
  // "4295.localhost" → "localhost", "5173.apps.example.com" → "apps.example.com".
  // A hostname with no dot (shouldn't happen under the router) falls back to
  // itself, a harmless no-op base.
  var RKBASE = (function () {
    var h = location.hostname;
    var dot = h.indexOf(".");
    return dot === -1 ? h : h.slice(dot + 1);
  })();

  function swap(raw) {
    try {
      var u = new URL(raw, location.href);
      if (u.hostname !== "localhost" && u.hostname !== "127.0.0.1") return raw;
      var port =
        u.port || (u.protocol === "https:" || u.protocol === "wss:" ? "443" : "80");
      u.hostname = port + "." + RKBASE;
      u.port = RKPORT;
      return u.toString();
    } catch (e) {
      return raw;
    }
  }

  try {
    window.__rkHostSwap = swap;
  } catch (e) {}

  // Constructor patches via a Proxy preserve statics, the prototype, and
  // `instanceof` (Reflect.construct with newTarget = the Proxy).
  function patchConstructor(name) {
    var Orig = window[name];
    if (typeof Orig !== "function") return;
    var Patched = new Proxy(Orig, {
      construct: function (target, args) {
        if (args.length > 0) args[0] = swap(String(args[0]));
        return Reflect.construct(target, args, Patched);
      },
    });
    try {
      window[name] = Patched;
    } catch (e) {}
  }
  patchConstructor("WebSocket");
  patchConstructor("EventSource");

  if (typeof window.fetch === "function") {
    var of = window.fetch;
    window.fetch = function (i, init) {
      try {
        if (typeof i === "string" || i instanceof URL) {
          return of.call(this, swap(String(i)), init);
        }
        if (i && typeof Request !== "undefined" && i instanceof Request) {
          var n = swap(i.url);
          return of.call(this, n === i.url ? i : new Request(n, i), init);
        }
      } catch (e) {}
      return of.apply(this, arguments);
    };
  }

  if (
    window.XMLHttpRequest &&
    XMLHttpRequest.prototype &&
    XMLHttpRequest.prototype.open
  ) {
    var ox = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, url) {
      var args = Array.prototype.slice.call(arguments);
      try {
        args[1] = swap(String(url));
      } catch (e) {}
      return ox.apply(this, args);
    };
  }
})();
