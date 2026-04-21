import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@episteme/auth";
import { getDefaultLibrary } from "@/lib/default-library";
import { listPapers } from "@/lib/papers-server";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { PaperGrid } from "@/components/PaperGrid";
import { PaperUploadDropzone } from "@/components/PaperUploadDropzone";

export default async function PapersPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/sign-in");
  const library = await getDefaultLibrary(session.user.id);
  if (!library) redirect("/");
  const rows = await listPapers(library.id, session.user.id, "");

  return (
    <div className="p-6">
      <Breadcrumbs libraryName={library.name} section="papers" folderPath="" />
      <PaperUploadDropzone libraryId={library.id} folderPath="" />
      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-10">
          <div className="text-center">
            <p className="font-display text-xl">No papers yet</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Drop a PDF above or click the + in the sidebar to upload.
            </p>
          </div>
        </div>
      ) : (
        <PaperGrid papers={rows} />
      )}
    </div>
  );
}
