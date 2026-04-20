import postgres from "postgres";
import fs from "fs";
import path from "path";

// DATABASE_URL comes from apps/web/.env.local via the dev server already;
// Playwright runs node in the same shell env. Fall back to compose default
// so a missing var is loud rather than silent.
const DB_URL =
  process.env.DATABASE_URL ??
  "postgresql://inhale:inhale_dev@localhost:5432/inhale";

export interface TruthRect {
  x0: number;
  x1: number;
  top: number;
  bottom: number;
}

export interface Truth {
  fixturePages: number[];
  sourcePageMap: Record<string, number>;
  pageHeight: number[];
  pageWidth: number[];
  chemosensory: Record<string, TruthRect[]>;
  sentence: Record<string, TruthRect[]>;
  sentencePhrase: string;
}

export function loadTruth(): Truth {
  const p = path.join(__dirname, "..", "fixtures", "chemosensory-truth.json");
  return JSON.parse(fs.readFileSync(p, "utf-8")) as Truth;
}

// Convert pdfplumber top/bottom (from page top) → PDF y0/y1 (from page bottom).
export function toPdfRect(r: TruthRect, pageHeight: number, page: number) {
  return {
    page,
    x0: r.x0,
    x1: r.x1,
    y0: pageHeight - r.bottom,
    y1: pageHeight - r.top,
  };
}

interface SeedArgs {
  documentId: number;
  userId: string;
  instruction: string;
  highlights: Array<{
    pageNumber: number;
    textContent: string;
    rects: Array<{ page: number; x0: number; y0: number; x1: number; y1: number }>;
  }>;
}

export async function seedAutoHighlightRun(args: SeedArgs): Promise<string> {
  const sql = postgres(DB_URL);
  try {
    const [run] = await sql`
      INSERT INTO ai_highlight_runs
        (document_id, user_id, instruction, status, model_used, summary, completed_at)
      VALUES
        (${args.documentId}, ${args.userId}, ${args.instruction}, 'completed',
         'stub', 'seeded for e2e', now())
      RETURNING id
    `;
    const runId = run.id as string;
    for (const h of args.highlights) {
      await sql`
        INSERT INTO user_highlights
          (user_id, document_id, page_number, text_content, start_offset,
           end_offset, color, source, layer_id, rects)
        VALUES
          (${args.userId}, ${args.documentId}, ${h.pageNumber},
           ${h.textContent}, 0, ${h.textContent.length}, 'amber', 'ai-auto',
           ${runId}::uuid, ${sql.json(h.rects)})
      `;
    }
    return runId;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

export async function getUserIdByEmail(email: string): Promise<string> {
  const sql = postgres(DB_URL);
  try {
    const rows = await sql`SELECT id FROM "user" WHERE email = ${email} LIMIT 1`;
    if (!rows.length) throw new Error(`no user ${email}`);
    return rows[0].id as string;
  } finally {
    await sql.end({ timeout: 2 });
  }
}
