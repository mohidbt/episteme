import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { BookMarked } from "lucide-react";
import { auth } from "@episteme/auth";
import { getDefaultLibrary } from "@/lib/default-library";
import { getReference, listPapersInLibrary } from "@/lib/references-server";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ReferenceForm } from "@/components/ReferenceForm";
import { ReferenceAttachToPaperButton } from "@/components/ReferenceAttachToPaperButton";

export default async function ReferencePage({
  params,
}: {
  params: Promise<{ referenceId: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/sign-in");
  const { referenceId } = await params;
  const [ref, library] = await Promise.all([
    getReference(referenceId, session.user.id),
    getDefaultLibrary(session.user.id),
  ]);
  if (!ref) notFound();

  const papersInLib = library
    ? await listPapersInLibrary(library.id, session.user.id)
    : [];

  const attachedPaper = ref.paperId
    ? (papersInLib.find((p) => p.id === ref.paperId) ?? null)
    : null;

  return (
    <div className="mx-auto max-w-3xl p-6">
      {library && (
        <Breadcrumbs
          libraryName={library.name}
          section="references"
          folderPath={ref.folderPath}
          title={ref.citationKey}
        />
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
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
