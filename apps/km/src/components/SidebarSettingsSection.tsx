"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Cog, Database as DataIcon, Palette, ShieldCheck } from "lucide-react";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { SidebarSection } from "./SidebarSection";
import { cn } from "@/lib/utils";

const LINKS = [
  { label: "Data", href: "/settings/data", Icon: DataIcon },
  { label: "Appearance", href: "/settings/appearance", Icon: Palette },
  { label: "Agent settings", href: "/settings/agents", Icon: ShieldCheck },
] as const;

export function SidebarSettingsSection() {
  const pathname = usePathname();
  return (
    <SidebarSection
      label="Settings"
      icon={<Cog className="size-3.5" aria-hidden />}
    >
      {LINKS.map(({ label, href, Icon }) => (
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