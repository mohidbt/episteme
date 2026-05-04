"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookMarked, FileText, LayoutList, Network, NotebookPen, Table2 } from "lucide-react";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { SidebarSection } from "./SidebarSection";
import { sidebarSectionIconClassName } from "./SidebarChrome";
import { cn } from "@/lib/utils";

const LINKS = [
  { label: "Papers", href: "/papers", Icon: FileText },
  { label: "References", href: "/references", Icon: BookMarked },
  { label: "Notes", href: "/notes", Icon: NotebookPen },
  { label: "Graph", href: "/graph", Icon: Network },
  { label: "Papersets", href: "/papersets", Icon: Table2 },
] as const;

export function ByTypeNav() {
  const pathname = usePathname();
  return (
    <SidebarSection
      label="Collections"
      icon={<LayoutList className={sidebarSectionIconClassName} aria-hidden />}
    >
      {LINKS.map(({ label, href, Icon }) => (
        <SidebarMenuItem key={href}>
          <SidebarMenuButton
            render={<Link href={href} />}
            isActive={pathname === href}
            className={cn(
              "gap-2 rounded-md px-2.5 py-1.5 text-[13px] font-normal text-[var(--fg-2)]",
              "data-[active=true]:bg-[var(--bg-roof-2)] data-[active=true]:font-medium data-[active=true]:text-[var(--fg)]",
              "hover:bg-[var(--bg-roof-2)]",
            )}
          >
            <Icon aria-hidden className="size-4" />
            <span>{label}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarSection>
  );
}
