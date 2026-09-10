import MarkdownIt from "markdown-it";

// Raw HTML passes through (html: true): sanitization is deliberately not the
// trust boundary here — /present already serves same-origin-scripting .html
// files, so an author's embedded markup is no new exposure.
const md = new MarkdownIt({ html: true, linkify: true });

let mermaidSeq = 0;

/** Class toggled on a diagram holder to show the SVG at its natural pixel
 *  size (horizontal scroll inside the holder) instead of shrunk to the
 *  column. The parent web tile zooms by narrowing the iframe's viewport and
 *  scaling it back up, so a column-fitted diagram never grows with page zoom;
 *  natural size is what lets zoom take a diagram past the column. */
export const DIAGRAM_NATURAL_CLASS = "natural";

const FIT_TITLE = "Show at natural size";
const NATURAL_TITLE = "Fit to column";

/**
 * Give a mermaid SVG explicit pixel dimensions from its viewBox. Mermaid's
 * default `useMaxWidth` emits `width="100%"` plus an inline `max-width`, which
 * would fill the holder in natural mode rather than overflow it; explicit
 * dimensions let the stylesheet own both modes (`max-width: 100%` fits,
 * `max-width: none` overflows). A missing or malformed viewBox leaves the SVG
 * untouched.
 */
export function normalizeDiagramSvg(svg: SVGElement): void {
  const parts = (svg.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/);
  if (parts.length !== 4) return;
  const width = Number(parts[2]);
  const height = Number(parts[3]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.style.maxWidth = "";
}

/** Flip a diagram holder between fit-to-column and natural size. */
export function toggleDiagramSize(holder: HTMLElement): void {
  const natural = holder.classList.toggle(DIAGRAM_NATURAL_CLASS);
  holder.setAttribute("aria-pressed", String(natural));
  holder.title = natural ? NATURAL_TITLE : FIT_TITLE;
}

/** The holder for one rendered diagram: a focusable toggle button (click,
 *  Enter, Space) between fit and natural size. Clicks that land on a link
 *  inside the diagram (mermaid `click` bindings) are left to the link. */
export function createDiagramHolder(): HTMLDivElement {
  const holder = document.createElement("div");
  holder.className = "viewer-diagram";
  holder.tabIndex = 0;
  holder.setAttribute("role", "button");
  holder.setAttribute("aria-pressed", "false");
  holder.title = FIT_TITLE;
  holder.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a") !== null) return;
    toggleDiagramSize(holder);
  });
  holder.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleDiagramSize(holder);
  });
  return holder;
}

/** Render markdown into root. Relative links/images resolve against the
 *  document's own URL for free — the shell is served at that URL. Mermaid
 *  fences are rendered client-side, and the mermaid chunk loads only when a
 *  fence exists. */
export async function renderMarkdown(root: HTMLElement, source: string): Promise<void> {
  const article = document.createElement("article");
  article.innerHTML = md.render(source);
  root.replaceChildren(article);

  const fences = article.querySelectorAll("pre > code.language-mermaid");
  if (fences.length === 0) return;

  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default",
  });
  for (const code of fences) {
    const pre = code.parentElement;
    if (pre === null) continue;
    const holder = createDiagramHolder();
    try {
      const { svg } = await mermaid.render(`viewer-mermaid-${mermaidSeq++}`, code.textContent ?? "");
      holder.innerHTML = svg;
    } catch {
      // A malformed diagram keeps its source block rather than failing the
      // whole document.
      continue;
    }
    const rendered = holder.querySelector("svg");
    if (rendered !== null) normalizeDiagramSvg(rendered);
    pre.replaceWith(holder);
  }
}
