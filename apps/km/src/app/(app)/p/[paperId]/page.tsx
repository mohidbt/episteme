import { cache } from "react";
import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookMarked, Download } from "lucide-react";
import { getRequiredUserId } from "@/lib/session";
import { db } from "@/lib/db";
import { papers } from "@episteme/db/schema";
import { getDefaultLibrary } from "@/lib/default-library";
import { getReferencesForPaper } from "@/lib/references-server";
import { papersetCountForPaper, papersetsForPaper } from "@/lib/papersets-server";
import { listAllFolders } from "@/lib/folders-server";
import { denormaliseForList, validateCslJson } from "@/lib/csl";
import { PathPill, type PathPillSegment } from "@/components/PathPill";
import { splitFolderPath } from "@/lib/tree";
import { PaperMetadataPanel } from "@/components/PaperMetadataPanel";
import { PaperHighlightsList } from "@/components/PaperHighlightsList";
import { TabTitleUpdater } from "@/components/TabBar";

type PaperRow = typeof papers.$inferSelect;

const loadPaper = cache(async (paperId: string, userId: string): Promise<PaperRow | null> => {
  const rows = await db
    .select()
    .from(papers)
    .where(and(eq(papers.id, paperId), eq(papers.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
});

function refYear(cslJson: unknown): number | null {
  try {
    return denormaliseForList(validateCslJson(cslJson)).year;
  } catch {
    return null;
  }
}

export default async function PaperPage({
  params,
}: {
  params: Promise<{ paperId: string }>;
}) {
  const userId = await getRequiredUserId();

  const { paperId } = await params;
  const paper = await loadPaper(paperId, userId);
  if (!paper) notFound();

  const [library, refs, papersetCount, papersetList] = await Promise.all([
    getDefaultLibrary(userId),
    getReferencesForPaper(paper.id, userId),
    papersetCountForPaper(paper.id, userId),
    papersetsForPaper(paper.id, userId),
  ]);
  const allFolders = library
    ? await listAllFolders(library.id, userId)
    : [];
  const displayTitle = paper.title && paper.title.trim().length > 0 ? paper.title : paper.filename;
  const firstRef = refs[0];
  const firstRefYear = firstRef ? refYear(firstRef.cslJson) : null;

  const folderSegs = splitFolderPath(paper.folderPath);
  const pillSegments: PathPillSegment[] = library
    ? [
        { id: "root", label: library.name, href: "/" },
        ...folderSegs.map((name, i) => ({
          id: `folder-${i}`,
          label: name,
          href:
            "/drive/" +
            folderSegs
              .slice(0, i + 1)
              .map((x) => encodeURIComponent(x))
              .join("/"),
        })),
        { id: "title", label: displayTitle, href: null },
      ]
    : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TabTitleUpdater href={`/p/${paper.id}`} title={displayTitle} />
      <div className="px-6 pt-6">
        {library && <PathPill className="mb-4" segments={pillSegments} />}
        {firstRef && (
          <Link
            href={`/r/${firstRef.id}`}
            className="mb-2 inline-flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            <BookMarked className="h-3 w-3" aria-hidden />
            <span>{firstRef.citationKey}</span>
            {firstRefYear != null && <span>· {firstRefYear}</span>}
          </Link>
        )}
        <div className="flex items-start justify-between gap-4">
          <h1 className="min-w-0 font-display text-2xl leading-tight">
            {displayTitle}
          </h1>
          <Link
            href={`/api/papers/${paper.id}/file`}
            download={paper.filename}
            className="inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md border border-border bg-background px-2.5 text-[0.8rem] font-medium text-foreground whitespace-nowrap transition-colors hover:bg-muted"
            aria-label={`Download ${displayTitle}`}
          >
            <Download data-icon="inline-start" />
            Download
          </Link>
        </div>
      </div>
      <div className="mt-4 grid min-h-0 flex-1 grid-cols-1 border-t border-border/60 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="relative h-full min-h-[60vh] lg:min-h-0">
          <iframe
            src={`/api/papers/${paper.id}/file`}
            title={displayTitle}
            className="h-full w-full border-0"
          />
        </div>
        <aside className="flex flex-col gap-8 overflow-y-auto border-t border-border/60 p-6 lg:border-t-0 lg:border-l">
          <PaperMetadataPanel paper={paper} papersetCount={papersetCount} papersets={papersetList} />
          <PaperHighlightsList paperId={paper.id} />
        </aside>
      </div>
    </div>
  );
}
