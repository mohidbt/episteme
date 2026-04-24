"use client";

import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { resolveChain, breadcrumbFromChain, type FolderRow } from "@/lib/folders";

interface FolderBreadcrumbBadgeProps {
  folderId: string;
  folders: FolderRow[];
}

export function FolderBreadcrumbBadge({ folderId, folders }: FolderBreadcrumbBadgeProps) {
  const router = useRouter();
  const chain = resolveChain(folders, folderId);
  const crumb = breadcrumbFromChain(chain);
  if (!crumb) return null;

  const encodedPath = chain.map((f) => encodeURIComponent(f.name)).join("/");

  return (
    <Badge
      variant="secondary"
      className="cursor-pointer hover:bg-secondary/80"
      onClick={() => router.push(`/drive/${encodedPath}`)}
    >
      {crumb}
    </Badge>
  );
}
