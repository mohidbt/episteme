import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { getRequiredUserId } from "@/lib/session";
import { touchRecent } from "@/lib/library/touch-recents";
import { getDefaultLibrary } from "@/lib/default-library";
import { listAllFolders } from "@/lib/folders-server";
import { getReference, listPapersInLibrary } from "@/lib/references-server";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ReferenceForm } from "@/components/ReferenceForm";
import { ReferenceAgenticSearchButton } from "@/components/ReferenceAgenticSearchButton";
import { ReferenceAttachPaperControl } from "@/components/ReferenceAttachPaperControl";
import { TabTitleUpdater } from "@/components/TabBar";
import { Badge } from "@/components/ui/badge";
import { denormaliseForList, validateCslJson } from "@/lib/csl";
import { getReferenceCitedIn } from "@/lib/citations/reference-cited-in";
import { findIdentityPaperForReference } from "@/lib/citations/identity-match";

export default async function ReferencePage({
  params,
}: {
  params: Promise<{ referenceId: string }>;
}) {
  const userId = await getRequiredUserId();
  const { referenceId } = await params;
  const [ref, library, citedIn, identityPaper] = await Promise.all([
    getReference(referenceId, userId),
    getDefaultLibrary(userId),
    getReferenceCitedIn(referenceId, userId),
    findIdentityPaperForReference(referenceId, userId),
  ]);
  if (!ref) notFound();

  // GSD-96 R3 — fire-and-forget recents touch (powers @-picker empty state).
  after(() =>
    touchRecent({ userId, kind: "reference", itemId: ref.id, swallow: true }),
  );

  // O2: manual attach picker needs the user's library papers. Only fetch when
  // we'll actually render the picker (identity not yet established).
  const [pickerPapers, allFolders] = await Promise.all([
    identityPaper ? Promise.resolve([]) : listPapersInLibrary(ref.libraryId, userId),
    library ? listAllFolders(library.id, userId) : Promise.resolve([]),
  ]);

  // GSD-43 follow-up: refs created via the sidebar "+" button may have a
  // minimal cslJson ({type, title}) without an `id` field, which makes
  // validateCslJson throw. Fall back to citationKey rather than crashing
  // the entire Server Component.
  let displayTitle = ref.citationKey;
  try {
    const csl = validateCslJson(ref.cslJson);
    displayTitle = denormaliseForList(csl).title.trim() || ref.citationKey;
  } catch {
    const rawTitle =
      typeof ref.cslJson === "object" &&
      ref.cslJson !== null &&
      typeof (ref.cslJson as { title?: unknown }).title === "string"
        ? ((ref.cslJson as { title: string }).title.trim() || "")
        : "";
    displayTitle = rawTitle || ref.citationKey;
  }

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
          identityPaper={identityPaper}
        />
        {identityPaper ? (
          <>
            <Link
              href={`/p/${identityPaper.paperId}`}
              aria-label={`Open library paper: ${identityPaper.title?.trim() || "untitled"}`}
            >
              <Badge
                variant="secondary"
                className="cursor-pointer hover:bg-muted"
              >
                Paper in library
              </Badge>
            </Link>
            <ReferenceAttachPaperControl
              referenceId={ref.id}
              attachedPaperId={identityPaper.paperId}
              papers={[]}
            />
          </>
        ) : (
          <ReferenceAttachPaperControl
            referenceId={ref.id}
            attachedPaperId={null}
            papers={pickerPapers}
          />
        )}
      </div>
      <ReferenceForm reference={ref} folders={allFolders} />

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
