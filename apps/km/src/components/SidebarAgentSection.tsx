"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, MessagesSquare } from "lucide-react";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { SidebarSection } from "./SidebarSection";
import { cn } from "@/lib/utils";

const AGENT_ROWS = [
  { label: "Convos", href: "/agents", Icon: MessagesSquare },
] as const;

export function SidebarAgentSection() {
  const pathname = usePathname();
  return (
    <SidebarSection
      label="Agent"
      icon={<Bot className="size-3.5" aria-hidden />}
    >
      {AGENT_ROWS.map(({ label, href, Icon }) => (
        <SidebarMenuItem key={href}>
          <SidebarMenuButton
            render={<Link href={href} />}
            isActive={pathname === href}
            className={cn(
              "text-[13px] font-normal text-[var(--fg-2)] gap-2 px-[10px] py-[5px] rounded-[6px]",
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