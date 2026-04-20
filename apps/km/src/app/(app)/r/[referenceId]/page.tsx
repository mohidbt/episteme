import { headers } from "next/headers";
import { auth } from "@episteme/auth";
import { redirect } from "next/navigation";
import { getDefaultLibrary } from "@/lib/default-library";
import { Breadcrumbs } from "@/components/Breadcrumbs";

export default async function ReferencePage({
  params,
}: {
  params: Promise<{ referenceId: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/sign-in");
  const { referenceId } = await params;
  const library = await getDefaultLibrary(session.user.id);
  return (
    <div className="mx-auto max-w-3xl p-6">
      {library && (
        <Breadcrumbs
          libraryName={library.name}
          section="references"
          folderPath=""
          title={`Reference #${referenceId}`}
        />
      )}
      <h1 className="font-display text-2xl mb-3">Reference #{referenceId}</h1>
      <p className="text-muted-foreground">Reference stub — Phase 0.4</p>
    </div>
  );
}
