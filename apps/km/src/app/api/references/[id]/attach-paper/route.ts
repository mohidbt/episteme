import { z } from "zod";
import { requireNonGuestAuthed } from "@/lib/auth/require-non-guest";
import { jsonError } from "@/lib/crud";
import {
  attachReferenceToPaper,
  detachReferenceFromPaper,
} from "@/lib/citations/manual-attach";

// O2: restore manual paper attach + disconnect for /r/[id]. Deleted in
// b8b7556 alongside ReferenceAttachToPaperButton; this route gives the
// restored UI a dedicated semantic endpoint so the contract is explicit
// (manual identity edge) rather than overloaded onto the general PATCH.

type Ctx = { params: Promise<{ id: string }> };

const attachBody = z.object({ paperId: z.string().uuid() }).strict();

export async function POST(req: Request, { params }: Ctx) {
  const rawBody = await req.text();
  const gate = await requireNonGuestAuthed(req, rawBody);
  if (!gate.ok) return gate.response;
  const userId = gate.userId;
  const { id } = await params;

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonError(400, "validation", { message: "invalid json" });
  }
  const parsed = attachBody.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation", { issues: parsed.error.issues });
  }

  const result = await attachReferenceToPaper(id, userId, parsed.data.paperId);
  if (!result.ok) {
    if (result.reason === "reference_not_owned") return jsonError(404, "not_found");
    if (result.reason === "paper_not_found") return jsonError(404, "paper_not_found");
    if (result.reason === "paper_not_owned") return jsonError(403, "forbidden");
  }
  return Response.json({ ok: true, paperId: (result as { paperId: string }).paperId });
}

export async function DELETE(req: Request, { params }: Ctx) {
  // Read body (may be empty) so HMAC signature verification matches.
  const rawBody = await req.text();
  const gate = await requireNonGuestAuthed(req, rawBody);
  if (!gate.ok) return gate.response;
  const userId = gate.userId;
  const { id } = await params;

  const result = await detachReferenceFromPaper(id, userId);
  if (!result.ok) return jsonError(404, "not_found");
  return new Response(null, { status: 204 });
}
