"use client";

import Link from "next/link";

type Breadcrumb = {
  label: string;
  href?: string;
};

type TopBarProps = {
  breadcrumbs: Breadcrumb[];
  isConnected: boolean;
  children?: React.ReactNode;
};

export function TopBar({ breadcrumbs, isConnected, children }: TopBarProps) {
  return (
    <div className="mb-6">
      {/* Line 1: Breadcrumb + Global Status */}
      <div className="flex items-center justify-between py-2">
        <nav className="flex items-center gap-1.5 text-sm">
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && (
                <span className="text-text-secondary">›</span>
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

      {/* Line 2: Contextual Action Bar */}
      {children && (
        <div className="flex items-center justify-between py-2">
          {children}
        </div>
      )}
    </div>
  );
}
