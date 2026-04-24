"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookMarked, Database, FileText, LayoutList, NotebookPen } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const LINKS = [
  { label: "Papers", href: "/papers", Icon: FileText, muted: false },
  { label: "References", href: "/references", Icon: BookMarked, muted: false },
  { label: "Notes", href: "/notes", Icon: NotebookPen, muted: false },
  { label: "Data", href: "/data", Icon: Database, muted: true },
] as const;

export function ByTypeNav() {
  const pathname = usePathname();
  return (
    <SidebarGroup>
      <SidebarGroupLabel className="h-auto gap-2 bg-background border border-border/60 rounded-md px-2 py-1.5 text-[13px] font-semibold text-foreground">
        <LayoutList data-icon="inline-start" aria-hidden className="size-3 text-foreground" />
        By type
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {LINKS.map(({ label, href, Icon, muted }) => (
            <SidebarMenuItem key={href}>
              <SidebarMenuButton
                render={<Link href={href} />}
                isActive={pathname === href}
                className={`data-[active=true]:bg-transparent data-[active=true]:border-l-2 data-[active=true]:border-foreground data-[active=true]:font-medium data-[active=true]:rounded-l-none data-[active=true]:pl-[calc(0.5rem-2px)]${muted ? " text-muted-foreground" : ""}`}
              >
                <Icon aria-hidden />
                <span>{label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
