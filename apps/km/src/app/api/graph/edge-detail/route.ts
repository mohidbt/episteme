import { NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/auth';
import { db } from '@episteme/db/client';
import { sql } from 'drizzle-orm';
import { rowsOf } from '@/lib/db/rows';

const CHUNK = {
  paper: { table: 'paper_chunks', ownerTable: 'papers', ownerCol: 'paper_id' },
  note:  { table: 'note_chunks',  ownerTable: 'notes', ownerCol: 'note_id'  },
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function notFound() {
  return NextResponse.json({ error: 'not found' }, { status: 404 });
}

export async function GET(req: Request) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const u = new URL(req.url);
  const srcKind = u.searchParams.get('srcKind') ?? '';
  const dstKind = u.searchParams.get('dstKind') ?? '';
  const srcId = u.searchParams.get('srcId');
  const dstId = u.searchParams.get('dstId');
  if (!srcId || !dstId || !UUID_RE.test(srcId) || !UUID_RE.test(dstId)) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }

  if (CHUNK[srcKind as keyof typeof CHUNK] && CHUNK[dstKind as keyof typeof CHUNK]) {
    const s = CHUNK[srcKind as keyof typeof CHUNK];
    const d = CHUNK[dstKind as keyof typeof CHUNK];
    const r = await db.execute(sql`
      SELECT sc.content AS src_excerpt, dc.content AS dst_excerpt,
             1 - (sc.embedding <=> dc.embedding) AS cosine
      FROM ${sql.raw(s.table)} sc
      JOIN ${sql.raw(s.ownerTable)} src_owner
        ON src_owner.id = sc.${sql.raw(s.ownerCol)}
       AND src_owner.user_id = ${userId}
      JOIN ${sql.raw(d.table)} dc
        ON dc.${sql.raw(d.ownerCol)} = ${dstId}::uuid
      JOIN ${sql.raw(d.ownerTable)} dst_owner
        ON dst_owner.id = dc.${sql.raw(d.ownerCol)}
       AND dst_owner.user_id = ${userId}
      WHERE sc.${sql.raw(s.ownerCol)} = ${srcId}::uuid
      ORDER BY cosine DESC LIMIT 1
    `);
    const row = rowsOf<{ src_excerpt: string; dst_excerpt: string; cosine: number }>(r)[0];
    return row ? NextResponse.json(row) : notFound();
  }

  if (CHUNK[srcKind as keyof typeof CHUNK] && dstKind === 'reference') {
    const s = CHUNK[srcKind as keyof typeof CHUNK];
    const r = await db.execute(sql`
      SELECT sc.content AS src_excerpt,
             dst_ref.csl_json->>'title' AS dst_excerpt,
             1 - (sc.embedding <=> dst_embedding.embedding) AS cosine
      FROM ${sql.raw(s.table)} sc
      JOIN ${sql.raw(s.ownerTable)} src_owner
        ON src_owner.id = sc.${sql.raw(s.ownerCol)}
       AND src_owner.user_id = ${userId}
      JOIN "references" dst_ref
        ON dst_ref.id = ${dstId}::uuid
       AND dst_ref.user_id = ${userId}
      LEFT JOIN reference_embeddings dst_embedding
        ON dst_embedding.reference_id = dst_ref.id
      WHERE sc.${sql.raw(s.ownerCol)} = ${srcId}::uuid
      ORDER BY cosine DESC LIMIT 1
    `);
    const row = rowsOf<{ src_excerpt: string; dst_excerpt: string; cosine: number }>(r)[0];
    return row ? NextResponse.json(row) : notFound();
  }

  return NextResponse.json({ error: 'unsupported edge endpoints' }, { status: 400 });
}
