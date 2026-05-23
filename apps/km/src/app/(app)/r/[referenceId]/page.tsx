import Link from "next/link";
import { notFound } from "next/navigation";
import { getRequiredUserId } from "@/lib/session";
import { getDefaultLibrary } from "@/lib/default-library";
import { getReference } from "@/lib/references-server";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ReferenceForm } from "@/components/ReferenceForm";
import { ReferenceAgenticSearchButton } from "@/components/ReferenceAgenticSearchButton";
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
        {identityPaper && (
          <Link
            href={`/p/${identityPaper.paperId}`}
            aria-label={`Open library paper: ${identityPaper.title?.trim() || "untitled"}`}
          >
            <Badge
              variant="secondary"
              className="cursor-pointer hover:bg-muted"
            >
              Is library paper
            </Badge>
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
