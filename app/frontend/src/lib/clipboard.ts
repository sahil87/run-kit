/**
 * Copy text to clipboard — tries Clipboard API first, falls back to execCommand
 * for non-secure contexts (HTTP). Resolves to `true` on a successful copy (via
 * either mechanism) and `false` when both fail. The boolean is a
 * backwards-compatible addition — existing callers that ignore the return value
 * (`void copyToClipboard(...)`) are unaffected; new callers (e.g. the palette
 * version entry) use it to toast confirmation vs. error.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Clipboard API failed (likely non-secure context) — fall through to fallback
    }
  }
  const previousActiveElement = document.activeElement as HTMLElement | null;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  try {
    textarea.select();
    return document.execCommand("copy");
  } catch {
    // Both mechanisms failed — report failure so the caller can surface an error
    return false;
  } finally {
    document.body.removeChild(textarea);
    previousActiveElement?.focus();
  }
}
