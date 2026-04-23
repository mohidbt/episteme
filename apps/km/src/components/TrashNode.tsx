"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Trash2 } from "lucide-react";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

interface Props {
  trashId: string | null;
  nonEmpty: boolean;
}

export function TrashNode({ trashId, nonEmpty }: Props) {
  const pathname = usePathname();
  const href = trashId ? `/trash` : "#";
  const active = pathname === href;
  return (
    <SidebarMenuItem data-testid="sidebar-trash">
      <SidebarMenuButton
        render={<Link href={href} />}
        isActive={active}
        className="data-[active=true]:bg-transparent data-[active=true]:border-l-2 data-[active=true]:border-foreground data-[active=true]:font-medium data-[active=true]:rounded-l-none data-[active=true]:pl-[calc(0.5rem-2px)]"
      >
        <Trash2 aria-hidden />
        <span>Trash</span>
        {nonEmpty ? (
          <span
            data-testid="sidebar-trash-badge"
            aria-label="Trash has items"
            className="ml-auto inline-block size-1.5 rounded-full bg-foreground/70"
          />
        ) : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
