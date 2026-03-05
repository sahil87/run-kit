"use client";

import { useRef, useCallback } from "react";

type ComposeBufferProps = {
  wsRef: React.RefObject<WebSocket | null>;
  onClose: () => void;
};

export function ComposeBuffer({ wsRef, onClose }: ComposeBufferProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
        placeholder="Compose text..."
        className="w-full bg-bg-card text-text-primary text-sm p-3 rounded border border-border outline-none resize-y min-h-[80px] max-h-[200px] placeholder:text-text-secondary focus:border-text-secondary"
        onKeyDown={handleKeyDown}
      />
      <div className="flex justify-end mt-2">
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
