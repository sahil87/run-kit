import { describe, expect, it } from "vitest";
import {
  DIAGRAM_NATURAL_CLASS,
  createDiagramHolder,
  normalizeDiagramSvg,
  toggleDiagramSize,
} from "./markdown";

function svgWithViewBox(viewBox: string | null): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  if (viewBox !== null) svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("width", "100%");
  svg.style.maxWidth = "723.5px";
  return svg;
}

describe("normalizeDiagramSvg", () => {
  it("replaces mermaid's 100% width + inline max-width with viewBox pixel dimensions", () => {
    const svg = svgWithViewBox("0 0 723.5 340");
    normalizeDiagramSvg(svg);
    expect(svg.getAttribute("width")).toBe("723.5");
    expect(svg.getAttribute("height")).toBe("340");
    expect(svg.style.maxWidth).toBe("");
  });

  it("accepts comma-separated viewBox values", () => {
    const svg = svgWithViewBox("0,0,120,80");
    normalizeDiagramSvg(svg);
    expect(svg.getAttribute("width")).toBe("120");
    expect(svg.getAttribute("height")).toBe("80");
  });

  it("leaves an SVG without a usable viewBox untouched", () => {
    for (const viewBox of [null, "0 0", "0 0 abc 10", "0 0 0 10"]) {
      const svg = svgWithViewBox(viewBox);
      normalizeDiagramSvg(svg);
      expect(svg.getAttribute("width")).toBe("100%");
      expect(svg.style.maxWidth).toBe("723.5px");
    }
  });
});

describe("diagram holder", () => {
  it("starts fitted and toggles to natural size on click, then back", () => {
    const holder = createDiagramHolder();
    expect(holder.classList.contains(DIAGRAM_NATURAL_CLASS)).toBe(false);
    expect(holder.getAttribute("role")).toBe("button");
    expect(holder.getAttribute("aria-pressed")).toBe("false");
    expect(holder.tabIndex).toBe(0);

    holder.click();
    expect(holder.classList.contains(DIAGRAM_NATURAL_CLASS)).toBe(true);
    expect(holder.getAttribute("aria-pressed")).toBe("true");

    holder.click();
    expect(holder.classList.contains(DIAGRAM_NATURAL_CLASS)).toBe(false);
    expect(holder.getAttribute("aria-pressed")).toBe("false");
  });

  it("toggles from the keyboard with Enter and Space and swallows the default", () => {
    const holder = createDiagramHolder();
    const enter = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    holder.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(holder.classList.contains(DIAGRAM_NATURAL_CLASS)).toBe(true);

    holder.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    expect(holder.classList.contains(DIAGRAM_NATURAL_CLASS)).toBe(false);

    holder.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(holder.classList.contains(DIAGRAM_NATURAL_CLASS)).toBe(false);
  });

  it("leaves a click on a link inside the diagram to the link", () => {
    const holder = createDiagramHolder();
    holder.innerHTML = '<svg viewBox="0 0 10 10"><a href="#x"><text>node</text></a></svg>';
    const text = holder.querySelector("text");
    text?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(holder.classList.contains(DIAGRAM_NATURAL_CLASS)).toBe(false);
  });

  it("toggleDiagramSize swaps the tooltip with the mode", () => {
    const holder = createDiagramHolder();
    const fitTitle = holder.title;
    toggleDiagramSize(holder);
    expect(holder.title).not.toBe(fitTitle);
    toggleDiagramSize(holder);
    expect(holder.title).toBe(fitTitle);
  });
});
