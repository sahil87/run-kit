import { useState, useEffect } from "react";

const FRAMES = ["░", "▒", "▓", "█", "▓", "▒"];
const INTERVAL_MS = 150;

export function BlockPulse({ className }: { className?: string }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <span className={className} aria-hidden="true">
      {FRAMES[frame]}
    </span>
  );
}
