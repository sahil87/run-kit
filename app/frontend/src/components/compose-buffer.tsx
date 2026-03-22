import { useRef, useCallback, useEffect, useState, useId } from "react";
import type { UploadedFile } from "@/hooks/use-file-upload";

type ComposeBufferProps = {
  wsRef: React.RefObject<WebSocket | null>;
  onClose: () => void;
  initialText?: string;
  uploadedFiles?: UploadedFile[];
  onUploadFiles?: (files: FileList) => void;
  onRemoveFile?: (index: number) => void;
};

export function ComposeBuffer({
  wsRef,
  onClose,
  initialText,
  uploadedFiles,
  onUploadFiles,
  onRemoveFile,
}: ComposeBufferProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastInitialTextRef = useRef<string | undefined>(undefined);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const blobUrlsRef = useRef<Map<File, string>>(new Map());
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  // Stable ref for onClose so keydown handler always calls the latest
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Set textarea value imperatively — no defaultValue
  useEffect(() => {
    if (!textareaRef.current) return;
    if (initialText && initialText !== lastInitialTextRef.current) {
      const ta = textareaRef.current;
      if (lastInitialTextRef.current === undefined) {
        // First mount — set value directly
        ta.value = initialText;
      } else {
        // Additional upload — append only new text
        const current = ta.value;
        const separator = current && !current.endsWith("\n") ? "\n" : "";
        ta.value = current + separator + initialText;
      }
    }
    lastInitialTextRef.current = initialText;
  }, [initialText]);

  // Focus trap + Escape handler (matches dialog.tsx)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (expandedIndex !== null) {
          setExpandedIndex(null);
        } else {
          onCloseRef.current();
        }
        return;
      }
      const dialog = dialogRef.current;
      if (!dialog || e.key !== "Tab") return;
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [expandedIndex]);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Get or create blob URL for a file
  function getBlobUrl(file: File): string {
    const existing = blobUrlsRef.current.get(file);
    if (existing) return existing;
    const url = URL.createObjectURL(file);
    blobUrlsRef.current.set(file, url);
    return url;
  }

  // Revoke all blob URLs on unmount (dialog close)
  useEffect(() => {
    const urlsRef = blobUrlsRef;
    return () => {
      for (const url of urlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }
      urlsRef.current.clear();
    };
  }, []);

  const send = useCallback(() => {
    const text = textareaRef.current?.value;
    if (text && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(text);
    }
    onClose();
  }, [wsRef, onClose]);

  const handleRemoveFile = useCallback(
    (index: number) => {
      if (!uploadedFiles || !onRemoveFile) return;
      const file = uploadedFiles[index];
      // Remove path from textarea
      if (textareaRef.current && file) {
        const lines = textareaRef.current.value.split("\n");
        const pathIndex = lines.indexOf(file.path);
        if (pathIndex !== -1) {
          lines.splice(pathIndex, 1);
          textareaRef.current.value = lines.join("\n");
        }
      }
      // Revoke blob URL
      if (file) {
        const url = blobUrlsRef.current.get(file.file);
        if (url) {
          URL.revokeObjectURL(url);
          blobUrlsRef.current.delete(file.file);
        }
      }
      if (expandedIndex === index) setExpandedIndex(null);
      else if (expandedIndex !== null && expandedIndex > index) setExpandedIndex(expandedIndex - 1);
      onRemoveFile(index);
    },
    [uploadedFiles, onRemoveFile, expandedIndex],
  );

  const hasPreviewItems = (uploadedFiles?.length ?? 0) > 0;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-[500px] mx-4 bg-bg-primary border border-border rounded-lg p-2 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-xs font-medium mb-2.5">Text Input</h2>

        {/* Image preview strip */}
        {hasPreviewItems && (
          <div className="flex gap-1.5 mb-2 overflow-x-auto">
            {uploadedFiles!.map((uf, i) => {
              const isImage = uf.file.type.startsWith("image/");
              return (
                <div key={`${uf.path}-${i}`} className="relative shrink-0 group">
                  {isImage ? (
                    <button
                      type="button"
                      onClick={() => setExpandedIndex(expandedIndex === i ? null : i)}
                      className="block rounded border border-border overflow-hidden hover:border-text-secondary transition-colors"
                    >
                      <img
                        src={getBlobUrl(uf.file)}
                        alt={uf.file.name}
                        className="h-[60px] w-auto object-cover"
                      />
                    </button>
                  ) : (
                    <div className="h-[60px] px-2 flex items-center rounded border border-border bg-bg-card">
                      <span className="text-[10px] text-text-secondary max-w-[80px] truncate">
                        {uf.file.name}
                      </span>
                    </div>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${uf.file.name}`}
                    onClick={() => handleRemoveFile(i)}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-bg-primary border border-border text-text-secondary text-[10px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 hover:text-red-500 hover:border-red-500 transition-all"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Expanded preview */}
        {expandedIndex !== null && uploadedFiles && uploadedFiles[expandedIndex] && (
          <div className="mb-2">
            <button
              type="button"
              onClick={() => setExpandedIndex(null)}
              className="w-full rounded border border-border overflow-hidden hover:border-text-secondary transition-colors"
            >
              <img
                src={getBlobUrl(uploadedFiles[expandedIndex].file)}
                alt={uploadedFiles[expandedIndex].file.name}
                className="w-full h-auto max-h-[300px] object-contain bg-bg-card"
              />
            </button>
          </div>
        )}

        <textarea
          ref={textareaRef}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-label="Compose text to send to terminal"
          placeholder="Compose text..."
          className="w-full bg-bg-card text-text-primary text-xs px-2 py-1.5 rounded border border-border outline-none resize-y min-h-[60px] max-h-[300px] placeholder:text-text-secondary focus:border-text-secondary"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="flex justify-end mt-1 gap-1.5">
          {onUploadFiles && (
            <>
              <input
                ref={uploadInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    onUploadFiles(e.target.files);
                    e.target.value = "";
                  }
                }}
              />
              <button
                type="button"
                aria-label="Upload file"
                onClick={() => uploadInputRef.current?.click()}
                className="text-xs px-2 py-1 border border-border text-text-secondary rounded hover:border-text-secondary transition-colors"
              >
                <span aria-hidden="true">{"\uD83D\uDCCE"}</span>
              </button>
            </>
          )}
          <button
            type="button"
            onClick={send}
            className="text-xs px-3 py-1 bg-accent/20 border border-accent text-accent rounded hover:bg-accent/30 transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
