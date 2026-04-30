"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen, UserPlus } from "lucide-react";
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

const COLLAPSED_KEY = "sidebar-collapsed";
const COLLAPSED_WIDTH = "3.5rem";
const EXPANDED_WIDTH = "16rem";

export function SidebarShell({ library, tree, isAnonymous }: SidebarShellProps) {
  const router = useRouter();
  const onMutate = () => router.refresh();
  const trashFolder = tree.folders.find((f) => f.isTrash) ?? null;

  const [collapsed, setCollapsed] = React.useState(false);

  // Hydrate collapsed state from localStorage on mount.
  React.useEffect(() => {
    try {
      const v = window.localStorage.getItem(COLLAPSED_KEY);
      if (v === "true") setCollapsed(true);
    } catch {
      // ignore (SSR / private mode)
    }
  }, []);

  const toggle = React.useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        window.localStorage.setItem(COLLAPSED_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const width = collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH;

  return (
    <div
      data-testid="sidebar-rail-root"
      data-collapsed={collapsed ? "true" : "false"}
      style={{ "--sidebar-width": width } as React.CSSProperties}
      className="h-full transition-[width] duration-200 ease-out [&_[data-sidebar=menu-button]_svg]:transition-transform [&_[data-sidebar=menu-button]:hover_svg]:scale-110"
    >
      <ShadcnSidebar
        collapsible="none"
        className="border border-foreground rounded-r-xl overflow-hidden shadow-[4px_4px_20px_rgba(0,0,0,0.08)]"
      >
        <SidebarHeader className="px-4 pt-5 pb-3 flex flex-row items-center justify-between gap-2">
          <Link
            href="/"
            className="font-display text-[20px] leading-none tracking-tight text-sidebar-foreground hover:underline truncate min-w-0"
            data-testid="km-sidebar-library-name"
            aria-hidden={collapsed ? true : undefined}
            tabIndex={collapsed ? -1 : 0}
            style={collapsed ? { opacity: 0, pointerEvents: "none" } : undefined}
          >
            {library.name}
          </Link>
          <button
            type="button"
            data-testid="sidebar-collapse-toggle"
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors [&_svg]:transition-transform hover:[&_svg]:scale-110"
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" aria-hidden />
            ) : (
              <PanelLeftClose className="size-4" aria-hidden />
            )}
          </button>
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
              render={
                <Link
                  href="/sign-up"
                  aria-label={collapsed ? "Sign up to save across devices" : undefined}
                />
              }
              data-testid="sidebar-anon-signup-cta"
              className={collapsed ? "w-full px-0" : "w-full"}
            >
              {collapsed ? (
                <UserPlus className="size-4" aria-hidden />
              ) : (
                "Sign up to save across devices"
              )}
            </Button>
          </SidebarFooter>
        ) : null}
      </ShadcnSidebar>
    </div>
  );
}
