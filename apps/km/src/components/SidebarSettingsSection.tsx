"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Cog, Database as DataIcon, Palette, ShieldCheck, UserCog } from "lucide-react";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { SidebarSection } from "./SidebarSection";
import { sidebarSectionIconClassName } from "./SidebarChrome";
import { cn } from "@/lib/utils";

const LINKS = [
  { label: "Account", href: "/settings/account", Icon: UserCog },
  { label: "Data", href: "/settings/data", Icon: DataIcon },
  { label: "Editor", href: "/settings/appearance", Icon: Palette },
  { label: "Agent settings", href: "/settings/agents", Icon: ShieldCheck },
] as const;

export function SidebarSettingsSection() {
  const pathname = usePathname();
  return (
    <SidebarSection
      label="Settings"
      icon={<Cog className={sidebarSectionIconClassName} aria-hidden />}
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
