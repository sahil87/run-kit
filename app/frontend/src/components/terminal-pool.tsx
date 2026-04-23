import { useRef, useState } from "react";
import { TerminalClient } from "./terminal-client";

const MAX_WARM = 8;

type PoolEntry = {
  sessionName: string;
  server: string;
};

type TerminalPoolProps = {
  sessionName: string;
  windowIndex: string;
  server: string;
  wsRef: React.MutableRefObject<WebSocket | null>;
  composeOpen: boolean;
  setComposeOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  onSessionNotFound?: () => void;
  focusRef?: React.MutableRefObject<(() => void) | null>;
  scrollLocked?: boolean;
};

export function TerminalPool({
  sessionName,
  windowIndex,
  server,
  wsRef,
  composeOpen,
  setComposeOpen,
  onSessionNotFound,
  focusRef,
  scrollLocked,
}: TerminalPoolProps) {
  const activeKey = `${server}\0${sessionName}`;
  const [pool, setPool] = useState(() => new Map<string, PoolEntry>());
  const lastAccessRef = useRef(new Map<string, number>());
  const windowIndexCache = useRef(new Map<string, string>());

  lastAccessRef.current.set(activeKey, Date.now());
  windowIndexCache.current.set(activeKey, windowIndex);

  if (!pool.has(activeKey)) {
    setPool((prev) => {
      const next = new Map(prev);
      next.set(activeKey, { sessionName, server });

      if (next.size > MAX_WARM) {
        let oldestKey = "";
        let oldestTime = Infinity;
        for (const key of next.keys()) {
          if (key === activeKey) continue;
          const t = lastAccessRef.current.get(key) ?? 0;
          if (t < oldestTime) {
            oldestTime = t;
            oldestKey = key;
          }
        }
        if (oldestKey) {
          next.delete(oldestKey);
          lastAccessRef.current.delete(oldestKey);
          windowIndexCache.current.delete(oldestKey);
        }
      }

      return next;
    });
  }

  return (
    <>
      {Array.from(pool.entries()).map(([key, entry]) => {
        const isActive = key === activeKey;
        return (
          <div
            key={key}
            className={isActive ? "flex-1 min-h-0 flex flex-col" : "hidden"}
          >
            <TerminalClient
              sessionName={entry.sessionName}
              windowIndex={isActive ? windowIndex : (windowIndexCache.current.get(key) ?? "0")}
              server={entry.server}
              active={isActive}
              wsRef={wsRef}
              composeOpen={composeOpen}
              setComposeOpen={setComposeOpen}
              onSessionNotFound={isActive ? onSessionNotFound : undefined}
              focusRef={focusRef}
              scrollLocked={isActive ? scrollLocked : false}
            />
          </div>
        );
      })}
    </>
  );
}
