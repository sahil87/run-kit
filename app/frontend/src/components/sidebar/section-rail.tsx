import type { ComponentType } from "react";
import { Tip } from "@/components/tip";
import { controlClass } from "@/components/control";
import { useIsMobile } from "@/hooks/use-is-mobile";
import {
  SIDEBAR_SECTIONS,
  useSidebarSectionVisible,
  type SidebarSection,
} from "@/hooks/use-sidebar-sections";
import {
  BoardsSectionIcon,
  ClockSectionIcon,
  HostSectionIcon,
  PaneSectionIcon,
  ServerSectionIcon,
} from "./icons";

const SECTION_ICONS: Record<SidebarSection, ComponentType<{ size?: number }>> = {
  boards: BoardsSectionIcon,
  server: ServerSectionIcon,
  pane: PaneSectionIcon,
  host: HostSectionIcon,
  clock: ClockSectionIcon,
};

/**
 * Section-visibility micro-rail — a horizontal row of icon-only toggle
 * buttons (Boards · Server · Pane · Host · Clock) rendered as the FIRST child
 * of the sidebar's `<nav>`. Toggling flips the section's persisted visibility
 * boolean; the rail itself always renders (not self-hideable). Sessions has
 * no toggle — the session tree is the always-on core nav surface.
 * `desktopOnly` entries (Clock) render no button on mobile viewports at all.
 */
export function SectionRail() {
  return (
    <div
      role="group"
      aria-label="Sidebar sections"
      data-testid="section-rail"
      className="flex items-center gap-1 px-2 py-1 shrink-0"
    >
      {SIDEBAR_SECTIONS.map((entry) => (
        <SectionRailButton key={entry.section} entry={entry} />
      ))}
    </div>
  );
}

function SectionRailButton({ entry }: { entry: (typeof SIDEBAR_SECTIONS)[number] }) {
  const [visible, setVisible] = useSidebarSectionVisible(entry.section);
  const isMobile = useIsMobile();
  const Icon = SECTION_ICONS[entry.section];
  // Desktop-only sections have no mobile surface here (the panel mount is
  // gated in the sidebar too) — the toggle would flip an invisible section.
  if (entry.desktopOnly && isMobile) return null;
  return (
    // Tier-1 Tip (fine pointers only — suppressed on coarse): the label names
    // what a CLICK does (state-flipping, the scope-chip pattern), so no
    // native `title` (never both); the aria-label stays state-stable.
    <Tip label={visible ? `Hide ${entry.label} section` : `Show ${entry.label} section`} placement="right">
      <button
        type="button"
        onClick={() => setVisible(!visible)}
        aria-label={`Toggle ${entry.label} section`}
        aria-pressed={visible}
        className={controlClass({
          variant: "toggle",
          base: "flex items-center justify-center rounded-sm px-0.5 min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] transition-colors",
          rest: "text-text-secondary hover:text-text-primary",
          ringed: true,
          pressed: visible,
        })}
      >
        <Icon />
      </button>
    </Tip>
  );
}
