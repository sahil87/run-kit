// Static .excalidraw rendering: scene JSON → SVG via @excalidraw/utils
// exportToSvg — the utility-only package (no editor/React code in the import
// graph). Its fonts are base64-inlined in the bundle (CJK Xiaolai subsets
// included), so exports work fully offline with no CDN and no font files to
// ship. This module is a lazy chunk — main.ts imports it only for
// .excalidraw URLs.

/** The scene input the viewer accepts. This is the typed boundary over the
 *  pinned @excalidraw/utils@0.1.4 export: that package's own d.ts references
 *  unresolvable sibling type packages, so its call surface degrades to any —
 *  the compile-time contract lives here instead, and the exact-version pin
 *  keeps the runtime signature fixed. */
export interface ExcalidrawSceneInput {
  elements: readonly unknown[];
  appState?: { viewBackgroundColor?: string };
  files?: Record<string, unknown>;
}

/** The slice of @excalidraw/utils the viewer consumes, declared locally so
 *  the call is type-checked against OUR contract (see ExcalidrawSceneInput). */
interface ExcalidrawUtils {
  exportToSvg(input: {
    data: {
      elements: readonly unknown[];
      appState: Record<string, unknown>;
      files: Record<string, unknown>;
    };
    config?: {
      canvasBackgroundColor?: string;
      padding?: number;
      theme?: "light" | "dark";
    };
  }): Promise<SVGSVGElement>;
}

/** Render an .excalidraw scene into root as a static SVG. Throws on input
 *  that is not a scene (the caller renders the inline error state). */
export async function renderExcalidraw(root: HTMLElement, source: string): Promise<void> {
  const data: unknown = JSON.parse(source);
  if (typeof data !== "object" || data === null || !("elements" in data) || !Array.isArray(data.elements)) {
    throw new Error("not an excalidraw scene (missing elements array)");
  }
  const scene = data as ExcalidrawSceneInput;

  const utils: ExcalidrawUtils = await import("@excalidraw/utils");
  const svg = await utils.exportToSvg({
    data: {
      elements: scene.elements,
      appState: { viewBackgroundColor: scene.appState?.viewBackgroundColor ?? "#ffffff" },
      files: scene.files ?? {},
    },
    config: {
      // Transparent background — the page theme shows through.
      canvasBackgroundColor: "transparent",
      padding: 10,
      theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    },
  });

  const holder = document.createElement("div");
  holder.className = "viewer-scene";
  holder.append(svg);
  root.replaceChildren(holder);
}
