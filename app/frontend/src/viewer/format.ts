/**
 * Pure, DOM-free derivations for the present viewer shell (the same module
 * contract as `lib/web-url.ts`): format detection and the raw-document URL.
 * Kept import-light so unit tests never touch the renderers' heavy chunks.
 */

export type ViewerFormat = "markdown" | "excalidraw";

/** The backend's raw escape hatch (present.go's presentRawParam). */
export const RAW_PARAM = "raw";

/** The response header carrying the backend's RESOLVED-extension format
 *  verdict (present.go's presentFormatHeader). Headers are case-insensitive;
 *  the lowercase form matches fetch's Headers.get idiom. */
export const FORMAT_HEADER = "x-present-format";

const EXCALIDRAW_EXT = ".excalidraw";

/** The viewer format. The backend's resolved-format header wins — the gate
 *  keys on the symlink-RESOLVED extension, and a contained alias whose URL
 *  extension disagrees must still get the matching renderer. Absent the
 *  header (a stale backend), fall back to the URL path's extension; the
 *  backend only serves the shell for gated extensions, so a non-excalidraw
 *  path there is a degraded visit and markdown is the safe default. */
export function resolveViewerFormat(pathname: string, resolvedHeader: string | null): ViewerFormat {
  if (resolvedHeader === "excalidraw" || resolvedHeader === "markdown") return resolvedHeader;
  return pathname.toLowerCase().endsWith(EXCALIDRAW_EXT) ? "excalidraw" : "markdown";
}

/** The raw-document URL: same path, every existing query param preserved (the
 *  legacy arm's `server` identity param, the shared `v` cache-buster), with
 *  the backend's `raw=1` escape hatch set. */
export function rawDocumentUrl(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.set(RAW_PARAM, "1");
  return `${pathname}?${params.toString()}`;
}

/** The document's basename for the shell's <title> (the raw URL's plumbing
 *  segments never reach here — the shell only loads on a file URL). May throw
 *  URIError on a non-UTF-8 name — callers stay inside the error boundary. */
export function documentTitle(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  return last === undefined ? "Viewer" : decodeURIComponent(last);
}
