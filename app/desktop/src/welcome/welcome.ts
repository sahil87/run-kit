/**
 * Welcome-page renderer script. Compiled to dist/welcome/welcome.js and loaded
 * via a plain <script src> — deliberately NO import/export statements, so the
 * emitted JS stays a browser-runnable script (no require/exports references).
 *
 * Remote flow: validate → `welcome:test-server` ping (main process) →
 * `welcome:add-server` (persist + set active; the display name auto-derives
 * from the ping's returned hostname — there is no name input on the connect
 * form). `?mode=add` shows a cancel link back to the active server.
 *
 * Local flow ("This Mac" section, darwin/linux only — suppressed on win32 and
 * in rename mode): polls `daemon:status` every 3s while the page is visible
 * and renders the four states — running (green dot, Connect + Stop), stopped
 * (grey dot, single "Start & connect"), starting… (amber, buttons disabled),
 * and not-installed (collapses to a brew-install hint). "Start & connect" and
 * Connect share ONE main-side flow (`daemon:start`: start if stopped → wait
 * for health → activate-or-add, never duplicating an entry); Stop invokes
 * `daemon:stop` (main shows the tmux-sessions-survive confirm).
 *
 * `?mode=rename&id=<id>&name=<current>&url=<origin>` reuses this page as the
 * rename affordance (Electron has no native text-input dialog): the URL field
 * is hidden (the origin shows in the tagline), the name input — hidden on the
 * plain connect form — is revealed and pre-filled, and submit invokes
 * `welcome:rename-server` — no health ping. The prefill context rides the
 * query string, supplied by main from the store.
 *
 * The preload bridge is read via structural narrowing (no Window global
 * augmentation, no `as` casts) — the page degrades to an inline error when
 * opened outside the shell.
 */

const LOCAL_STATUS_POLL_MS = 3000;

interface WelcomeBridge {
  testServer(url: string): Promise<unknown>;
  addServer(name: string, url: string): Promise<unknown>;
  renameServer(id: string, name: string): Promise<unknown>;
  cancel(): Promise<unknown>;
}

interface DaemonBridge {
  status(): Promise<unknown>;
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
}

interface WelcomeElements {
  form: HTMLFormElement;
  tagline: HTMLElement;
  urlLabel: HTMLElement;
  urlInput: HTMLInputElement;
  nameLabel: HTMLElement;
  nameInput: HTMLInputElement;
  errorEl: HTMLElement;
  connectButton: HTMLButtonElement;
  cancelLink: HTMLAnchorElement;
  localSection: HTMLElement;
  localHeading: HTMLElement;
  localStatusRow: HTMLElement;
  localDot: HTMLElement;
  localStatus: HTMLElement;
  localDetail: HTMLElement;
  localHint: HTMLElement;
  localConnect: HTMLButtonElement;
  localStop: HTMLButtonElement;
  localError: HTMLElement;
}

interface PingOk {
  ok: true;
  origin: string;
  hostname: string;
}

/** Mirror of the main process's DaemonStatus (structurally re-narrowed here). */
type LocalDaemonStatus =
  | { installed: false }
  | { installed: true; running: false; version: string | null; origin: string }
  | {
      installed: true;
      running: true;
      version: string | null;
      origin: string;
      hostname: string;
      sessions: number | null;
    };

/** Narrow `window.runkitShell.__welcome` to the bridge shape. */
function getWelcomeBridge(): WelcomeBridge | null {
  const shell: unknown = Reflect.get(window, "runkitShell");
  if (typeof shell !== "object" || shell === null || !("__welcome" in shell)) return null;
  const candidate = shell.__welcome;
  if (typeof candidate !== "object" || candidate === null) return null;
  if (
    !("testServer" in candidate) ||
    !("addServer" in candidate) ||
    !("renameServer" in candidate) ||
    !("cancel" in candidate)
  ) {
    return null;
  }
  // Bind narrowed consts — const narrowing (unlike property narrowing) is
  // preserved inside the closures below.
  const { testServer, addServer, renameServer, cancel } = candidate;
  if (
    typeof testServer !== "function" ||
    typeof addServer !== "function" ||
    typeof renameServer !== "function" ||
    typeof cancel !== "function"
  ) {
    return null;
  }
  return {
    testServer: (url: string): Promise<unknown> => Promise.resolve(testServer(url)),
    addServer: (name: string, url: string): Promise<unknown> =>
      Promise.resolve(addServer(name, url)),
    renameServer: (id: string, name: string): Promise<unknown> =>
      Promise.resolve(renameServer(id, name)),
    cancel: (): Promise<unknown> => Promise.resolve(cancel()),
  };
}

/** Narrow `window.runkitShell.__daemon` to the daemon-bridge shape. */
function getDaemonBridge(): DaemonBridge | null {
  const shell: unknown = Reflect.get(window, "runkitShell");
  if (typeof shell !== "object" || shell === null || !("__daemon" in shell)) return null;
  const candidate = shell.__daemon;
  if (typeof candidate !== "object" || candidate === null) return null;
  if (!("status" in candidate) || !("start" in candidate) || !("stop" in candidate)) return null;
  const { status, start, stop } = candidate;
  if (typeof status !== "function" || typeof start !== "function" || typeof stop !== "function") {
    return null;
  }
  return {
    status: (): Promise<unknown> => Promise.resolve(status()),
    start: (): Promise<unknown> => Promise.resolve(start()),
    stop: (): Promise<unknown> => Promise.resolve(stop()),
  };
}

/** Narrow `window.runkitShell.platform` (drives the local-section heading). */
function getShellPlatform(): string | null {
  const shell: unknown = Reflect.get(window, "runkitShell");
  if (typeof shell !== "object" || shell === null || !("platform" in shell)) return null;
  return typeof shell.platform === "string" ? shell.platform : null;
}

function getWelcomeElements(): WelcomeElements | null {
  const form = document.getElementById("connect-form");
  const tagline = document.getElementById("tagline");
  const urlLabel = document.getElementById("url-label");
  const urlInput = document.getElementById("url");
  const nameLabel = document.getElementById("name-label");
  const nameInput = document.getElementById("name");
  const errorEl = document.getElementById("error");
  const connectButton = document.getElementById("connect");
  const cancelLink = document.getElementById("cancel");
  const localSection = document.getElementById("local");
  const localHeading = document.getElementById("local-heading");
  const localStatusRow = document.getElementById("local-status-row");
  const localDot = document.getElementById("local-dot");
  const localStatus = document.getElementById("local-status");
  const localDetail = document.getElementById("local-detail");
  const localHint = document.getElementById("local-hint");
  const localConnect = document.getElementById("local-connect");
  const localStop = document.getElementById("local-stop");
  const localError = document.getElementById("local-error");
  if (
    !(form instanceof HTMLFormElement) ||
    !(tagline instanceof HTMLElement) ||
    !(urlLabel instanceof HTMLElement) ||
    !(urlInput instanceof HTMLInputElement) ||
    !(nameLabel instanceof HTMLElement) ||
    !(nameInput instanceof HTMLInputElement) ||
    !(errorEl instanceof HTMLElement) ||
    !(connectButton instanceof HTMLButtonElement) ||
    !(cancelLink instanceof HTMLAnchorElement) ||
    !(localSection instanceof HTMLElement) ||
    !(localHeading instanceof HTMLElement) ||
    !(localStatusRow instanceof HTMLElement) ||
    !(localDot instanceof HTMLElement) ||
    !(localStatus instanceof HTMLElement) ||
    !(localDetail instanceof HTMLElement) ||
    !(localHint instanceof HTMLElement) ||
    !(localConnect instanceof HTMLButtonElement) ||
    !(localStop instanceof HTMLButtonElement) ||
    !(localError instanceof HTMLElement)
  ) {
    return null;
  }
  return {
    form,
    tagline,
    urlLabel,
    urlInput,
    nameLabel,
    nameInput,
    errorEl,
    connectButton,
    cancelLink,
    localSection,
    localHeading,
    localStatusRow,
    localDot,
    localStatus,
    localDetail,
    localHint,
    localConnect,
    localStop,
    localError,
  };
}

/** Narrow an IPC result to the ping success shape. */
function isPingOk(value: unknown): value is PingOk {
  if (typeof value !== "object" || value === null) return false;
  if (!("ok" in value) || value.ok !== true) return false;
  if (!("origin" in value) || typeof value.origin !== "string") return false;
  return "hostname" in value && typeof value.hostname === "string";
}

/** Narrow an IPC result to `{ ok: true }`. */
function isAckOk(value: unknown): value is { ok: true } {
  return typeof value === "object" && value !== null && "ok" in value && value.ok === true;
}

/** Extract the error string from a failed IPC result, with a generic fallback. */
function errorOf(value: unknown): string {
  if (typeof value === "object" && value !== null && "error" in value) {
    if (typeof value.error === "string") return value.error;
  }
  return "Something went wrong — check the URL and try again";
}

/** Narrow one daemon status object (the `status` field of a daemon:status ok-envelope). */
function narrowDaemonStatus(value: unknown): LocalDaemonStatus | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("installed" in value) || typeof value.installed !== "boolean") return null;
  if (!value.installed) return { installed: false };
  if (!("running" in value) || typeof value.running !== "boolean") return null;
  if (!("origin" in value) || typeof value.origin !== "string") return null;
  const version =
    "version" in value && typeof value.version === "string" ? value.version : null;
  if (!value.running) {
    return { installed: true, running: false, version, origin: value.origin };
  }
  const hostname =
    "hostname" in value && typeof value.hostname === "string" ? value.hostname : "";
  const sessions =
    "sessions" in value && typeof value.sessions === "number" ? value.sessions : null;
  return { installed: true, running: true, version, origin: value.origin, hostname, sessions };
}

/** Narrow a `daemon:status` result envelope to a status, else null. */
function daemonStatusOf(value: unknown): LocalDaemonStatus | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("ok" in value) || value.ok !== true || !("status" in value)) return null;
  return narrowDaemonStatus(value.status);
}

/** `http://127.0.0.1:3000` → `127.0.0.1:3000` (the mock's `{host}:{port}`). */
function hostPortOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/**
 * The "This Mac" local-daemon section — detection-driven state machine.
 * Polls `daemon:status` every 3s while the page is visible (the interval
 * dies with the page); a start/stop flow in flight suspends repainting so
 * the transient starting… state is never clobbered by a poll.
 */
function wireLocalSection(els: WelcomeElements, daemon: DaemonBridge, heading: string): void {
  els.localHeading.textContent = heading;
  els.localSection.hidden = false;

  let lastStatus: LocalDaemonStatus | null = null;
  let busy = false; // a start/stop flow is in flight — polls must not repaint
  let inFlight = false; // a status request is in flight — no request pileup

  const showLocalError = (message: string): void => {
    els.localError.textContent = message;
    els.localError.hidden = false;
  };

  const render = (status: LocalDaemonStatus): void => {
    if (!status.installed) {
      // Not installed: the section collapses to the brew-install hint.
      els.localStatusRow.hidden = true;
      els.localDetail.hidden = true;
      els.localConnect.hidden = true;
      els.localStop.hidden = true;
      els.localHint.hidden = false;
      return;
    }
    els.localHint.hidden = true;
    els.localStatusRow.hidden = false;
    els.localDetail.hidden = false;
    els.localConnect.hidden = false;
    els.localConnect.disabled = false;
    const versionSuffix = status.version !== null ? ` · v${status.version}` : "";
    if (status.running) {
      els.localDot.className = "dot running";
      els.localStatus.textContent = `running${versionSuffix}`;
      const sessionsSuffix =
        status.sessions !== null
          ? ` · ${status.sessions} session${status.sessions === 1 ? "" : "s"}`
          : "";
      els.localDetail.textContent = `${hostPortOf(status.origin)}${sessionsSuffix}`;
      els.localConnect.textContent = "Connect";
      els.localStop.hidden = false;
      els.localStop.disabled = false;
    } else {
      els.localDot.className = "dot";
      els.localStatus.textContent = "stopped";
      const installedAs = status.version !== null ? `rk v${status.version}` : "rk";
      els.localDetail.textContent = `${installedAs} installed · runs \`rk daemon start\``;
      els.localConnect.textContent = "Start & connect";
      els.localStop.hidden = true;
    }
  };

  const renderStarting = (origin: string | null): void => {
    els.localDot.className = "dot starting";
    els.localStatus.textContent = "starting…";
    els.localDetail.textContent =
      origin !== null
        ? `waiting for ${hostPortOf(origin)} to answer`
        : "waiting for the daemon to answer";
    els.localConnect.disabled = true;
    els.localStop.disabled = true;
  };

  const refresh = async (): Promise<void> => {
    if (busy || inFlight) return;
    inFlight = true;
    let result: unknown = null;
    try {
      result = await daemon.status();
    } catch {
      // A rejected invoke is transient — fall through to the null-status path.
    } finally {
      inFlight = false; // never leave the flag stuck (polling would stop for good)
    }
    if (busy) return; // a flow started while the request was out
    const status = daemonStatusOf(result);
    // A failed/malformed probe keeps the previous rendering (transient).
    if (status !== null) {
      lastStatus = status;
      render(status);
    }
  };

  // ONE get-in flow for both button states: main starts the daemon when
  // stopped (already-running errors count as started), waits for health,
  // then activates-or-adds the local entry and navigates this window away.
  const connectLocal = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    els.localError.hidden = true;
    const wasRunning = lastStatus !== null && lastStatus.installed && lastStatus.running;
    if (wasRunning) {
      els.localConnect.disabled = true;
      els.localConnect.textContent = "Connecting…";
      els.localStop.disabled = true;
    } else {
      renderStarting(lastStatus !== null && lastStatus.installed ? lastStatus.origin : null);
    }
    let result: unknown = null;
    try {
      result = await daemon.start();
    } catch {
      // A rejected invoke surfaces the generic error below — never stay stuck busy.
    }
    if (isAckOk(result)) return; // success: main is navigating away — stay busy
    showLocalError(errorOf(result));
    busy = false;
    if (lastStatus !== null) render(lastStatus);
    void refresh();
  };

  const stopLocal = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    els.localError.hidden = true;
    els.localStop.disabled = true;
    let result: unknown = null;
    try {
      result = await daemon.stop(); // main confirms (tmux sessions survive)
    } catch {
      // A rejected invoke surfaces the generic error below — never stay stuck busy.
    }
    busy = false;
    if (!isAckOk(result)) showLocalError(errorOf(result));
    if (lastStatus !== null) render(lastStatus);
    void refresh();
  };

  els.localConnect.addEventListener("click", () => {
    void connectLocal();
  });
  els.localStop.addEventListener("click", () => {
    void stopLocal();
  });

  void refresh();
  window.setInterval(() => {
    void refresh();
  }, LOCAL_STATUS_POLL_MS);
}

function wireWelcomePage(els: WelcomeElements, bridge: WelcomeBridge): void {
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode");
  // ?mode=rename&id=…: this page doubles as the rename affordance. A missing
  // or blank id is NOT rename mode (the rename IPC would no-op in the store
  // while the page appeared to succeed) — treat it as the plain connect page.
  const idParam = params.get("id");
  const renameId =
    mode === "rename" && idParam !== null && idParam.trim() !== "" ? idParam : null;

  const idleLabel = renameId !== null ? "Rename" : "Connect";
  const showError = (message: string): void => {
    els.errorEl.textContent = message;
    els.errorEl.hidden = false;
  };
  const setBusy = (label: string | null): void => {
    els.connectButton.disabled = label !== null;
    els.connectButton.textContent = label ?? idleLabel;
  };

  // ?mode=add (menu "Add Server…") and ?mode=rename (menu "Rename …"):
  // a cancel link returns to the active server.
  if (mode === "add" || renameId !== null) {
    els.cancelLink.hidden = false;
    els.cancelLink.addEventListener("click", (event) => {
      event.preventDefault();
      void bridge.cancel();
    });
  }

  if (renameId !== null) {
    // Rename variant: the server URL is fixed — hide its field, show the
    // origin in the tagline, and reveal + pre-fill the name input (hidden on
    // the plain connect form, where the name auto-derives from the ping).
    els.urlLabel.hidden = true;
    els.urlInput.hidden = true;
    els.nameLabel.hidden = false;
    els.nameInput.hidden = false;
    els.tagline.textContent = params.get("url") ?? "";
    els.nameInput.value = params.get("name") ?? "";
    els.connectButton.textContent = idleLabel;
    els.nameInput.focus();
  }

  const rename = async (id: string): Promise<void> => {
    els.errorEl.hidden = true;

    setBusy("Renaming…");
    const result = await bridge.renameServer(id, els.nameInput.value);
    if (!isAckOk(result)) {
      showError(errorOf(result));
      setBusy(null);
      return;
    }
    // Success: main persists, rebuilds the menu, and navigates back.
  };

  const connect = async (): Promise<void> => {
    els.errorEl.hidden = true;

    setBusy("Testing…");
    const ping = await bridge.testServer(els.urlInput.value);
    if (!isPingOk(ping)) {
      showError(errorOf(ping));
      setBusy(null);
      return;
    }

    // No name input on the connect form: the display name auto-derives from
    // the ping's hostname (the store falls back to the origin when empty).
    setBusy("Connecting…");
    const added = await bridge.addServer(ping.hostname, ping.origin);
    if (!isAckOk(added)) {
      showError(errorOf(added));
      setBusy(null);
      return;
    }
    // Success: main persists, sets active, and navigates this window away.
  };

  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    void (renameId !== null ? rename(renameId) : connect());
  });
}

(() => {
  const els = getWelcomeElements();
  if (!els) return;
  const bridge = getWelcomeBridge();
  if (!bridge) {
    els.errorEl.textContent =
      "Shell bridge unavailable — this page only works inside the Run Kit desktop app";
    els.errorEl.hidden = false;
    els.connectButton.disabled = true;
    return;
  }
  wireWelcomePage(els, bridge);

  // "This Mac" section: pre-connect / add-server surfaces only (not rename),
  // darwin and linux only — rk daemon/tmux is not a Windows concept, so the
  // section (and its brew hint) is suppressed entirely on win32.
  const mode = new URLSearchParams(location.search).get("mode");
  const platform = getShellPlatform();
  const heading =
    platform === "darwin" ? "This Mac" : platform === "linux" ? "This Machine" : null;
  const daemonBridge = getDaemonBridge();
  if (mode !== "rename" && heading !== null && daemonBridge !== null) {
    wireLocalSection(els, daemonBridge, heading);
  }
})();
