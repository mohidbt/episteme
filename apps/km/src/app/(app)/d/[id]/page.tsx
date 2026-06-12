import { notFound } from "next/navigation";
import { after } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { touchRecent } from "@/lib/library/touch-recents";
import Link from "next/link";
import { Download } from "lucide-react";
import { db } from "@/lib/db";
import { papersets, papers } from "@episteme/db/schema";
import { getRequiredUserId } from "@/lib/session";
import { getDefaultLibrary } from "@/lib/default-library";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { PapersetView } from "./PapersetView";
import { getFolderChain } from "./lib/folder-chain";
import { parseCsvCells } from "@/lib/papersets/cell-write";

type ColumnSpec = { name: string; description: string };
type RowRef = { paper_id: string };
type CellGrounding = Record<
  string,
  Record<string, { paper_id: string; block_ids: string[] }>
>;
type RunningCell = { row: number; col: string };

export default async function PapersetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const userId = await getRequiredUserId();

  const [ps] = await db.select().from(papersets).where(eq(papersets.id, id)).limit(1);
  if (!ps || ps.userId !== userId) notFound();

  // GSD-96 R3 — fire-and-forget recents touch (powers @-picker empty state).
  after(() =>
    touchRecent({ userId, kind: "paperset", itemId: ps.id, swallow: true }),
  );

  // Hide papersets sitting inside the trash folder (mirrors paper-page behaviour).
  const folderChain = await getFolderChain(ps.folderId, userId);
  if (folderChain.some((f) => f.isTrash)) notFound();

  const refs = ps.rowRefs as RowRef[];
  const paperIds = refs.map((r) => r.paper_id);
  const [library, paperRows] = await Promise.all([
    getDefaultLibrary(userId),
    paperIds.length
      ? db
          .select({
            id: papers.id,
            title: papers.title,
            filename: papers.filename,
          })
          .from(papers)
          .where(inArray(papers.id, paperIds))
      : Promise.resolve(
          [] as Array<{ id: string; title: string | null; filename: string }>,
        ),
  ]);
  const paperById = Object.fromEntries(paperRows.map((p) => [p.id, p]));

  const columns = ps.columns as ColumnSpec[];
  const cellGrounding = ps.cellGrounding as CellGrounding;
  const runningCells = ps.runningCells as RunningCell[];
  const cellValues = parseCsvCells(ps.content, columns);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-6 pt-6">
        {library && (
          <Breadcrumbs
            libraryName={library.name}
            section="papersets"
            folderPath={folderChain.map((f) => f.name).join("/")}
            title={ps.filename}
          />
        )}
        <div className="flex items-start justify-between gap-4">
          <h1 className="min-w-0 font-display text-2xl leading-tight">{ps.filename}</h1>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href={`/api/papersets/${ps.id}/file`}
              download={ps.filename}
              className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-border bg-background px-2.5 text-[0.8rem] font-medium text-foreground whitespace-nowrap transition-colors hover:bg-muted"
              aria-label={`Download ${ps.filename}`}
            >
              <Download className="h-3 w-3" data-icon="inline-start" />
              Download
            </Link>
          </div>
        </div>
      </div>
      <PapersetView
        id={ps.id}
        libraryId={ps.libraryId}
        initial={{
          columns,
          rowRefs: refs,
          cellGrounding,
          runningCells,
          cellValues,
        }}
        paperById={paperById}
      />
    </div>
  );
}
