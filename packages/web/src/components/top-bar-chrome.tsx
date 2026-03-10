import { useChrome } from "@/contexts/chrome-context";
import { BreadcrumbDropdown } from "@/components/breadcrumb-dropdown";

export function TopBarChrome() {
  const { breadcrumbs, line2Left, line2Right, isConnected } = useChrome();

  return (
    <header>
      {/* Line 1: Breadcrumbs + Status */}
      <div className="flex items-center justify-between py-2">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
          <a
            href="/"
            className="hover:opacity-80 transition-opacity"
            aria-label="RunKit home"
          >
            <img src="/logo.svg" alt="RunKit" width={20} height={20} />
          </a>
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <span className="text-text-secondary" aria-hidden="true">›</span>
              {crumb.dropdownItems && crumb.dropdownItems.length > 0 ? (
                <BreadcrumbDropdown items={crumb.dropdownItems} label={crumb.label} icon={crumb.icon} />
              ) : crumb.icon ? (
                <span className="text-text-secondary" aria-hidden="true">{crumb.icon}</span>
              ) : null}
              {crumb.href ? (
                <a
                  href={crumb.href}
                  className="text-text-secondary hover:text-text-primary"
                >
                  {crumb.label}
                </a>
              ) : (
                <span className="text-text-primary font-medium" aria-current="page">
                  {crumb.label}
                </span>
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
          <kbd className="hidden sm:inline-flex px-1.5 py-0.5 rounded border border-border text-text-secondary">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Line 2: Always rendered, fixed height */}
      <div className="flex items-center justify-between py-2 min-h-[36px]">
        <div className="hidden sm:block">{line2Left}</div>
        <div>{line2Right}</div>
        <button
          type="button"
          onClick={() => document.dispatchEvent(new CustomEvent("palette:open"))}
          aria-label="Open command palette"
          className="sm:hidden text-text-secondary hover:text-text-primary transition-colors min-w-[36px] min-h-[36px] coarse:min-h-[44px] coarse:min-w-[44px] flex items-center justify-center border border-border rounded"
        >
          ⋯
        </button>
      </div>
    </header>
  );
}
