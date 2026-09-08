/** The inline error state: message plus a link to the ?raw=1 form — a failed
 *  fetch or unparseable document must never leave a blank frame. */
export function renderViewerError(root: HTMLElement, rawUrl: string, detail: unknown): void {
  const box = document.createElement("div");
  box.className = "viewer-error";
  box.setAttribute("role", "alert");

  const message = document.createElement("p");
  message.textContent = "This document could not be rendered.";

  const link = document.createElement("a");
  link.href = rawUrl;
  link.textContent = "View raw source";

  box.append(message, link);
  if (detail instanceof Error && detail.message !== "") {
    const pre = document.createElement("pre");
    pre.textContent = detail.message;
    box.append(pre);
  }
  root.replaceChildren(box);
}
