import { useState, useEffect } from "react";

const FRAMES = ["✻", "✽", "✶", "✳", "✢", "✦", "✧", "✷", "✸", "✹"];
const INTERVAL_MS = 250;

export function StarTwinkle({ className }: { className?: string }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <span
      className={className}
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: "1ch",
        textAlign: "center",
        fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      }}
    >
      {FRAMES[frame]}
    </span>
  );
}
