/** Copy text to clipboard — tries Clipboard API first, falls back to execCommand for non-secure contexts (HTTP). */
export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return;
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
    document.execCommand("copy");
  } catch {
    // Both mechanisms failed — silently ignore
  } finally {
    document.body.removeChild(textarea);
    previousActiveElement?.focus();
  }
}
