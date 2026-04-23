"use client";

import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const onMutate = () => router.refresh();
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
          folders={tree.folders}
          items={tree.papers}
          libraryId={library.id}
          onMutate={onMutate}
        />
        <SidebarSection
          kind="references"
          label="References"
          folders={tree.folders}
          items={tree.references}
          libraryId={library.id}
          onMutate={onMutate}
        />
        <SidebarSection
          kind="notes"
          label="Notes"
          folders={tree.folders}
          items={tree.notes}
          libraryId={library.id}
          onMutate={onMutate}
        />
        <SidebarSection kind="agent" />
      </SidebarContent>
    </ShadcnSidebar>
  );
}
