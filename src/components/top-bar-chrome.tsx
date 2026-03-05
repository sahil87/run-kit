"use client";

import Link from "next/link";
import { useChrome } from "@/contexts/chrome-context";

export function TopBarChrome() {
  const { breadcrumbs, line2Left, line2Right, isConnected } = useChrome();

  return (
    <div>
      {/* Line 1: Breadcrumbs + Status */}
      <div className="flex items-center justify-between py-2">
        <nav className="flex items-center gap-1.5 text-sm">
          <Link
            href="/"
            className="font-bold text-text-primary hover:text-accent transition-colors"
          >
            RK
          </Link>
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <span className="text-text-secondary">›</span>
              {crumb.icon && (
                <span className="text-text-secondary">{crumb.icon}</span>
              )}
              {crumb.href ? (
                <Link
                  href={crumb.href}
                  className="text-text-secondary hover:text-text-primary"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span className="text-text-primary font-medium">
                  {crumb.label}
                </span>
              )}
            </span>
          ))}
        </nav>
        <div className="flex items-center gap-3 text-xs text-text-secondary">
          <span
            className={`w-2 h-2 rounded-full ${
              isConnected ? "bg-accent-green" : "bg-text-secondary"
            }`}
          />
          <span>{isConnected ? "live" : "disconnected"}</span>
          <kbd className="px-1.5 py-0.5 rounded border border-border text-text-secondary">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Line 2: Always rendered, fixed height */}
      <div className="flex items-center justify-between py-2 min-h-[36px]">
        <div>{line2Left}</div>
        <div>{line2Right}</div>
      </div>
    </div>
  );
}
