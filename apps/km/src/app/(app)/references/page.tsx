import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@episteme/auth";
import { getDefaultLibrary } from "@/lib/default-library";
import { listReferences } from "@/lib/references-server";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ReferenceTable } from "@/components/ReferenceTable";
import { ReferenceDoiInput } from "@/components/ReferenceDoiInput";

export default async function ReferencesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/sign-in");
  const library = await getDefaultLibrary(session.user.id);
  if (!library) redirect("/");
  const rows = await listReferences(library.id, session.user.id, "");

  return (
    <div className="p-6">
      <Breadcrumbs libraryName={library.name} section="references" folderPath="" />
      <ReferenceDoiInput libraryId={library.id} folderPath="" />
      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-10">
          <div className="text-center">
            <p className="font-display text-xl">No references yet</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Add one by entering a DOI above.
            </p>
          </div>
        </div>
      ) : (
        <ReferenceTable rows={rows} />
      )}
    </div>
  );
}
