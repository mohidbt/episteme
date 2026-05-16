import { db } from "../../src";
import { sql } from "drizzle-orm";

export const SEED_USER = "test-graph-user";
export const SEED_OTHER_USER = "test-graph-other-user";

export const SEED_IDS = {
  p1: "11111111-1111-1111-1111-111111111111",
  p2: "22222222-2222-2222-2222-222222222222",
  r1: "33333333-3333-3333-3333-333333333333",
  n1: "44444444-4444-4444-4444-444444444444",
  n2: "55555555-5555-5555-5555-555555555555",
  pOther: "66666666-6666-6666-6666-666666666666",
};

export async function seedGraphFixture() {
  await db.execute(sql`DELETE FROM note_links WHERE source_note_id IN (SELECT id FROM notes WHERE user_id IN (${SEED_USER}, ${SEED_OTHER_USER}))`);
  await db.execute(sql`DELETE FROM note_tags WHERE note_id IN (SELECT id FROM notes WHERE user_id IN (${SEED_USER}, ${SEED_OTHER_USER}))`);
  await db.execute(sql`DELETE FROM paper_citations WHERE citer_id IN (SELECT id::text FROM papers WHERE user_id IN (${SEED_USER}, ${SEED_OTHER_USER})) OR cited_id IN (SELECT id::text FROM papers WHERE user_id IN (${SEED_USER}, ${SEED_OTHER_USER}))`);
  await db.execute(sql`DELETE FROM "references" WHERE user_id IN (${SEED_USER}, ${SEED_OTHER_USER})`);
  await db.execute(sql`DELETE FROM notes  WHERE user_id IN (${SEED_USER}, ${SEED_OTHER_USER})`);
  await db.execute(sql`DELETE FROM papers WHERE user_id IN (${SEED_USER}, ${SEED_OTHER_USER})`);

  await db.execute(sql`
    INSERT INTO "user" (id, email, name, email_verified, created_at, updated_at)
    VALUES (${SEED_USER}, 'graph@test.local', 'graph-test', true, now(), now())
    ON CONFLICT (id) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO libraries (user_id, name) VALUES (${SEED_USER}, 'graph-test')
    ON CONFLICT DO NOTHING
  `);
  const libRes = await db.execute(sql`SELECT id FROM libraries WHERE user_id = ${SEED_USER} LIMIT 1`);
  const libId = (libRes as any).rows?.[0]?.id ?? (libRes as any)[0]?.id;

  const { p1, p2, r1, n1, n2 } = SEED_IDS;

  await db.execute(sql`
    INSERT INTO papers (id, user_id, library_id, filename, title)
    VALUES (${p1}, ${SEED_USER}, ${libId}, 'p1.pdf', 'Paper 1'),
           (${p2}, ${SEED_USER}, ${libId}, 'p2.pdf', 'Paper 2')
  `);
  await db.execute(sql`
    INSERT INTO "references" (id, library_id, user_id, citation_key, csl_json, paper_id)
    VALUES (${r1}, ${libId}, ${SEED_USER}, 'k1', '{"title":"Ref of P2"}'::jsonb, ${p2})
  `);
  await db.execute(sql`
    INSERT INTO notes (id, user_id, library_id, title, slug, content_md)
    VALUES (${n1}, ${SEED_USER}, ${libId}, 'Note A', 'note-a-graph', 'a'),
           (${n2}, ${SEED_USER}, ${libId}, 'Note B', 'note-b-graph', 'b')
  `);
  await db.execute(sql`
    INSERT INTO note_links (source_note_id, target_kind, target_id, target_title_raw)
    VALUES (${n1}, 'paper', ${p1}, 'Paper 1'),
           (${n1}, 'reference', ${r1}, 'Ref of P2')
  `);
  await db.execute(sql`
    INSERT INTO note_tags (note_id, tag) VALUES (${n1}, 'foo'), (${n2}, 'foo')
  `);

  return { user: SEED_USER, libId, p1, p2, r1, n1, n2 };
}

export async function seedPaperCitationsFixture() {
  const { p1, p2, r1, pOther } = SEED_IDS;

  await db.execute(sql`
    INSERT INTO "user" (id, email, name, email_verified, created_at, updated_at)
    VALUES (${SEED_OTHER_USER}, 'graph-other@test.local', 'graph-other', true, now(), now())
    ON CONFLICT (id) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO libraries (user_id, name) VALUES (${SEED_OTHER_USER}, 'graph-other')
    ON CONFLICT DO NOTHING
  `);
  const libRes = await db.execute(sql`SELECT id FROM libraries WHERE user_id = ${SEED_OTHER_USER} LIMIT 1`);
  const otherLibId = (libRes as any).rows?.[0]?.id ?? (libRes as any)[0]?.id;
  await db.execute(sql`
    INSERT INTO papers (id, user_id, library_id, filename, title)
    VALUES (${pOther}, ${SEED_OTHER_USER}, ${otherLibId}, 'pother.pdf', 'Other-user Paper')
    ON CONFLICT (id) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO paper_citations (citer_kind, citer_id, cited_kind, cited_id, match_method)
    VALUES
      ('paper', ${p1}, 'paper', ${p2}, 'doi'),
      ('paper', ${p1}, 'reference', ${r1}, 'manual'),
      ('paper', ${p1}, 'paper', ${pOther}, 'doi')
    ON CONFLICT DO NOTHING
  `);

  return { pOther };
}
