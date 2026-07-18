"use client";

import { Megaphone } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { openFeedbackDialog } from "@/lib/sentry/open-feedback";

/**
 * Sidebar "Report a bug" item (GSD-220), rendered as the LAST entry below the
 * nav sections. Replaces Sentry's floating actor launcher (hidden via the
 * shadow-root stylesheet in instrumentation-client.ts) and opens the SAME
 * Sentry feedback dialog via openFeedbackDialog() — no form is rebuilt.
 */
export function SidebarReportBug() {
  return (
    <SidebarGroup className="py-0">
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <button
              type="button"
              data-testid="sidebar-report-bug"
              onClick={() => void openFeedbackDialog()}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5",
                "text-[13px] font-normal text-[var(--fg-2)]",
                "hover:bg-[var(--bg-roof-2)] transition-colors",
              )}
            >
              <Megaphone aria-hidden className="size-4" />
              <span>Report a bug</span>
            </button>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
