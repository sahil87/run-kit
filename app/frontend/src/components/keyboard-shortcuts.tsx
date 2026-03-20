import { useState, useEffect } from "react";
import { Dialog } from "@/components/dialog";
import { getKeybindings, type Keybinding } from "@/api/client";

type KeyboardShortcutsProps = {
  onClose: () => void;
};

/** Format a tmux key name for display (e.g., "S-F3" → "Shift+F3"). */
function formatKey(key: string, table: string): string {
  let display = key
    .replace(/^S-/, "Shift+")
    .replace(/^C-/, "Ctrl+");

  if (table === "prefix") {
    return `Ctrl+B, ${display}`;
  }
  return display;
}

export function KeyboardShortcuts({ onClose }: KeyboardShortcutsProps) {
  const [bindings, setBindings] = useState<Keybinding[] | null>(null);

  useEffect(() => {
    getKeybindings()
      .then(setBindings)
      .catch(() => setBindings([]));
  }, []);

  const appBindings = [
    { key: "⌘K", label: "Command palette" },
  ];

  return (
    <Dialog title="Keyboard Shortcuts" onClose={onClose}>
      <div className="space-y-3 max-h-[60vh] overflow-y-auto">
        {/* App shortcuts */}
        <div>
          <h3 className="text-xs text-text-secondary font-medium mb-1">App</h3>
          <div className="space-y-1">
            {appBindings.map((b) => (
              <div key={b.key} className="flex items-center justify-between py-1">
                <span className="text-sm text-text-primary">{b.label}</span>
                <kbd className="text-xs text-text-secondary bg-bg-card px-1.5 py-0.5 rounded border border-border">
                  {b.key}
                </kbd>
              </div>
            ))}
          </div>
        </div>

        {/* tmux shortcuts */}
        {bindings === null ? (
          <div className="text-xs text-text-secondary py-2">Loading...</div>
        ) : bindings.length === 0 ? (
          <div className="text-xs text-text-secondary py-2">No tmux server running</div>
        ) : (
          <>
            {/* Root bindings (no prefix needed) */}
            {bindings.some((b) => b.table === "root") && (
              <div>
                <h3 className="text-xs text-text-secondary font-medium mb-1">tmux</h3>
                <div className="space-y-1">
                  {bindings
                    .filter((b) => b.table === "root")
                    .map((b) => (
                      <div key={`${b.table}-${b.key}`} className="flex items-center justify-between py-1">
                        <span className="text-sm text-text-primary">{b.label}</span>
                        <kbd className="text-xs text-text-secondary bg-bg-card px-1.5 py-0.5 rounded border border-border">
                          {formatKey(b.key, b.table)}
                        </kbd>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Prefix bindings */}
            {bindings.some((b) => b.table === "prefix") && (
              <div>
                <h3 className="text-xs text-text-secondary font-medium mb-1">tmux (prefix)</h3>
                <div className="space-y-1">
                  {bindings
                    .filter((b) => b.table === "prefix")
                    .map((b) => (
                      <div key={`${b.table}-${b.key}`} className="flex items-center justify-between py-1">
                        <span className="text-sm text-text-primary">{b.label}</span>
                        <kbd className="text-xs text-text-secondary bg-bg-card px-1.5 py-0.5 rounded border border-border">
                          {formatKey(b.key, b.table)}
                        </kbd>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-3 flex justify-end">
        <button
          onClick={onClose}
          className="text-sm text-text-secondary hover:text-text-primary px-3 py-1.5"
        >
          Close
        </button>
      </div>
    </Dialog>
  );
}
