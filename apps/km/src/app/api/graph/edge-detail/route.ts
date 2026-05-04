import { NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/auth';
import { db } from '@episteme/db/client';
import { sql } from 'drizzle-orm';
import { rowsOf } from '@/lib/db/rows';

const CHUNK = {
  paper: { table: 'paper_chunks', ownerCol: 'paper_id' },
  note:  { table: 'note_chunks',  ownerCol: 'note_id'  },
} as const;

export async function GET(req: Request) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const u = new URL(req.url);
  const srcKind = u.searchParams.get('srcKind') ?? '';
  const dstKind = u.searchParams.get('dstKind') ?? '';
  const srcId = u.searchParams.get('srcId');
  const dstId = u.searchParams.get('dstId');
  if (!srcId || !dstId) return NextResponse.json({ error: 'bad request' }, { status: 400 });

  if (CHUNK[srcKind as keyof typeof CHUNK] && CHUNK[dstKind as keyof typeof CHUNK]) {
    const s = CHUNK[srcKind as keyof typeof CHUNK];
    const d = CHUNK[dstKind as keyof typeof CHUNK];
    const r = await db.execute(sql`
      SELECT sc.content AS src_excerpt, dc.content AS dst_excerpt,
             1 - (sc.embedding <=> dc.embedding) AS cosine
      FROM ${sql.raw(s.table)} sc
      JOIN ${sql.raw(d.table)} dc
        ON sc.${sql.raw(s.ownerCol)} = ${srcId}::uuid
       AND dc.${sql.raw(d.ownerCol)} = ${dstId}::uuid
      ORDER BY cosine DESC LIMIT 1
    `);
    const row = rowsOf<{ src_excerpt: string; dst_excerpt: string; cosine: number }>(r)[0];
    return NextResponse.json(row ?? { src_excerpt: '', dst_excerpt: '', cosine: 0 });
  }

  if (CHUNK[srcKind as keyof typeof CHUNK] && dstKind === 'reference') {
    const s = CHUNK[srcKind as keyof typeof CHUNK];
    const r = await db.execute(sql`
      SELECT sc.content AS src_excerpt,
             (SELECT csl_json->>'title' FROM "references" WHERE id = ${dstId}::uuid) AS dst_excerpt,
             1 - (sc.embedding <=> (SELECT embedding FROM reference_embeddings WHERE reference_id = ${dstId}::uuid)) AS cosine
      FROM ${sql.raw(s.table)} sc
      WHERE sc.${sql.raw(s.ownerCol)} = ${srcId}::uuid
      ORDER BY cosine DESC LIMIT 1
    `);
    const row = rowsOf<{ src_excerpt: string; dst_excerpt: string; cosine: number }>(r)[0];
    return NextResponse.json(row ?? { src_excerpt: '', dst_excerpt: '', cosine: 0 });
  }

  return NextResponse.json({ error: 'unsupported edge endpoints' }, { status: 400 });
}
