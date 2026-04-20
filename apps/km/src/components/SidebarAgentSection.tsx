"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Brain, Settings, Sparkles } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const AGENT_ROWS = [
  { label: "skills.md", href: "/agent/skills", Icon: Sparkles },
  { label: "memory.md", href: "/agent/memory", Icon: Brain },
  { label: "settings.json", href: "/agent/settings", Icon: Settings },
] as const;

export function SidebarAgentSection() {
  const pathname = usePathname();
  return (
    <SidebarGroup>
      <SidebarGroupLabel className="gap-2 text-[11px] font-medium tracking-[0.14em] uppercase text-muted-foreground">
        <Bot data-icon="inline-start" aria-hidden />
        Agent
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {AGENT_ROWS.map(({ label, href, Icon }) => (
            <SidebarMenuItem key={href}>
              <SidebarMenuButton
                render={<Link href={href} />}
                isActive={pathname === href}
                className="data-active:border-l-2 data-active:border-foreground data-active:rounded-l-none data-active:pl-[calc(0.5rem-2px)]"
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
