"use client";

import { BookMarked, FileText, NotebookPen } from "lucide-react";
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
  libraryId: number;
}

interface AgentProps {
  kind: "agent";
}

type Props = ContentProps | AgentProps;

const SECTION_ICON = {
  papers: FileText,
  references: BookMarked,
  notes: NotebookPen,
} as const;

export function SidebarSection(props: Props) {
  if (props.kind === "agent") {
    return <SidebarAgentSection />;
  }
  const Icon = SECTION_ICON[props.kind];
  const tree = buildFolderTree(props.items);
  return (
    <SidebarGroup>
      <SidebarGroupLabel className="gap-2 text-[11px] font-medium tracking-[0.14em] uppercase text-muted-foreground">
        <Icon data-icon="inline-start" aria-hidden />
        {props.label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarFolder
            node={tree}
            section={props.kind}
            depth={0}
            libraryId={props.libraryId}
          />
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
