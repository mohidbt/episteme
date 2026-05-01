import { notFound } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { papersets, papers } from "@episteme/db/schema";
import { getRequiredUserId } from "@/lib/session";
import { getDefaultLibrary } from "@/lib/default-library";
import { PapersetBreadcrumbs } from "./PapersetBreadcrumbs";
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
        <PapersetBreadcrumbs
          libraryName={library?.name ?? null}
          folderChain={folderChain}
          filename={ps.filename}
        />
        <h1 className="font-display text-2xl leading-tight">{ps.filename}</h1>
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
