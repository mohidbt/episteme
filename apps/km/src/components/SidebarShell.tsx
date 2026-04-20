"use client";

import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { SidebarSection } from "./SidebarSection";
import type { TreeResponse } from "@/lib/tree-server";

interface SidebarShellProps {
  library: { id: number; name: string };
  tree: TreeResponse;
}

export function SidebarShell({ library, tree }: SidebarShellProps) {
  return (
    <ShadcnSidebar collapsible="none" className="border-r">
      <SidebarHeader className="px-4 pt-5 pb-3">
        <h1
          className="font-display text-[20px] leading-none tracking-tight text-sidebar-foreground"
          data-testid="km-sidebar-library-name"
        >
          {library.name}
        </h1>
      </SidebarHeader>
      <SidebarContent>
        <SidebarSection
          kind="papers"
          label="Papers"
          items={tree.sections.papers.items}
        />
        <SidebarSection
          kind="references"
          label="References"
          items={tree.sections.references.items}
        />
        <SidebarSection
          kind="notes"
          label="Notes"
          items={tree.sections.notes.items}
        />
        <SidebarSection kind="agent" />
      </SidebarContent>
    </ShadcnSidebar>
  );
}
