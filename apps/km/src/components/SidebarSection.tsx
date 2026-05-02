"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useSidebarCollapsed } from "./SidebarShell";
import {
  sidebarSectionContentClassName,
  sidebarSectionGroupClassName,
  sidebarSectionToggleClassName,
} from "./SidebarChrome";

interface SidebarSectionProps {
  label: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function SidebarSection({
  label,
  icon,
  defaultOpen = true,
  children,
}: SidebarSectionProps) {
  const collapsed = useSidebarCollapsed();
  const [open, setOpen] = useState(defaultOpen);

  if (collapsed) {
    // Collapsed: just show the child items (icon-only mode via CSS)
    return (
      <SidebarGroup className={sidebarSectionGroupClassName}>
        <SidebarGroupContent>
          <SidebarMenu>{children}</SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  return (
    <SidebarGroup className={sidebarSectionGroupClassName}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={sidebarSectionToggleClassName}
      >
        {icon}
        <span className="truncate flex-1 text-left">{label}</span>
        <ChevronRight
          className={`section-chevron size-3.5 text-[var(--fg-muted)] transition-transform ${
            open ? "rotate-90" : ""
          }`}
          aria-hidden
        />
      </button>
      {open && (
        <SidebarGroupContent className={cn(sidebarSectionContentClassName)}>
          <SidebarMenu>{children}</SidebarMenu>
        </SidebarGroupContent>
      )}
    </SidebarGroup>
  );
}
