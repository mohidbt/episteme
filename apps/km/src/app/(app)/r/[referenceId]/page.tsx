import Link from "next/link";
import { notFound } from "next/navigation";
import { BookMarked } from "lucide-react";
import { getRequiredUserId } from "@/lib/session";
import { getDefaultLibrary } from "@/lib/default-library";
import { getReference, listPapersInLibrary } from "@/lib/references-server";
import { Breadcrumbs } from "@/components/Breadcrumbs";
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

  const papersInLib = library
    ? await listPapersInLibrary(library.id, userId)
    : [];

  const attachedPaper = ref.paperId
    ? (papersInLib.find((p) => p.id === ref.paperId) ?? null)
    : null;
  const displayTitle =
    denormaliseForList(validateCslJson(ref.cslJson)).title.trim() ||
    ref.citationKey;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <TabTitleUpdater href={`/r/${ref.id}`} title={displayTitle} />
      {library && (
        <Breadcrumbs
          libraryName={library.name}
          section="references"
          folderPath={ref.folderPath}
          title={displayTitle}
        />
      )}
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
