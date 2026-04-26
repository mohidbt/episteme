import Link from "next/link";
import { redirect } from "next/navigation";
import { getRequiredUserId } from "@/lib/session";
import { getDefaultLibrary } from "@/lib/default-library";
import { listAllReferences } from "@/lib/references-server";
import { listAllFolders } from "@/lib/folders-server";
import { resolveChain } from "@/lib/folders";
import { ReferenceTable } from "@/components/ReferenceTable";
import { ReferenceDoiInput } from "@/components/ReferenceDoiInput";
import { ReferenceImportButton } from "@/components/ReferenceImportButton";
import { FolderFilterDropdown } from "@/components/FolderFilterDropdown";
import { UnifiedDropzone } from "@/components/UnifiedDropzone";

export default async function ReferencesPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string }>;
}) {
  const sp = await searchParams;
  const folderFilter = sp.folder ?? null;

  const userId = await getRequiredUserId();
  const library = await getDefaultLibrary(userId);
  if (!library) redirect("/");

  const [allRefs, allFolders] = await Promise.all([
    listAllReferences(library.id, userId),
    listAllFolders(library.id, userId),
  ]);

  // Exclude references in trash
  const visibleRefs = allRefs.filter((ref) => {
    if (!ref.folderId) return true;
    const chain = resolveChain(allFolders, ref.folderId);
    return !chain.some((f) => f.isTrash);
  });

  // Apply folder filter (single folder match only)
  const rows = folderFilter != null
    ? visibleRefs.filter((r) => r.folderId === folderFilter)
    : visibleRefs;

  const activeFolder = folderFilter ? allFolders.find((f) => f.id === folderFilter) : null;

  return (
    <div className="p-6">
      <h1 className="mb-4 font-display text-3xl leading-none tracking-tight">
        References
      </h1>
      <UnifiedDropzone libraryId={library.id} folderPath="" />
      <div className="mb-6 flex flex-col gap-3">
        <ReferenceDoiInput libraryId={library.id} folderPath="" />
        <div className="flex items-center gap-2">
          <ReferenceImportButton libraryId={library.id} folderPath="" />
          <p className="text-xs text-muted-foreground">
            Bulk-import a BibTeX, RIS, or CSL-JSON file.
          </p>
        </div>
      </div>
      <div className="mb-4 flex items-center gap-3">
        <FolderFilterDropdown
          folders={allFolders}
          activeFolderId={folderFilter}
          basePath="/references"
        />
        {folderFilter && (
          <span className="text-sm text-muted-foreground">
            Showing references in{" "}
            <span className="font-medium">{activeFolder?.name ?? folderFilter}</span>
            {" · "}
            <Link href="/references" className="underline hover:no-underline">
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
                <p className="font-display text-xl">No references in this folder</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Filtering by:{" "}
                  <span className="font-medium">{activeFolder?.name ?? folderFilter}</span>
                </p>
                <p className="mt-2 text-sm">
                  <Link href="/references" className="underline hover:no-underline">
                    Clear filter
                  </Link>{" "}
                  to see all references.
                </p>
              </>
            ) : (
              <>
                <p className="font-display text-xl">No references yet</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Add one by entering a DOI above.
                </p>
              </>
            )}
          </div>
        </div>
      ) : (
        <ReferenceTable rows={rows} folders={allFolders} />
      )}
    </div>
  );
}
