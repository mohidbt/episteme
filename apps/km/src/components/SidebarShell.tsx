"use client";

import { useRouter } from "next/navigation";
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { DriveTree } from "./DriveTree";
import { ByTypeNav } from "./ByTypeNav";
import { SidebarAgentSection } from "./SidebarAgentSection";
import { SidebarSettingsSection } from "./SidebarSettingsSection";
import type { TreeResponse } from "@/lib/tree-server";

interface SidebarShellProps {
  library: { id: number; name: string };
  tree: TreeResponse;
}

export function SidebarShell({ library, tree }: SidebarShellProps) {
  const router = useRouter();
  const onMutate = () => router.refresh();
  const trashFolder = tree.folders.find((f) => f.isTrash) ?? null;
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
        <DriveTree
          libraryId={library.id}
          folders={tree.folders}
          papers={tree.papers}
          references={tree.references}
          notes={tree.notes}
          trashId={trashFolder?.id ?? null}
          onMutate={onMutate}
        />
        <ByTypeNav />
        <SidebarAgentSection />
        <SidebarSettingsSection />
      </SidebarContent>
    </ShadcnSidebar>
  );
}
