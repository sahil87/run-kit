import { useState, useEffect } from "react";
import { Dialog } from "@/components/dialog";
import { getKeybindings, type Keybinding } from "@/api/client";
import { useSessionContext } from "@/contexts/session-context";

type KeyboardShortcutsProps = {
  onClose: () => void;
};

/** Format a tmux key name for display (e.g., "S-F3" → "Shift+F3"). */
function formatKey(key: string): string {
  return key.replace(/^S-/, "Shift+").replace(/^C-/, "Ctrl+");
}

type GroupedBinding = {
  label: string;
  keys: string[];
};

/** Group bindings by label, merge keys, sort alphabetically. */
function groupBindings(
  bindings: Keybinding[],
  table: string,
  prefix?: string,
): GroupedBinding[] {
  const map = new Map<string, string[]>();

  for (const b of bindings) {
    if (b.table !== table) continue;
    const display = prefix
      ? `${prefix}${formatKey(b.key)}`
      : formatKey(b.key);
    const existing = map.get(b.label);
    if (existing) {
      if (!existing.includes(display)) existing.push(display);
    } else {
      map.set(b.label, [display]);
    }
  }

  return Array.from(map, ([label, keys]) => ({ label, keys: keys.sort() })).sort(
    (a, b) => a.label.localeCompare(b.label),
  );
}

function ShortcutRow({ label, keys }: GroupedBinding) {
  return (
    <div className="flex items-center justify-between py-1 gap-3">
      <span className="text-text-primary">{label}</span>
      <span className="flex flex-wrap gap-1 shrink-0">
        {keys.map((k) => (
          <kbd
            key={k}
            className="text-xs text-text-secondary bg-bg-card px-1.5 py-0.5 rounded border border-border"
          >
            {k}
          </kbd>
        ))}
      </span>
    </div>
  );
}

export function KeyboardShortcuts({ onClose }: KeyboardShortcutsProps) {
  const [bindings, setBindings] = useState<Keybinding[] | null>(null);
  const { server } = useSessionContext();

  useEffect(() => {
    getKeybindings(server)
      .then(setBindings)
      .catch(() => setBindings([]));
  }, [server]);

  const rootBindings = bindings ? groupBindings(bindings, "root") : [];
  const prefixBindings = bindings
    ? groupBindings(bindings, "prefix", "Ctrl+S, ")
    : [];

  return (
    <Dialog title="Keyboard Shortcuts" onClose={onClose}>
      <div className="space-y-3 max-h-[60vh] overflow-y-auto">
        {/* App shortcuts */}
        <div>
          <h3 className="text-xs text-text-secondary font-medium mb-1">App</h3>
          <div className="space-y-1">
            <ShortcutRow label="Command palette" keys={["⌘K"]} />
          </div>
        </div>

        {/* tmux shortcuts */}
        {bindings === null ? (
          <div className="text-xs text-text-secondary py-2">Loading...</div>
        ) : bindings.length === 0 ? (
          <div className="text-xs text-text-secondary py-2">
            No tmux server running
          </div>
        ) : (
          <>
            {rootBindings.length > 0 && (
              <div>
                <h3 className="text-xs text-text-secondary font-medium mb-1">
                  tmux
                </h3>
                <div className="space-y-1">
                  {rootBindings.map((b) => (
                    <ShortcutRow key={b.label} {...b} />
                  ))}
                </div>
              </div>
            )}

            {prefixBindings.length > 0 && (
              <div>
                <h3 className="text-xs text-text-secondary font-medium mb-1">
                  tmux (prefix)
                </h3>
                <div className="space-y-1">
                  {prefixBindings.map((b) => (
                    <ShortcutRow key={b.label} {...b} />
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
          className="text-text-secondary hover:text-text-primary px-3 py-1.5 rounded border border-border"
        >
          Close
        </button>
      </div>
    </Dialog>
  );
}
