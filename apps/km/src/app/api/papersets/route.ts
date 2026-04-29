import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { papersets } from "@episteme/db/schema";
import { getAuthedUserId, MissingInternalSecretError } from "@/lib/internal-auth";
import { getDefaultLibrary } from "@/lib/default-library";
import { jsonError } from "@/lib/crud";

export const runtime = "nodejs";

const ColumnSpec = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
});

const CreateBody = z.object({
  filename: z
    .string()
    .min(1)
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, { message: "filename empty" })
    .refine((s) => !s.includes("/") && !s.includes("\\"), {
      message: "filename must not contain path separators",
    }),
  folderId: z.string().uuid().nullable().optional(),
  columns: z.array(ColumnSpec).min(1),
});

function misconfiguredResponse(): Response {
  return jsonError(500, "internal auth misconfigured");
}

export async function GET(req: Request) {
  let authed;
  try { authed = await getAuthedUserId(req); }
  catch (e) {
    if (e instanceof MissingInternalSecretError) return misconfiguredResponse();
    throw e;
  }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;
  const rows = await db
    .select()
    .from(papersets)
    .where(eq(papersets.userId, userId))
    .orderBy(desc(papersets.updatedAt));
  return Response.json(rows);
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  let authed;
  try { authed = await getAuthedUserId(req, rawBody); }
  catch (e) {
    if (e instanceof MissingInternalSecretError) return misconfiguredResponse();
    throw e;
  }
  if (!authed) return jsonError(401, "unauthorized");
  const userId = authed.userId;

  let body: unknown = null;
  try { body = JSON.parse(rawBody); } catch { /* body=null → validation 400 */ }
  const parsed = CreateBody.safeParse(body);
  if (!parsed.success) return jsonError(400, "validation", { issues: parsed.error.issues });

  const lib = await getDefaultLibrary(userId);
  if (!lib) return jsonError(400, "no_library", { message: "user has no library" });

  const filename = parsed.data.filename.endsWith(".csv")
    ? parsed.data.filename
    : `${parsed.data.filename}.csv`;

  const [row] = await db
    .insert(papersets)
    .values({
      libraryId: lib.id,
      userId,
      folderId: parsed.data.folderId ?? null,
      filename,
      columns: parsed.data.columns,
      rowRefs: [],
      cellGrounding: {},
      runningCells: [],
      content: "",
    })
    .returning();

  return Response.json(row, { status: 201 });
}
