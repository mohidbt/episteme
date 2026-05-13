"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { DriveCollapsedShortcut, DriveTree } from "./DriveTree";
import { ByTypeNav } from "./ByTypeNav";
import { SidebarAgentSection } from "./SidebarAgentSection";
import { SidebarSettingsSection } from "./SidebarSettingsSection";
import type { TreeResponse } from "@/lib/tree-server";
import { useTreeInvalidation } from "@/lib/tree-invalidate";

interface SidebarShellProps {
  library: { id: number; name: string };
  tree: TreeResponse;
  isAnonymous: boolean;
}

const COLLAPSED_KEY = "sidebar-collapsed";
const COLLAPSED_WIDTH = "4rem";
const EXPANDED_WIDTH = "15.5rem";

const SidebarCollapsedContext = React.createContext(false);
export const useSidebarCollapsed = () => React.useContext(SidebarCollapsedContext);

function CollapseHandle({ collapsed, toggle }: { collapsed: boolean; toggle: () => void }) {
  return (
    <button
      type="button"
      data-testid="sidebar-collapse-toggle"
      data-sidebar-collapse-handle="true"
      onClick={toggle}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      className="ep-sb-handle absolute right-0 top-1/2 -translate-y-1/2 z-20 h-6 w-3.5 rounded-l-md border border-[var(--roof-border)] border-r-0 bg-[var(--bg-roof)] flex items-center justify-center text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--bg-roof-2)] transition-colors opacity-0 group-hover/sidebar-rail:opacity-100 transition-opacity"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {collapsed ? (
          <path d="m9 18 6-6-6-6" />
        ) : (
          <path d="m15 18-6-6 6-6" />
        )}
      </svg>
    </button>
  );
}

export function SidebarShell({ library, tree, isAnonymous }: SidebarShellProps) {
  const router = useRouter();
  const onMutate = React.useCallback(() => router.refresh(), [router]);
  // Subscribe to global tree-invalidation events fired by mutations elsewhere
  // in the app (DOI import, .bib upload, paper upload, …) so the sidebar
  // refreshes on trigger instead of polling.
  useTreeInvalidation(onMutate);
  const trashFolder = tree.folders.find((f) => f.isTrash) ?? null;

  // Guest accounts created before the "Example Library" rename still have
  // libraries named "My Library" in the database. Display the new label at
  // render time so existing guest sessions reflect the new copy without a
  // backfill migration.
  const displayLibraryName =
    isAnonymous && library.name === "My Library"
      ? "Example Library"
      : library.name;

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

  // Mirror the current sidebar width onto the document root so siblings
  // (e.g. the fixed-positioned AgentBall panel) can clamp against it.
  React.useEffect(() => {
    const el = document.documentElement;
    el.style.setProperty("--sidebar-width", width);
    return () => {
      el.style.removeProperty("--sidebar-width");
    };
  }, [width]);

  return (
    <SidebarCollapsedContext.Provider value={collapsed}>
      <div
        data-testid="sidebar-rail-root"
        data-collapsed={collapsed ? "true" : "false"}
        style={{ "--sidebar-width": width } as React.CSSProperties}
        className="group/sidebar-rail group relative h-full transition-[width] duration-200 ease-out"
      >
        <ShadcnSidebar
          collapsible="none"
          className="overflow-hidden bg-[var(--bg-roof)]"
        >
          {/* Workspace pill */}
          {collapsed ? (
            <SidebarHeader className="px-0 pt-5 pb-3">
              <div className="flex justify-center">
                <Link
                  href="/"
                  className="flex h-9 w-9 items-center justify-center rounded-md bg-foreground text-background font-display italic text-[17px] leading-none"
                  title="Personal"
                >
                  ε
                </Link>
              </div>
            </SidebarHeader>
          ) : (
            <SidebarHeader className="px-2 pt-5 pb-3 flex flex-row items-center gap-2">
              <Link
                href="/"
                className="flex h-9 items-center gap-2 rounded-md px-2 hover:bg-[var(--bg-roof-2)] transition-colors"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground text-background font-display italic text-[17px] leading-none pb-0.5">
                  ε
                </span>
                <span className="font-semibold text-[14px] tracking-tight text-foreground truncate">
                  {displayLibraryName}
                </span>
              </Link>
            </SidebarHeader>
          )}
          <SidebarContent className="gap-2 px-2">
            {!collapsed && (
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
            )}
            {collapsed && <DriveCollapsedShortcut />}
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

        <CollapseHandle collapsed={collapsed} toggle={toggle} />
      </div>
    </SidebarCollapsedContext.Provider>
  );
}
