import { getPublicNote } from "../_loader";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ user: string; slug: string }> },
) {
  const { user, slug } = await params;
  const row = await getPublicNote(user, slug);
  if (!row) return new Response("not found", { status: 404 });
  return new Response(row.contentMd, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
