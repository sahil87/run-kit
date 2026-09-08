// Present viewer shell bootstrap. The backend serves this shell at the
// document's own /present/ URL for gated extensions, so location.pathname IS
// the document address: relative links/images in rendered markdown resolve
// for free, and the raw source is one query param away (raw=1, all other
// params preserved — the legacy arm needs its server= identity to resolve).

import "./viewer.css";
import { renderViewerError } from "./error";
import { FORMAT_HEADER, documentTitle, rawDocumentUrl, resolveViewerFormat } from "./format";

async function boot(): Promise<void> {
  const root = document.getElementById("viewer-root");
  if (root === null) return;

  const rawUrl = rawDocumentUrl(location.pathname, location.search);

  try {
    document.title = documentTitle(location.pathname);
    const res = await fetch(rawUrl);
    if (!res.ok) throw new Error(`fetch ${rawUrl} → ${res.status}`);
    const source = await res.text();
    const format = resolveViewerFormat(location.pathname, res.headers.get(FORMAT_HEADER));
    if (format === "excalidraw") {
      const { renderExcalidraw } = await import("./excalidraw");
      await renderExcalidraw(root, source);
    } else {
      const { renderMarkdown } = await import("./markdown");
      await renderMarkdown(root, source);
    }
  } catch (err) {
    renderViewerError(root, rawUrl, err);
  }
}

void boot();
