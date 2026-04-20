/**
 * Task A (Phase 2.2): Enriched citations schema tests.
 *
 * Static tests (no DB): check Drizzle schema definitions. Fail before schema edits, pass after.
 * DB round-trip tests: verify migration ran correctly.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { documentReferences } from "../document-references";
import { libraryReferences } from "../library-references";

// ---------------------------------------------------------------------------
// Static schema tests — fail before schema edits, pass after
// ---------------------------------------------------------------------------

describe("documentReferences — S2 enrichment columns", () => {
  const config = getTableConfig(documentReferences);
  const colNames = config.columns.map((c) => c.name);
  const colMap = Object.fromEntries(config.columns.map((c) => [c.name, c]));

  it("has influential_citation_count (int, nullable)", () => {
    expect(colNames).toContain("influential_citation_count");
    expect(colMap["influential_citation_count"].notNull).toBe(false);
    expect(colMap["influential_citation_count"].columnType).toBe("PgInteger");
  });

  it("has open_access_pdf_url (text, nullable)", () => {
    expect(colNames).toContain("open_access_pdf_url");
    expect(colMap["open_access_pdf_url"].notNull).toBe(false);
    expect(colMap["open_access_pdf_url"].columnType).toBe("PgText");
  });

  it("has tldr_text (text, nullable)", () => {
    expect(colNames).toContain("tldr_text");
    expect(colMap["tldr_text"].notNull).toBe(false);
    expect(colMap["tldr_text"].columnType).toBe("PgText");
  });

  it("has external_ids (jsonb, nullable)", () => {
    expect(colNames).toContain("external_ids");
    expect(colMap["external_ids"].notNull).toBe(false);
    expect(colMap["external_ids"].columnType).toBe("PgJsonb");
  });

  it("has bibtex (text, nullable)", () => {
    expect(colNames).toContain("bibtex");
    expect(colMap["bibtex"].notNull).toBe(false);
    expect(colMap["bibtex"].columnType).toBe("PgText");
  });

  it("authors is jsonb (not text)", () => {
    expect(colMap["authors"].columnType).toBe("PgJsonb");
  });
});

describe("libraryReferences — S2 enrichment columns", () => {
  const config = getTableConfig(libraryReferences);
  const colNames = config.columns.map((c) => c.name);
  const colMap = Object.fromEntries(config.columns.map((c) => [c.name, c]));

  it("has influential_citation_count (int, nullable)", () => {
    expect(colNames).toContain("influential_citation_count");
    expect(colMap["influential_citation_count"].notNull).toBe(false);
    expect(colMap["influential_citation_count"].columnType).toBe("PgInteger");
  });

  it("has open_access_pdf_url (text, nullable)", () => {
    expect(colNames).toContain("open_access_pdf_url");
    expect(colMap["open_access_pdf_url"].notNull).toBe(false);
    expect(colMap["open_access_pdf_url"].columnType).toBe("PgText");
  });

  it("has tldr_text (text, nullable)", () => {
    expect(colNames).toContain("tldr_text");
    expect(colMap["tldr_text"].notNull).toBe(false);
    expect(colMap["tldr_text"].columnType).toBe("PgText");
  });

  it("has external_ids (jsonb, nullable)", () => {
    expect(colNames).toContain("external_ids");
    expect(colMap["external_ids"].notNull).toBe(false);
    expect(colMap["external_ids"].columnType).toBe("PgJsonb");
  });

  it("has bibtex (text, nullable)", () => {
    expect(colNames).toContain("bibtex");
    expect(colMap["bibtex"].notNull).toBe(false);
    expect(colMap["bibtex"].columnType).toBe("PgText");
  });

  it("authors is jsonb (not text)", () => {
    expect(colMap["authors"].columnType).toBe("PgJsonb");
  });
});

// ---------------------------------------------------------------------------
// DB round-trip tests — require live DB; skip if DATABASE_URL not set
// ---------------------------------------------------------------------------

const DB_URL = process.env.DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

const TEST_USER_ID = "test-enriched-schema-2-2-a";

describeDb("DB round-trip: documentReferences enriched columns", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any;
  let insertedRefId: number;
  let insertedDocId: number;

  beforeAll(async () => {
    const postgres = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const schema = await import("../index");
    const { eq, sql } = await import("drizzle-orm");

    client = postgres.default(DB_URL!);
    db = drizzle({ client, schema });

    // Create test user (upsert to be idempotent)
    await client`
      INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES (${TEST_USER_ID}, 'Test Enriched', 'test-enriched-2-2-a@example.com', true, now(), now())
      ON CONFLICT (id) DO NOTHING
    `;

    // Create test document
    const [doc] = await client`
      INSERT INTO documents (user_id, title, filename, file_path, file_size_bytes, processing_status)
      VALUES (${TEST_USER_ID}, 'Test Doc Enriched', 'test-enriched.pdf', '/dev/null', 0, 'pending')
      RETURNING id
    `;
    insertedDocId = doc.id;

    const [row] = await db
      .insert(schema.documentReferences)
      .values({
        documentId: insertedDocId,
        markerText: "[1]",
        markerIndex: 0,
        authors: [{ name: "Alice", authorId: "a-123" }, { name: "Bob" }],
        tldrText: "A landmark paper on things.",
        externalIds: { DOI: "10.x/y", ArXiv: "2001.12345" },
        influentialCitationCount: 42,
        openAccessPdfUrl: "https://example.com/paper.pdf",
        bibtex: "@article{alice2024, title={Test}}",
      })
      .returning({ id: schema.documentReferences.id });

    insertedRefId = row.id;
  });

  afterAll(async () => {
    if (client) {
      if (insertedRefId) {
        await client`DELETE FROM document_references WHERE id = ${insertedRefId}`;
      }
      if (insertedDocId) {
        await client`DELETE FROM documents WHERE id = ${insertedDocId}`;
      }
      await client`DELETE FROM "user" WHERE id = ${TEST_USER_ID}`;
      await client.end();
    }
  });

  it("round-trips authors as jsonb array", async () => {
    const schema = await import("../index");
    const { eq } = await import("drizzle-orm");
    const [row] = await db
      .select()
      .from(schema.documentReferences)
      .where(eq(schema.documentReferences.id, insertedRefId));

    expect(row.authors).toEqual([
      { name: "Alice", authorId: "a-123" },
      { name: "Bob" },
    ]);
  });

  it("round-trips tldr_text, external_ids, and other S2 fields", async () => {
    const schema = await import("../index");
    const { eq } = await import("drizzle-orm");
    const [row] = await db
      .select()
      .from(schema.documentReferences)
      .where(eq(schema.documentReferences.id, insertedRefId));

    expect(row.tldrText).toBe("A landmark paper on things.");
    expect(row.externalIds).toEqual({ DOI: "10.x/y", ArXiv: "2001.12345" });
    expect(row.influentialCitationCount).toBe(42);
    expect(row.openAccessPdfUrl).toBe("https://example.com/paper.pdf");
    expect(row.bibtex).toBe("@article{alice2024, title={Test}}");
  });
});

describeDb("DB round-trip: libraryReferences enriched columns", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any;
  let insertedId: number;

  beforeAll(async () => {
    const postgres = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const schema = await import("../index");

    client = postgres.default(DB_URL!);
    db = drizzle({ client, schema });

    // Create test user (upsert to be idempotent)
    await client`
      INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES (${TEST_USER_ID}, 'Test Enriched', 'test-enriched-2-2-a@example.com', true, now(), now())
      ON CONFLICT (id) DO NOTHING
    `;

    const [row] = await db
      .insert(schema.libraryReferences)
      .values({
        userId: TEST_USER_ID,
        title: "Test Paper for Enriched Schema",
        authors: [{ name: "Carol", authorId: "c-456" }, { name: "Dave" }],
        tldrText: "Another landmark paper.",
        externalIds: { DOI: "10.y/z", PubMed: "99999999" },
        influentialCitationCount: 7,
        openAccessPdfUrl: "https://example.com/carol.pdf",
        bibtex: "@article{carol2024, title={Carol Test}}",
      })
      .returning({ id: schema.libraryReferences.id });

    insertedId = row.id;
  });

  afterAll(async () => {
    if (client) {
      if (insertedId) {
        await client`DELETE FROM library_references WHERE id = ${insertedId}`;
      }
      await client`DELETE FROM "user" WHERE id = ${TEST_USER_ID}`;
      await client.end();
    }
  });

  it("round-trips authors as jsonb array", async () => {
    const schema = await import("../index");
    const { eq } = await import("drizzle-orm");
    const [row] = await db
      .select()
      .from(schema.libraryReferences)
      .where(eq(schema.libraryReferences.id, insertedId));

    expect(row.authors).toEqual([
      { name: "Carol", authorId: "c-456" },
      { name: "Dave" },
    ]);
  });

  it("round-trips tldr_text, external_ids, and other S2 fields", async () => {
    const schema = await import("../index");
    const { eq } = await import("drizzle-orm");
    const [row] = await db
      .select()
      .from(schema.libraryReferences)
      .where(eq(schema.libraryReferences.id, insertedId));

    expect(row.tldrText).toBe("Another landmark paper.");
    expect(row.externalIds).toEqual({ DOI: "10.y/z", PubMed: "99999999" });
    expect(row.influentialCitationCount).toBe(7);
    expect(row.openAccessPdfUrl).toBe("https://example.com/carol.pdf");
    expect(row.bibtex).toBe("@article{carol2024, title={Carol Test}}");
  });
});
