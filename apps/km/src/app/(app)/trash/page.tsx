import { notFound } from "next/navigation";
import { getRequiredUserId } from "@/lib/session";
import { getDefaultLibrary } from "@/lib/default-library";
import {
  getTrashFolderId,
  listAllFolders,
  listFolderContents,
} from "@/lib/folders-server";
import { FileBrowser } from "@/components/FileBrowser";
import { serializeFolderContents } from "@/app/(app)/drive/serialize";

export default async function TrashPage() {
  const userId = await getRequiredUserId();

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
