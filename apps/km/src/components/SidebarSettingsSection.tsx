"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Cog, Database as DataIcon, Palette } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const LINKS = [
  { label: "Data", href: "/settings/data", Icon: DataIcon },
  { label: "Appearance", href: "/settings/appearance", Icon: Palette },
] as const;

export function SidebarSettingsSection() {
  const pathname = usePathname();
  return (
    <SidebarGroup>
      <SidebarGroupLabel className="gap-2 text-[11px] font-medium tracking-[0.14em] uppercase text-muted-foreground">
        <Cog data-icon="inline-start" aria-hidden />
        Settings
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {LINKS.map(({ label, href, Icon }) => (
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
