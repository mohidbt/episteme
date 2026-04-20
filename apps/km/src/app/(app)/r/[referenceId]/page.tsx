export default async function ReferencePage({
  params,
}: {
  params: Promise<{ referenceId: string }>;
}) {
  const { referenceId } = await params;
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="font-display text-2xl mb-3">Reference #{referenceId}</h1>
      <p className="text-muted-foreground">Reference stub — Phase 0.4</p>
    </div>
  );
}
