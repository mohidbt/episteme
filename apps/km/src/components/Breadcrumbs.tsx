import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { splitFolderPath } from "@/lib/tree";

type Section = "papers" | "references" | "notes";

interface BreadcrumbsProps {
  libraryName: string;
  section: Section;
  folderPath: string;
  title?: string;
}

const SECTION_LABEL: Record<Section, string> = {
  papers: "Papers",
  references: "References",
  notes: "Notes",
};

const SECTION_HREF: Record<Section, string> = {
  papers: "/papers",
  references: "/references",
  notes: "/",
};

export function Breadcrumbs({ libraryName, section, folderPath, title }: BreadcrumbsProps) {
  const segments = splitFolderPath(folderPath);
  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-4 flex flex-wrap items-center gap-1 text-[11px] font-medium text-muted-foreground"
    >
      <Link href="/" className="hover:text-foreground">
        {libraryName}
      </Link>
      <ChevronRight className="size-3" aria-hidden />
      <Link href={SECTION_HREF[section]} className="hover:text-foreground">
        {SECTION_LABEL[section]}
      </Link>
      {segments.map((seg) => (
        <span key={seg} className="flex items-center gap-1">
          <ChevronRight className="size-3" aria-hidden />
          <span>{seg}</span>
        </span>
      ))}
      {title !== undefined && (
        <>
          <ChevronRight className="size-3" aria-hidden />
          <span className="normal-case tracking-normal text-foreground">{title}</span>
        </>
      )}
    </nav>
  );
}
