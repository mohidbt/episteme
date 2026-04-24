import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@episteme/auth";
import { getDefaultLibrary } from "@/lib/default-library";
import { listAllPapers } from "@/lib/papers-server";
import { listAllFolders } from "@/lib/folders-server";
import { resolveChain } from "@/lib/folders";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { PaperGrid } from "@/components/PaperGrid";
import { PaperUploadDropzone } from "@/components/PaperUploadDropzone";
import { FolderFilterDropdown } from "@/components/FolderFilterDropdown";

export default async function PapersPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string }>;
}) {
  const sp = await searchParams;
  const folderFilter = sp.folder ?? null;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/sign-in");
  const library = await getDefaultLibrary(session.user.id);
  if (!library) redirect("/");

  const [allPapers, allFolders] = await Promise.all([
    listAllPapers(library.id, session.user.id),
    listAllFolders(library.id, session.user.id),
  ]);

  // Exclude papers in trash
  const visiblePapers = allPapers.filter((paper) => {
    if (!paper.folderId) return true;
    const chain = resolveChain(allFolders, paper.folderId);
    return !chain.some((f) => f.isTrash);
  });

  // Apply folder filter (single folder match only)
  const rows = folderFilter != null
    ? visiblePapers.filter((p) => p.folderId === folderFilter)
    : visiblePapers;

  const activeFolder = folderFilter ? allFolders.find((f) => f.id === folderFilter) : null;

  return (
    <div className="p-6">
      <Breadcrumbs libraryName={library.name} section="papers" folderPath="" />
      <PaperUploadDropzone libraryId={library.id} folderPath="" />
      <div className="mb-4 flex items-center gap-3">
        <FolderFilterDropdown
          folders={allFolders}
          activeFolderId={folderFilter}
          basePath="/papers"
        />
        {folderFilter && (
          <span className="text-sm text-muted-foreground">
            Showing papers in{" "}
            <span className="font-medium">{activeFolder?.name ?? folderFilter}</span>
            {" · "}
            <Link href="/papers" className="underline hover:no-underline">
              Clear filter
            </Link>
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-10">
          <div className="text-center">
            {folderFilter ? (
              <>
                <p className="font-display text-xl">No papers in this folder</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Filtering by:{" "}
                  <span className="font-medium">{activeFolder?.name ?? folderFilter}</span>
                </p>
                <p className="mt-2 text-sm">
                  <Link href="/papers" className="underline hover:no-underline">
                    Clear filter
                  </Link>{" "}
                  to see all papers.
                </p>
              </>
            ) : (
              <>
                <p className="font-display text-xl">No papers yet</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Drop a PDF above or click the + in the sidebar to upload.
                </p>
              </>
            )}
          </div>
        </div>
      ) : (
        <PaperGrid papers={rows} folders={allFolders} />
      )}
    </div>
  );
}
