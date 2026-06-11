"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookMarked,
  FileText,
  LayoutList,
  Network,
  NotebookPen,
  Plus,
  Table2,
} from "lucide-react";
import { toast } from "sonner";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { SidebarSection } from "./SidebarSection";
import { sidebarSectionIconClassName } from "./SidebarChrome";
import { cn } from "@/lib/utils";
import { invalidateDriveTree } from "@/lib/drive-sync";

type QuickCreateKind = "note" | "reference" | "paperset";

const LINKS = [
  { label: "Papers", href: "/papers", Icon: FileText, quickCreate: null },
  {
    label: "References",
    href: "/references",
    Icon: BookMarked,
    quickCreate: "reference" as const,
  },
  {
    label: "Notes",
    href: "/notes",
    Icon: NotebookPen,
    quickCreate: "note" as const,
  },
  { label: "Graph", href: "/graph", Icon: Network, quickCreate: null },
  {
    label: "Papersets",
    href: "/papersets",
    Icon: Table2,
    quickCreate: "paperset" as const,
  },
] as const;

interface ByTypeNavProps {
  /** Default-library id used by quick-create POSTs. When undefined, quick-create buttons are hidden. */
  libraryId?: number;
}

export function ByTypeNav({ libraryId }: ByTypeNavProps = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = React.useState<QuickCreateKind | null>(null);

  async function quickCreate(kind: QuickCreateKind) {
    if (libraryId == null || busy) return;
    setBusy(kind);
    try {
      if (kind === "note") {
        const r = await fetch("/api/notes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            libraryId,
            folderId: null,
            title: "Untitled note",
          }),
        });
        if (!r.ok) {
          toast.error("Create note failed");
          return;
        }
        const row = (await r.json()) as { slug: string };
        invalidateDriveTree();
        router.push(`/n/${encodeURIComponent(row.slug)}`);
      } else if (kind === "reference") {
        // Citation key must match /^[A-Za-z0-9_:-]+$/ — generate a unique
        // collision-resistant default; user can rename on the detail page.
        const citationKey = `ref-${Date.now().toString(36)}`;
        const r = await fetch("/api/references", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            libraryId,
            folderId: null,
            citationKey,
            cslJson: { type: "article", title: "Untitled reference" },
          }),
        });
        if (!r.ok) {
          toast.error("Create reference failed");
          return;
        }
        const row = (await r.json()) as { id: string };
        invalidateDriveTree();
        router.push(`/r/${row.id}`);
      } else {
        // Papersets API requires >=1 column. Seed a single placeholder so the
        // quick-create path stays one-click; user edits columns on detail page.
        const r = await fetch("/api/papersets", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            filename: "Untitled paperset",
            folderId: null,
            columns: [
              {
                name: "notes",
                description: "Free-form notes about each paper.",
              },
            ],
          }),
        });
        if (!r.ok) {
          toast.error("Create paperset failed");
          return;
        }
        const row = (await r.json()) as { id: string };
        invalidateDriveTree();
        router.push(`/d/${row.id}`);
      }
    } catch {
      toast.error("Create failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <SidebarSection
      label="Collections"
      icon={<LayoutList className={sidebarSectionIconClassName} aria-hidden />}
    >
      {LINKS.map(({ label, href, Icon, quickCreate: kind }) => (
        <SidebarMenuItem
          key={href}
          data-testid={`tour-nav-${label.toLowerCase()}`}
          className="group/by-type-row relative"
        >
          <SidebarMenuButton
            render={<Link href={href} />}
            isActive={pathname === href}
            className={cn(
              "gap-2 rounded-md px-2.5 py-1.5 text-[13px] font-normal text-[var(--fg-2)]",
              "data-[active=true]:bg-[var(--bg-roof-2)] data-[active=true]:font-medium data-[active=true]:text-[var(--fg)]",
              "hover:bg-[var(--bg-roof-2)]",
              kind ? "pr-7" : undefined,
            )}
          >
            <Icon aria-hidden className="size-4" />
            <span>{label}</span>
          </SidebarMenuButton>
          {kind && libraryId != null ? (
            <button
              type="button"
              aria-label={`Quick create ${kind}`}
              data-testid={`quick-create-${kind}`}
              disabled={busy === kind}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void quickCreate(kind);
              }}
              className={cn(
                "absolute right-1.5 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-md text-[var(--fg-muted)]",
                "opacity-0 group-hover/by-type-row:opacity-100 focus-visible:opacity-100",
                "hover:bg-[var(--bg-roof-2)] hover:text-[var(--fg)]",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                "transition-opacity",
              )}
            >
              <Plus aria-hidden className="size-3.5" />
            </button>
          ) : null}
        </SidebarMenuItem>
      ))}
    </SidebarSection>
  );
}
