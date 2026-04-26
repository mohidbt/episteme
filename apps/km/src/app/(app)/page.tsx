import { getRequiredUserId } from "@/lib/session";
import { getDefaultLibrary } from "@/lib/default-library";
import { listAllFolders, listFolderContents } from "@/lib/folders-server";
import { FileBrowser } from "@/components/FileBrowser";
import { serializeFolderContents } from "@/app/(app)/drive/serialize";

// NOTE: if the user has no library we render an inline empty-state below.
// A dedicated `/onboarding` route does not exist yet — flag for a follow-up.

export default async function DriveRootPage() {
  const userId = await getRequiredUserId();

  const library = await getDefaultLibrary(userId);
  if (!library) {
    return (
      <div className="flex h-full items-center justify-center p-10">
        <div className="text-center">
          <p className="font-display text-xl">No library yet</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Create your first library to get started.
          </p>
        </div>
      </div>
    );
  }

  const [contents, allFolders] = await Promise.all([
    listFolderContents(library.id, userId, null),
    listAllFolders(library.id, userId),
  ]);

  return (
    <div>
      <FileBrowser
        libraryId={library.id}
        libraryName={library.name}
        folderId={null}
        folderChain={[]}
        contents={serializeFolderContents(contents)}
        folders={allFolders}
        isTrashView={false}
      />
    </div>
  );
}
