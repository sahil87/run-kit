/**
 * Welcome-page renderer script. Compiled to dist/welcome/welcome.js and loaded
 * via a plain <script src> — deliberately NO import/export statements, so the
 * emitted JS stays a browser-runnable script (no require/exports references).
 *
 * Flow: validate → `welcome:test-server` ping (main process) → pre-fill the
 * display name from the returned hostname → `welcome:add-server`
 * (persist + set active; main then loads the server URL). `?mode=add` shows a
 * cancel link back to the active server.
 *
 * The preload bridge is read via structural narrowing (no Window global
 * augmentation, no `as` casts) — the page degrades to an inline error when
 * opened outside the shell.
 */

interface WelcomeBridge {
  testServer(url: string): Promise<unknown>;
  addServer(name: string, url: string): Promise<unknown>;
  cancel(): Promise<unknown>;
}

interface WelcomeElements {
  form: HTMLFormElement;
  urlInput: HTMLInputElement;
  nameInput: HTMLInputElement;
  errorEl: HTMLElement;
  connectButton: HTMLButtonElement;
  cancelLink: HTMLAnchorElement;
}

interface PingOk {
  ok: true;
  origin: string;
  hostname: string;
}

/** Narrow `window.runkitShell.__welcome` to the bridge shape. */
function getWelcomeBridge(): WelcomeBridge | null {
  const shell: unknown = Reflect.get(window, "runkitShell");
  if (typeof shell !== "object" || shell === null || !("__welcome" in shell)) return null;
  const candidate = shell.__welcome;
  if (typeof candidate !== "object" || candidate === null) return null;
  if (!("testServer" in candidate) || !("addServer" in candidate) || !("cancel" in candidate)) {
    return null;
  }
  // Bind narrowed consts — const narrowing (unlike property narrowing) is
  // preserved inside the closures below.
  const { testServer, addServer, cancel } = candidate;
  if (
    typeof testServer !== "function" ||
    typeof addServer !== "function" ||
    typeof cancel !== "function"
  ) {
    return null;
  }
  return {
    testServer: (url: string): Promise<unknown> => Promise.resolve(testServer(url)),
    addServer: (name: string, url: string): Promise<unknown> =>
      Promise.resolve(addServer(name, url)),
    cancel: (): Promise<unknown> => Promise.resolve(cancel()),
  };
}

function getWelcomeElements(): WelcomeElements | null {
  const form = document.getElementById("connect-form");
  const urlInput = document.getElementById("url");
  const nameInput = document.getElementById("name");
  const errorEl = document.getElementById("error");
  const connectButton = document.getElementById("connect");
  const cancelLink = document.getElementById("cancel");
  if (
    !(form instanceof HTMLFormElement) ||
    !(urlInput instanceof HTMLInputElement) ||
    !(nameInput instanceof HTMLInputElement) ||
    !(errorEl instanceof HTMLElement) ||
    !(connectButton instanceof HTMLButtonElement) ||
    !(cancelLink instanceof HTMLAnchorElement)
  ) {
    return null;
  }
  return { form, urlInput, nameInput, errorEl, connectButton, cancelLink };
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

function wireWelcomePage(els: WelcomeElements, bridge: WelcomeBridge): void {
  const showError = (message: string): void => {
    els.errorEl.textContent = message;
    els.errorEl.hidden = false;
  };
  const setBusy = (label: string | null): void => {
    els.connectButton.disabled = label !== null;
    els.connectButton.textContent = label ?? "Connect";
  };

  // ?mode=add (menu "Add Server…"): a cancel link returns to the active server.
  if (new URLSearchParams(location.search).get("mode") === "add") {
    els.cancelLink.hidden = false;
    els.cancelLink.addEventListener("click", (event) => {
      event.preventDefault();
      void bridge.cancel();
    });
  }

  const connect = async (): Promise<void> => {
    els.errorEl.hidden = true;

    setBusy("Testing…");
    const ping = await bridge.testServer(els.urlInput.value);
    if (!isPingOk(ping)) {
      showError(errorOf(ping));
      setBusy(null);
      return;
    }

    if (els.nameInput.value.trim() === "" && ping.hostname !== "") {
      els.nameInput.value = ping.hostname;
    }

    setBusy("Connecting…");
    const added = await bridge.addServer(els.nameInput.value, ping.origin);
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
})();
