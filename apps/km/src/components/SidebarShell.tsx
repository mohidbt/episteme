"use client";

import Link from "next/link";
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
    <ShadcnSidebar
      collapsible="none"
      className="border-r border-foreground rounded-r-xl overflow-hidden"
    >
      <SidebarHeader className="px-4 pt-5 pb-3">
        <Link
          href="/"
          className="text-[15px] font-medium leading-none tracking-tight text-sidebar-foreground hover:underline"
          data-testid="km-sidebar-library-name"
        >
          {library.name}
        </Link>
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
