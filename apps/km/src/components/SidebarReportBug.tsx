"use client";

import { Megaphone } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { sidebarSectionGroupClassName } from "./SidebarChrome";
import { cn } from "@/lib/utils";
import { openFeedbackDialog } from "@/lib/sentry/open-feedback";

/**
 * Sidebar "Report a bug" item (GSD-220), rendered as the LAST entry below the
 * nav sections. Replaces Sentry's floating actor launcher (hidden via the
 * shadow-root stylesheet in instrumentation-client.ts) and opens the SAME
 * Sentry feedback dialog via openFeedbackDialog() — no form is rebuilt.
 *
 * Uses SidebarMenuButton (not a raw <button>) so it inherits the shared
 * `data-sidebar="menu-button"` row styling — identical alignment to the
 * Settings/Agent rows, and icon-only collapse via the globals.css rules.
 */
export function SidebarReportBug() {
  return (
    <SidebarGroup className={sidebarSectionGroupClassName}>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              data-testid="sidebar-report-bug"
              onClick={() => void openFeedbackDialog()}
              className={cn(
                "gap-2 rounded-md px-2.5 py-1.5 text-[13px] font-normal text-[var(--fg-2)]",
                "hover:bg-[var(--bg-roof-2)]",
              )}
            >
              <Megaphone aria-hidden className="size-4" />
              <span>Report a bug</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
