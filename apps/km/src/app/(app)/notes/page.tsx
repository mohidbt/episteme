import { redirect } from "next/navigation";
import { getRequiredUserId } from "@/lib/session";
import { getDefaultLibrary } from "@/lib/default-library";
import { listNotes } from "@/lib/notes-server";
import { listAllFolders } from "@/lib/folders-server";
import { resolveChain } from "@/lib/folders";
import NotesTable from "@/components/NotesTable";
import { UnifiedDropzone } from "@/components/UnifiedDropzone";

export default async function NotesPage() {
  const userId = await getRequiredUserId();
  const library = await getDefaultLibrary(userId);
  if (!library) redirect("/");

  const [allNotes, allFolders] = await Promise.all([
    listNotes(library.id, userId),
    listAllFolders(library.id, userId),
  ]);

  const folderById = new Map(allFolders.map((f) => [f.id, f]));

  const rows = allNotes.filter((note) => {
    if (!note.folderId) return true;
    const chain = resolveChain(allFolders, note.folderId);
    return !chain.some((f) => f.isTrash);
  });

  return (
    <div className="p-6">
      <h1 className="mb-4 font-display text-3xl leading-none tracking-tight">
        Notes
      </h1>
      <UnifiedDropzone libraryId={library.id} folderPath="" />
      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-10">
          <div className="text-center">
            <p className="font-display text-xl">No notes yet</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Click the + in the sidebar to create a note.
            </p>
          </div>
        </div>
      ) : (
        <NotesTable notes={rows} folderById={folderById} />
      )}
    </div>
  );
}
