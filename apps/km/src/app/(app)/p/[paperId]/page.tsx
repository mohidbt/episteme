import { cache } from "react";
import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookMarked } from "lucide-react";
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
    <div className="flex h-full flex-col">
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
        <h1 className="font-display text-2xl leading-tight">{displayTitle}</h1>
      </div>
      <div className="mt-4 grid flex-1 min-h-0 grid-cols-1 border-t border-border/60 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="relative min-h-[60vh] lg:min-h-0">
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
