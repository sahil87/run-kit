"use client";

import Image from "next/image";
import Link from "next/link";
import { useChrome } from "@/contexts/chrome-context";
import { BreadcrumbDropdown } from "@/components/breadcrumb-dropdown";

export function TopBarChrome() {
  const { breadcrumbs, line2Left, line2Right, isConnected } = useChrome();

  return (
    <header>
      {/* Line 1: Breadcrumbs + Status */}
      <div className="flex items-center justify-between py-2">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
          <Link
            href="/"
            className="hover:opacity-80 transition-opacity"
            aria-label="RunKit home"
          >
            <Image src="/logo.svg" alt="RunKit" width={20} height={20} />
          </Link>
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <span className="text-text-secondary" aria-hidden="true">›</span>
              {crumb.icon && (
                <span className="text-text-secondary" aria-hidden="true">{crumb.icon}</span>
              )}
              {crumb.href ? (
                <Link
                  href={crumb.href}
                  className="text-text-secondary hover:text-text-primary"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span className="text-text-primary font-medium" aria-current="page">
                  {crumb.label}
                </span>
              )}
              {crumb.dropdownItems && crumb.dropdownItems.length > 0 && (
                <BreadcrumbDropdown items={crumb.dropdownItems} label={crumb.label} />
              )}
            </span>
          ))}
        </nav>
        <div className="flex items-center gap-3 text-xs text-text-secondary" role="status" aria-live="polite">
          <span
            className={`w-2 h-2 rounded-full ${
              isConnected ? "bg-accent-green" : "bg-text-secondary"
            }`}
            aria-hidden="true"
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
    </header>
  );
}
