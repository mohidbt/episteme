import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@episteme/auth";
import { getDefaultLibrary } from "@/lib/default-library";
import {
  getTrashFolderId,
  listAllFolders,
  listFolderContents,
} from "@/lib/folders-server";
import { FileBrowser } from "@/components/FileBrowser";
import { serializeFolderContents } from "@/app/(app)/drive/serialize";

export default async function TrashPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/sign-in");
  const userId = session.user.id;

  const library = await getDefaultLibrary(userId);
  if (!library) notFound();

  const trashId = await getTrashFolderId(library.id, userId).catch(() => null);
  if (!trashId) notFound();

  const [contents, allFolders] = await Promise.all([
    listFolderContents(library.id, userId, trashId),
    listAllFolders(library.id, userId),
  ]);

  return (
    <FileBrowser
      libraryId={library.id}
      libraryName={library.name}
      folderId={trashId}
      folderChain={[{ id: trashId, name: "Trash" }]}
      contents={serializeFolderContents(contents)}
      folders={allFolders}
      isTrashView={true}
    />
  );
}
