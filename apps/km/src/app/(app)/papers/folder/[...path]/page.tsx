import { notFound, redirect } from "next/navigation";
import { getRequiredUserId } from "@/lib/session";
import { getDefaultLibrary } from "@/lib/default-library";
import { listPapers } from "@/lib/papers-server";
import { isValidFolderPath } from "@/lib/tree";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { PaperGrid } from "@/components/PaperGrid";
import { UnifiedDropzone } from "@/components/UnifiedDropzone";

export default async function PapersFolderPage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const userId = await getRequiredUserId();
  const library = await getDefaultLibrary(userId);
  if (!library) redirect("/");

  const { path } = await params;
  let decoded: string[];
  try {
    decoded = path.map((seg) => decodeURIComponent(seg));
  } catch {
    notFound();
  }
  const folderPath = decoded.join("/") + "/";
  if (!isValidFolderPath(folderPath)) notFound();

  const rows = await listPapers(library.id, userId, folderPath);

  return (
    <div className="p-6">
      <Breadcrumbs
        libraryName={library.name}
        section="papers"
        folderPath={folderPath}
      />
      <UnifiedDropzone libraryId={library.id} folderPath={folderPath} />
      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-10">
          <div className="text-center">
            <p className="font-display text-xl">No papers in this folder</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Drop a PDF here or move one in from the sidebar.
            </p>
          </div>
        </div>
      ) : (
        <PaperGrid papers={rows} />
      )}
    </div>
  );
}
