import { useRef, useCallback, useEffect } from "react";

type ComposeBufferProps = {
  wsRef: React.RefObject<WebSocket | null>;
  onClose: () => void;
  initialText?: string;
  onUploadFiles?: (files: FileList) => void;
};

export function ComposeBuffer({ wsRef, onClose, initialText, onUploadFiles }: ComposeBufferProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastInitialTextRef = useRef(initialText);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialText && initialText !== lastInitialTextRef.current && textareaRef.current) {
      const ta = textareaRef.current;
      const current = ta.value;
      const separator = current && !current.endsWith("\n") ? "\n" : "";
      ta.value = current + separator + initialText;
    }
    lastInitialTextRef.current = initialText;
  }, [initialText]);

  const send = useCallback(() => {
    const text = textareaRef.current?.value;
    if (text && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(text);
    }
    onClose();
  }, [wsRef, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        send();
      }
    },
    [onClose, send],
  );

  return (
    <div className="shrink-0 border-t border-border bg-bg-primary p-3">
      <textarea
        ref={textareaRef}
        autoFocus
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label="Compose text to send to terminal"
        defaultValue={initialText}
        placeholder="Compose text..."
        className="w-full bg-bg-card text-text-primary text-sm p-3 rounded border border-border outline-none resize-y min-h-[80px] max-h-[200px] placeholder:text-text-secondary focus:border-text-secondary"
        onKeyDown={handleKeyDown}
      />
      <div className="flex justify-end mt-2 gap-2">
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
              aria-label="Upload file"
              onClick={() => uploadInputRef.current?.click()}
              className="text-sm px-3 py-1.5 border border-border text-text-secondary rounded hover:border-text-secondary transition-colors"
            >
              <span aria-hidden="true">{"\uD83D\uDCCE"}</span>
            </button>
          </>
        )}
        <button
          onClick={send}
          className="text-sm px-4 py-1.5 bg-accent/20 border border-accent text-accent rounded hover:bg-accent/30 transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  );
}
