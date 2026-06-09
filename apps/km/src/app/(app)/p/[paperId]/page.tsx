import { cache } from "react";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookMarked, BookOpen, Download } from "lucide-react";
import { getRequiredUserId } from "@/lib/session";
import { db } from "@/lib/db";
import { papers, documentReferences } from "@episteme/db/schema";
import { sql } from "drizzle-orm";
import { getPaperWithMergedRef } from "@/lib/papers/get-paper-with-merged-ref";
import { getDefaultLibrary } from "@/lib/default-library";
import { getReferencesForPaper, paperAlreadyReferenced } from "@/lib/references-server";
import { papersetCountForPaper, papersetsForPaper } from "@/lib/papersets-server";
import { listAllFolders } from "@/lib/folders-server";
import { denormaliseForList, validateCslJson } from "@/lib/csl";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { PaperMetadataPanel } from "@/components/PaperMetadataPanel";
import { PaperHighlightsList } from "@/components/PaperHighlightsList";
import { PaperCitationsList } from "@/components/PaperCitationsList";
import { PaperActionsButtons } from "@/components/PaperActionsButtons";
import { TabTitleUpdater } from "@/components/TabBar";
import { PaperPdfPreview } from "./PaperPdfPreview";

type PaperRow = typeof papers.$inferSelect;

// GSD-32 Phase 3: load paper merged with matched ref CSL (paper wins on
// non-blank fields; ref fills blanks). Identical signature to the prior
// direct query, callers unchanged.
const loadPaper = cache(
  async (paperId: string, userId: string): Promise<PaperRow | null> =>
    getPaperWithMergedRef(paperId, userId),
);

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

  const [library, refs, papersetCount, papersetList, citationCountRows, alreadyReferenced] = await Promise.all([
    getDefaultLibrary(userId),
    getReferencesForPaper(paper.id, userId),
    papersetCountForPaper(paper.id, userId),
    papersetsForPaper(paper.id, userId),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(documentReferences)
      .where(eq(documentReferences.paperId, paper.id)),
    paperAlreadyReferenced(paper.id, paper.libraryId, paper.doi, userId),
  ]);
  const hasCitations = (citationCountRows[0]?.n ?? 0) > 0;
  const allFolders = library
    ? await listAllFolders(library.id, userId)
    : [];
  const displayTitle = paper.title && paper.title.trim().length > 0 ? paper.title : paper.filename;
  const firstRef = refs[0];
  const firstRefYear = firstRef ? refYear(firstRef.cslJson) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TabTitleUpdater href={`/p/${paper.id}`} title={displayTitle} />
      <div className="px-6 pt-6">
        {library && (
          <Breadcrumbs
            libraryName={library.name}
            section="papers"
            folderPath={paper.folderPath}
            title={displayTitle}
          />
        )}
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
          <div className="flex shrink-0 items-center gap-2">
            <PaperActionsButtons
              paper={{
                id: paper.id,
                title: paper.title,
                doi: paper.doi,
                libraryId: paper.libraryId,
                folderPath: paper.folderPath,
              }}
              hasCitations={hasCitations}
              alreadyReferenced={alreadyReferenced}
            />
            <Link
              href={`/papers/${paper.id}/read`}
              className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-border bg-background px-2.5 text-[0.8rem] font-medium text-foreground whitespace-nowrap transition-colors hover:bg-muted"
              aria-label={`Open ${displayTitle} in reader`}
            >
              <BookOpen className="h-3 w-3" data-icon="inline-start" />
              Open in reader
            </Link>
            <Link
              href={`/api/papers/${paper.id}/file`}
              download={paper.filename}
              className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-border bg-background px-2.5 text-[0.8rem] font-medium text-foreground whitespace-nowrap transition-colors hover:bg-muted"
              aria-label={`Download ${displayTitle}`}
            >
              <Download className="h-3 w-3" data-icon="inline-start" />
              Download
            </Link>
          </div>
        </div>
      </div>
      <div className="mt-4 flex min-h-0 flex-1 flex-col border-t border-border/60 lg:flex-row">
        <div className="flex h-full min-h-[60vh] shrink-0 items-center justify-center overflow-hidden p-6 lg:min-h-0">
          <PaperPdfPreview
            paperId={paper.id}
            title={displayTitle}
          />
        </div>
        <aside className="flex min-w-0 flex-1 flex-col gap-8 overflow-y-auto border-t border-border/60 p-6 lg:border-t-0 lg:border-l">
          <PaperMetadataPanel
            paper={paper}
            papersetCount={papersetCount}
            papersets={papersetList}
            folders={allFolders}
          />
          <PaperHighlightsList paperId={paper.id} />
          <PaperCitationsList paperId={paper.id} />
        </aside>
      </div>
    </div>
  );
}
