import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@episteme/auth";
import { getDefaultLibrary } from "@/lib/default-library";
import { getReference } from "@/lib/references-server";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ReferenceForm } from "@/components/ReferenceForm";

export default async function ReferencePage({
  params,
}: {
  params: Promise<{ referenceId: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/sign-in");
  const { referenceId } = await params;
  const [ref, library] = await Promise.all([
    getReference(referenceId, session.user.id),
    getDefaultLibrary(session.user.id),
  ]);
  if (!ref) notFound();

  return (
    <div className="mx-auto max-w-3xl p-6">
      {library && (
        <Breadcrumbs
          libraryName={library.name}
          section="references"
          folderPath={ref.folderPath}
          title={ref.citationKey}
        />
      )}
      <ReferenceForm reference={ref} />
    </div>
  );
}
