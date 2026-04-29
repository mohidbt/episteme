"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { DriveTree } from "./DriveTree";
import { ByTypeNav } from "./ByTypeNav";
import { SidebarAgentSection } from "./SidebarAgentSection";
import { SidebarSettingsSection } from "./SidebarSettingsSection";
import type { TreeResponse } from "@/lib/tree-server";

interface SidebarShellProps {
  library: { id: number; name: string };
  tree: TreeResponse;
  isAnonymous: boolean;
}

export function SidebarShell({ library, tree, isAnonymous }: SidebarShellProps) {
  const router = useRouter();
  const onMutate = () => router.refresh();
  const trashFolder = tree.folders.find((f) => f.isTrash) ?? null;
  return (
    <ShadcnSidebar
      collapsible="none"
      className="border border-foreground rounded-r-xl overflow-hidden shadow-[4px_4px_20px_rgba(0,0,0,0.08)]"
    >
      <SidebarHeader className="px-4 pt-5 pb-3">
        <Link
          href="/"
          className="font-display text-[20px] leading-none tracking-tight text-sidebar-foreground hover:underline"
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
          papersets={tree.papersets}
          trashId={trashFolder?.id ?? null}
          onMutate={onMutate}
        />
        <ByTypeNav />
        <SidebarAgentSection />
        <SidebarSettingsSection />
      </SidebarContent>
      {isAnonymous ? (
        <SidebarFooter className="px-3 pb-3">
          <Button
            nativeButton={false}
            render={<Link href="/sign-up" />}
            data-testid="sidebar-anon-signup-cta"
            className="w-full"
          >
            Sign up to save across devices
          </Button>
        </SidebarFooter>
      ) : null}
    </ShadcnSidebar>
  );
}
