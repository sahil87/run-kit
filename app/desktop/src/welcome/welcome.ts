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
 * `?mode=rename&id=<id>&name=<current>&url=<origin>` reuses this page as the
 * rename affordance (Electron has no native text-input dialog): the URL field
 * is hidden (the origin shows in the tagline), the name input is pre-filled,
 * and submit invokes `welcome:rename-server` — no health ping. The prefill
 * context rides the query string, supplied by main from the store.
 *
 * The preload bridge is read via structural narrowing (no Window global
 * augmentation, no `as` casts) — the page degrades to an inline error when
 * opened outside the shell.
 */

interface WelcomeBridge {
  testServer(url: string): Promise<unknown>;
  addServer(name: string, url: string): Promise<unknown>;
  renameServer(id: string, name: string): Promise<unknown>;
  cancel(): Promise<unknown>;
}

interface WelcomeElements {
  form: HTMLFormElement;
  tagline: HTMLElement;
  urlLabel: HTMLElement;
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

function getWelcomeElements(): WelcomeElements | null {
  const form = document.getElementById("connect-form");
  const tagline = document.getElementById("tagline");
  const urlLabel = document.getElementById("url-label");
  const urlInput = document.getElementById("url");
  const nameInput = document.getElementById("name");
  const errorEl = document.getElementById("error");
  const connectButton = document.getElementById("connect");
  const cancelLink = document.getElementById("cancel");
  if (
    !(form instanceof HTMLFormElement) ||
    !(tagline instanceof HTMLElement) ||
    !(urlLabel instanceof HTMLElement) ||
    !(urlInput instanceof HTMLInputElement) ||
    !(nameInput instanceof HTMLInputElement) ||
    !(errorEl instanceof HTMLElement) ||
    !(connectButton instanceof HTMLButtonElement) ||
    !(cancelLink instanceof HTMLAnchorElement)
  ) {
    return null;
  }
  return { form, tagline, urlLabel, urlInput, nameInput, errorEl, connectButton, cancelLink };
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
    // origin in the tagline, and pre-fill the current display name.
    els.urlLabel.hidden = true;
    els.urlInput.hidden = true;
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
})();
