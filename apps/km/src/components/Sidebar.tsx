import { getDefaultLibrary } from "@/lib/default-library";
import { getTreeForUser } from "@/lib/tree-server";
import { SidebarShell } from "./SidebarShell";
import { CreateLibraryEmptyState } from "./CreateLibraryEmptyState";

export async function Sidebar({
  userId,
  isAnonymous,
}: {
  userId: string;
  isAnonymous: boolean;
}) {
  const library = await getDefaultLibrary(userId);
  if (!library) return <CreateLibraryEmptyState />;
  const tree = await getTreeForUser(library.id, userId);
  if (!tree) return <CreateLibraryEmptyState />;
  return (
    <SidebarShell
      library={{ id: library.id, name: library.name }}
      tree={tree}
      isAnonymous={isAnonymous}
    />
  );
}
