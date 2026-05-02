"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
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
  const [modelLabel, setModelLabel] = useState<string | null>(null);
  const [convoCount, setConvoCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/agents/km/config")
      .then((r) => (r.ok ? r.json() : Promise.resolve(null)))
      .then((data: { modelPreference?: string } | null) => {
        if (!cancelled && data?.modelPreference) {
          const short = data.modelPreference.split("/").pop()?.replace(/-[a-z0-9]{4,}$/i, "") ?? null;
          setModelLabel(short);
        }
      })
      .catch(() => {});
    void fetch("/api/agent/threads")
      .then((r) => (r.ok ? r.json() : Promise.resolve(null)))
      .then((data: { threads?: unknown[] } | null) => {
        if (!cancelled && Array.isArray(data?.threads)) {
          setConvoCount(data.threads.length);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

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
            {label === "Convos" && convoCount != null && convoCount > 0 && (
              <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{convoCount}</span>
            )}
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
      {modelLabel && (
        <div className="px-[10px] py-1 text-[11px] text-muted-foreground tabular-nums">
          {modelLabel}
        </div>
      )}
    </SidebarSection>
  );
}