export default async function PaperPage({
  params,
}: {
  params: Promise<{ paperId: string }>;
}) {
  const { paperId } = await params;
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="font-display text-2xl mb-3">Paper #{paperId}</h1>
      <p className="text-muted-foreground">Paper stub — Phase 0.4</p>
    </div>
  );
}
