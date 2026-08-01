/**
 * Welcome-page renderer script. Compiled to dist/welcome/welcome.js and loaded
 * via a plain <script src> — deliberately NO import/export statements, so the
 * emitted JS stays a browser-runnable script (no require/exports references).
 *
 * Remote flow: validate → `welcome:test-host` ping (main process) →
 * `welcome:add-host` (persist + set active; the display name auto-derives
 * from the ping's returned hostname — there is no name input, and no rename
 * affordance exists: remove-and-re-add is the only way to change a name).
 * `?mode=add` shows a cancel link back to the active host.
 *
 * Local flow ("This Mac" section, darwin/linux only — suppressed on win32):
 * polls `daemon:status` every 3s while the page is visible and renders the
 * four states — running (green dot, Connect + Stop), stopped (grey dot,
 * single "Start & connect"), starting… (amber, buttons disabled), and
 * not-installed (collapses to a brew-install hint). "Start & connect" and
 * Connect share ONE main-side flow (`daemon:start`: start if stopped → wait
 * for health → activate-or-add, never duplicating an entry); Stop invokes
 * `daemon:stop` (main shows the tmux-sessions-survive confirm).
 *
 * The preload bridge is read via structural narrowing (no Window global
 * augmentation, no `as` casts) — the page degrades to an inline error when
 * opened outside the shell.
 */

const LOCAL_STATUS_POLL_MS = 3000;

interface WelcomeBridge {
  testHost(url: string): Promise<unknown>;
  addHost(name: string, url: string): Promise<unknown>;
  cancel(): Promise<unknown>;
}

interface DaemonBridge {
  status(): Promise<unknown>;
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
}

interface RemoteBridge {
  connect(target: string): Promise<unknown>;
  onProgress(handler: (line: string) => void): void;
}

interface WelcomeElements {
  form: HTMLFormElement;
  urlInput: HTMLInputElement;
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
  sshSection: HTMLElement;
  sshTarget: HTMLInputElement;
  sshConnect: HTMLButtonElement;
  sshProgress: HTMLElement;
  sshError: HTMLElement;
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
  if (!("testHost" in candidate) || !("addHost" in candidate) || !("cancel" in candidate)) {
    return null;
  }
  // Bind narrowed consts — const narrowing (unlike property narrowing) is
  // preserved inside the closures below.
  const { testHost, addHost, cancel } = candidate;
  if (
    typeof testHost !== "function" ||
    typeof addHost !== "function" ||
    typeof cancel !== "function"
  ) {
    return null;
  }
  return {
    testHost: (url: string): Promise<unknown> => Promise.resolve(testHost(url)),
    addHost: (name: string, url: string): Promise<unknown> =>
      Promise.resolve(addHost(name, url)),
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

/** Narrow `window.runkitShell.__remote` to the remote-bridge shape. */
function getRemoteBridge(): RemoteBridge | null {
  const shell: unknown = Reflect.get(window, "runkitShell");
  if (typeof shell !== "object" || shell === null || !("__remote" in shell)) return null;
  const candidate = shell.__remote;
  if (typeof candidate !== "object" || candidate === null) return null;
  if (!("connect" in candidate) || !("onProgress" in candidate)) return null;
  const { connect, onProgress } = candidate;
  if (typeof connect !== "function" || typeof onProgress !== "function") return null;
  return {
    connect: (target: string): Promise<unknown> => Promise.resolve(connect(target)),
    onProgress: (handler: (line: string) => void): void => {
      onProgress(handler);
    },
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
  const urlInput = document.getElementById("url");
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
  const sshSection = document.getElementById("ssh");
  const sshTarget = document.getElementById("ssh-target");
  const sshConnect = document.getElementById("ssh-connect");
  const sshProgress = document.getElementById("ssh-progress");
  const sshError = document.getElementById("ssh-error");
  if (
    !(form instanceof HTMLFormElement) ||
    !(urlInput instanceof HTMLInputElement) ||
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
    !(localError instanceof HTMLElement) ||
    !(sshSection instanceof HTMLElement) ||
    !(sshTarget instanceof HTMLInputElement) ||
    !(sshConnect instanceof HTMLButtonElement) ||
    !(sshProgress instanceof HTMLElement) ||
    !(sshError instanceof HTMLElement)
  ) {
    return null;
  }
  return {
    form,
    urlInput,
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
    sshSection,
    sshTarget,
    sshConnect,
    sshProgress,
    sshError,
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

/**
 * The "or over SSH" middle rung — one input, one button, one amber progress
 * line. The renderer only renders: main runs `rk remote add` + `rk remote
 * connect` (execFile) and streams connect's chatter lines back over the
 * `remote:progress` subscription; each line extends the arrow chain
 * (`connecting to buildbox… → opening tunnel on :3100…`). Success means main
 * is navigating this window away (switchToHost) — the rung stays busy.
 */
function wireSshSection(els: WelcomeElements, remote: RemoteBridge): void {
  els.sshSection.hidden = false;

  let busy = false;
  const chain: string[] = [];
  remote.onProgress((line) => {
    if (!busy) return;
    chain.push(line);
    els.sshProgress.textContent = chain.join(" → ");
  });

  const showSshError = (message: string): void => {
    els.sshError.textContent = message;
    els.sshError.hidden = false;
  };

  const connectSsh = async (): Promise<void> => {
    if (busy) return;
    const target = els.sshTarget.value.trim();
    if (target === "") {
      showSshError("Enter an SSH target — user@host or a ~/.ssh/config alias");
      return;
    }
    busy = true;
    els.sshError.hidden = true;
    chain.length = 0;
    els.sshProgress.textContent = `connecting to ${target}…`;
    els.sshProgress.hidden = false;
    els.sshConnect.disabled = true;
    els.sshConnect.textContent = "Connecting…";
    let result: unknown = null;
    try {
      result = await remote.connect(target);
    } catch {
      // A rejected invoke surfaces the generic error below — never stay stuck busy.
    }
    if (isAckOk(result)) return; // success: main is navigating away — stay busy
    showSshError(errorOf(result));
    els.sshProgress.hidden = true;
    els.sshConnect.disabled = false;
    els.sshConnect.textContent = "Connect via SSH";
    busy = false;
  };

  els.sshConnect.addEventListener("click", () => {
    void connectSsh();
  });
  // The input sits outside the URL form — Enter should still connect.
  els.sshTarget.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void connectSsh();
    }
  });
}

function wireWelcomePage(els: WelcomeElements, bridge: WelcomeBridge): void {
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode");

  const showError = (message: string): void => {
    els.errorEl.textContent = message;
    els.errorEl.hidden = false;
  };
  const setBusy = (label: string | null): void => {
    els.connectButton.disabled = label !== null;
    els.connectButton.textContent = label ?? "Connect";
  };

  // ?mode=add (menu "Add Host…"): a cancel link returns to the active host.
  if (mode === "add") {
    els.cancelLink.hidden = false;
    els.cancelLink.addEventListener("click", (event) => {
      event.preventDefault();
      void bridge.cancel();
    });
  }

  const connect = async (): Promise<void> => {
    els.errorEl.hidden = true;

    setBusy("Testing…");
    const ping = await bridge.testHost(els.urlInput.value);
    if (!isPingOk(ping)) {
      showError(errorOf(ping));
      setBusy(null);
      return;
    }

    // No name input on the connect form: the display name auto-derives from
    // the ping's hostname (the store falls back to the origin when empty),
    // and there is no rename — remove-and-re-add changes a name.
    setBusy("Connecting…");
    const added = await bridge.addHost(ping.hostname, ping.origin);
    if (!isAckOk(added)) {
      showError(errorOf(added));
      setBusy(null);
      return;
    }
    // Success: main persists, sets active, and navigates this window away.
  };

  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    void connect();
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

  // "This Mac" section: darwin and linux only — rk daemon/tmux is not a
  // Windows concept, so the section (and its brew hint) is suppressed
  // entirely on win32.
  const platform = getShellPlatform();
  const heading =
    platform === "darwin" ? "This Mac" : platform === "linux" ? "This Machine" : null;
  const daemonBridge = getDaemonBridge();
  if (heading !== null && daemonBridge !== null) {
    wireLocalSection(els, daemonBridge, heading);
  }

  // "or over SSH" rung: same platform gate — the tunnel runs through the
  // LOCAL rk + tmux, which do not exist on win32 (the URL form then stands
  // alone, both dividers hidden with the section).
  const remoteBridge = getRemoteBridge();
  if (heading !== null && remoteBridge !== null) {
    wireSshSection(els, remoteBridge);
  }
})();
