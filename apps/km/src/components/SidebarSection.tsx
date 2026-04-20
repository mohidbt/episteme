"use client";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from "@/components/ui/sidebar";
import { buildFolderTree } from "@/lib/tree";
import type { NoteItem, PaperItem, ReferenceItem } from "@/lib/tree-server";
import { SidebarFolder } from "./SidebarFolder";
import { SidebarAgentSection } from "./SidebarAgentSection";

type ContentSection = "papers" | "references" | "notes";

interface ContentProps {
  kind: ContentSection;
  label: string;
  items: (PaperItem | ReferenceItem | NoteItem)[];
}

interface AgentProps {
  kind: "agent";
}

type Props = ContentProps | AgentProps;

export function SidebarSection(props: Props) {
  if (props.kind === "agent") {
    return <SidebarAgentSection />;
  }
  const tree = buildFolderTree(props.items);
  return (
    <SidebarGroup>
      <SidebarGroupLabel className="text-[11px] font-medium tracking-[0.14em] uppercase text-muted-foreground">
        {props.label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarFolder node={tree} section={props.kind} depth={0} />
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
