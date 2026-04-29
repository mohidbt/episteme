import Link from "next/link";
import { redirect } from "next/navigation";
import { getRequiredUserId } from "@/lib/session";
import { getDefaultLibrary } from "@/lib/default-library";
import { listAllPapersets } from "@/lib/papersets-server";
import { listAllFolders } from "@/lib/folders-server";
import { resolveChain } from "@/lib/folders";
import { FolderFilterDropdown } from "@/components/FolderFilterDropdown";
import { PapersetTable } from "./PapersetTable";

export default async function PapersetsPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string }>;
}) {
  const sp = await searchParams;
  const folderFilter = sp.folder ?? null;

  const userId = await getRequiredUserId();
  const library = await getDefaultLibrary(userId);
  if (!library) redirect("/");

  const [allPapersets, allFolders] = await Promise.all([
    listAllPapersets(library.id, userId),
    listAllFolders(library.id, userId),
  ]);

  // Exclude papersets in trash (anywhere up the folder chain)
  const visible = allPapersets.filter((ps) => {
    if (!ps.folderId) return true;
    const chain = resolveChain(allFolders, ps.folderId);
    return !chain.some((f) => f.isTrash);
  });

  const rows = folderFilter != null
    ? visible.filter((p) => p.folderId === folderFilter)
    : visible;

  const activeFolder = folderFilter
    ? allFolders.find((f) => f.id === folderFilter)
    : null;

  return (
    <div className="p-6">
      <h1 className="mb-4 font-display text-3xl leading-none tracking-tight">
        Papersets
      </h1>
      <div className="mb-4 flex items-center gap-3">
        <FolderFilterDropdown
          folders={allFolders}
          activeFolderId={folderFilter}
          basePath="/papersets"
        />
        {folderFilter && (
          <span className="text-sm text-muted-foreground">
            Showing papersets in{" "}
            <span className="font-medium">
              {activeFolder?.name ?? folderFilter}
            </span>
            {" · "}
            <Link href="/papersets" className="underline hover:no-underline">
              Clear filter
            </Link>
          </span>
        )}
      </div>
      <PapersetTable rows={rows} folders={allFolders} />
    </div>
  );
}
