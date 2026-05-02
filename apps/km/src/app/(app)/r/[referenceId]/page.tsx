import Link from "next/link";
import { notFound } from "next/navigation";
import { BookMarked } from "lucide-react";
import { getRequiredUserId } from "@/lib/session";
import { getDefaultLibrary } from "@/lib/default-library";
import { getReference, listPapersInLibrary } from "@/lib/references-server";
import { listAllFolders } from "@/lib/folders-server";
import { PathPill, type PathPillSegment } from "@/components/PathPill";
import { splitFolderPath } from "@/lib/tree";
import { ReferenceForm } from "@/components/ReferenceForm";
import { ReferenceAttachToPaperButton } from "@/components/ReferenceAttachToPaperButton";
import { ReferenceAgenticSearchButton } from "@/components/ReferenceAgenticSearchButton";
import { TabTitleUpdater } from "@/components/TabBar";
import { denormaliseForList, validateCslJson } from "@/lib/csl";

export default async function ReferencePage({
  params,
}: {
  params: Promise<{ referenceId: string }>;
}) {
  const userId = await getRequiredUserId();
  const { referenceId } = await params;
  const [ref, library] = await Promise.all([
    getReference(referenceId, userId),
    getDefaultLibrary(userId),
  ]);
  if (!ref) notFound();

  const [papersInLib, allFolders] = await Promise.all([
    library ? listPapersInLibrary(library.id, userId) : Promise.resolve([]),
    library ? listAllFolders(library.id, userId) : Promise.resolve([]),
  ]);

  const attachedPaper = ref.paperId
    ? (papersInLib.find((p) => p.id === ref.paperId) ?? null)
    : null;
  const displayTitle =
    denormaliseForList(validateCslJson(ref.cslJson)).title.trim() ||
    ref.citationKey;

  const folderSegs = splitFolderPath(ref.folderPath);
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
    <div className="mx-auto max-w-3xl p-6">
      <TabTitleUpdater href={`/r/${ref.id}`} title={displayTitle} />
      {library && <PathPill className="mb-4" segments={pillSegments} />}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ReferenceAgenticSearchButton
          referenceId={ref.id}
          citationKey={ref.citationKey}
        />
        <ReferenceAttachToPaperButton
          referenceId={ref.id}
          currentPaperId={ref.paperId ?? null}
          papers={papersInLib}
        />
        {attachedPaper && (
          <Link
            href={`/p/${attachedPaper.id}`}
            className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            <BookMarked className="h-3 w-3" aria-hidden />
            <span className="truncate max-w-[28ch]">
              Attached to: {attachedPaper.title?.trim() || attachedPaper.filename}
            </span>
            <span aria-hidden>→</span>
          </Link>
        )}
      </div>
      <ReferenceForm reference={ref} />
    </div>
  );
}
