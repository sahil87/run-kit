import MarkdownIt from "markdown-it";

// Raw HTML passes through (html: true): sanitization is deliberately not the
// trust boundary here — /present already serves same-origin-scripting .html
// files, so an author's embedded markup is no new exposure.
const md = new MarkdownIt({ html: true, linkify: true });

let mermaidSeq = 0;

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
    const holder = document.createElement("div");
    holder.className = "viewer-diagram";
    try {
      const { svg } = await mermaid.render(`viewer-mermaid-${mermaidSeq++}`, code.textContent ?? "");
      holder.innerHTML = svg;
    } catch {
      // A malformed diagram keeps its source block rather than failing the
      // whole document.
      continue;
    }
    pre.replaceWith(holder);
  }
}
