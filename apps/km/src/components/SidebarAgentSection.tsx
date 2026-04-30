"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, MessagesSquare } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const AGENT_ROWS = [
  { label: "Agents", href: "/agents", Icon: MessagesSquare },
] as const;

export function SidebarAgentSection() {
  const pathname = usePathname();
  return (
    <SidebarGroup>
      <SidebarGroupLabel className="h-auto gap-2 bg-background border border-border/60 rounded-md px-2 py-1.5 text-[13px] font-semibold text-foreground [&>svg]:size-3 [&>svg]:text-foreground">
        <Bot data-icon="inline-start" aria-hidden className="size-3 text-foreground" />
        Co-Scientist
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {AGENT_ROWS.map(({ label, href, Icon }) => (
            <SidebarMenuItem key={href}>
              <SidebarMenuButton
                render={<Link href={href} />}
                isActive={pathname === href}
                className="data-[active=true]:bg-transparent data-[active=true]:border-l-2 data-[active=true]:border-foreground data-[active=true]:font-medium data-[active=true]:rounded-l-none data-[active=true]:pl-[calc(0.5rem-2px)]"
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
