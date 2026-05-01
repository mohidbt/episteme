"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
} from "@/components/ui/sidebar";
import { useSidebarCollapsed } from "./SidebarShell";

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
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>{children}</SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  return (
    <SidebarGroup>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="sidebar-section-toggle group/section flex w-full items-center gap-2
          px-[10px] py-[5px] text-[13px] font-semibold text-[var(--fg)]
          hover:bg-[var(--bg-roof-2)] rounded-[6px] transition-colors"
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
        <SidebarGroupContent>
          <SidebarMenu>{children}</SidebarMenu>
        </SidebarGroupContent>
      )}
    </SidebarGroup>
  );
}