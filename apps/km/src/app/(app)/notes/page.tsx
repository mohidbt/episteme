import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@episteme/auth";
import { getDefaultLibrary } from "@/lib/default-library";
import { listNotes, type NoteRow } from "@/lib/notes-server";
import { listAllFolders } from "@/lib/folders-server";
import { resolveChain, breadcrumbFromChain, type FolderRow } from "@/lib/folders";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function NotesList({
  notes,
  folderById,
}: {
  notes: NoteRow[];
  folderById: Map<string, FolderRow>;
}) {
  const allFolders = Array.from(folderById.values());

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Folder</TableHead>
          <TableHead>Updated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {notes.map((note) => {
          const chain = resolveChain(allFolders, note.folderId);
          const crumb = breadcrumbFromChain(chain);
          return (
            <TableRow key={note.id}>
              <TableCell>
                <Link
                  href={`/n/${note.slug}`}
                  className="text-foreground hover:underline"
                >
                  {note.title}
                </Link>
              </TableCell>
              <TableCell>
                {crumb ? (
                  <Badge variant="secondary">{crumb}</Badge>
                ) : (
                  <span className="text-muted-foreground text-xs">—</span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground text-xs">
                {new Date(note.updatedAt).toLocaleDateString()}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export default async function NotesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/sign-in");
  const library = await getDefaultLibrary(session.user.id);
  if (!library) redirect("/");

  const [allNotes, allFolders] = await Promise.all([
    listNotes(library.id, session.user.id),
    listAllFolders(library.id, session.user.id),
  ]);

  const folderById = new Map(allFolders.map((f) => [f.id, f]));

  const rows = allNotes.filter((note) => {
    if (!note.folderId) return true;
    const chain = resolveChain(allFolders, note.folderId);
    return !chain.some((f) => f.isTrash);
  });

  return (
    <div className="p-6">
      <Breadcrumbs libraryName={library.name} section="notes" folderPath="" />
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
        <NotesList notes={rows} folderById={folderById} />
      )}
    </div>
  );
}
