import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@episteme/auth";
import { getDefaultLibrary } from "@/lib/default-library";
import { getTrashFolderId, listAllFolders, listFolderContents } from "@/lib/folders-server";
import { FileBrowser } from "@/components/FileBrowser";
import { serializeFolderContents } from "@/app/(app)/drive/serialize";
import { resolveDrivePath } from "./resolve";

export default async function DriveDeepPage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/sign-in");
  const userId = session.user.id;

  const library = await getDefaultLibrary(userId);
  if (!library) notFound();

  const { path } = await params;
  const chain = await resolveDrivePath(library.id, userId, path);
  if (!chain) notFound();

  const parent = chain[chain.length - 1]?.id ?? null;
  const [contents, allFolders, trashId] = await Promise.all([
    listFolderContents(library.id, userId, parent),
    listAllFolders(library.id, userId),
    getTrashFolderId(library.id, userId).catch(() => null),
  ]);

  const isTrashView = parent !== null && parent === trashId;

  return (
    <FileBrowser
      libraryId={library.id}
      libraryName={library.name}
      folderId={parent}
      folderChain={chain}
      contents={serializeFolderContents(contents)}
      folders={allFolders}
      isTrashView={isTrashView}
    />
  );
}
