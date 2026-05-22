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
import { getReferenceCitedIn } from "@/lib/citations/reference-cited-in";

export default async function ReferencePage({
  params,
}: {
  params: Promise<{ referenceId: string }>;
}) {
  const userId = await getRequiredUserId();
  const { referenceId } = await params;
  const [ref, library, citedIn] = await Promise.all([
    getReference(referenceId, userId),
    getDefaultLibrary(userId),
    getReferenceCitedIn(referenceId, userId),
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

      <section className="mt-8 border-t border-border/60 pt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Cited in
        </h2>
        {citedIn.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No papers in your library cite this reference yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {citedIn.map((row) => (
              <li key={row.edgeId}>
                <Link
                  href={`/p/${row.paperId}`}
                  className="flex items-baseline gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <span className="line-clamp-1 flex-1">
                    {row.title?.trim() || "(untitled paper)"}
                  </span>
                  {row.markerIdx != null && (
                    <span className="font-mono text-xs text-muted-foreground">
                      [{row.markerIdx}]
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
