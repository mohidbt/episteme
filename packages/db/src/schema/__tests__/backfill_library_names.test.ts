/**
 * A2: Backfill library names from user.name first token.
 *
 * Verifies migration 0032_backfill_library_names against a live Postgres
 * test DB. Skips when DATABASE_URL not set (mirrors pattern in
 * src/schema/__tests__/references-schema-enriched.test.ts).
 *
 * The migration is a one-shot data-only UPDATE; this test seeds three
 * libraries with default + custom names, runs the migration SQL inline,
 * and asserts only the default-named rows were updated.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DB_URL = process.env.DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

const TEST_PREFIX = "test-a2-backfill";

describeDb("0032 backfill library names migration", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any;
  let userWithName: string;
  let userNullName: string;
  let userCustom: string;
  let libIdNamed: number;
  let libIdNull: number;
  let libIdCustom: number;
  let migrationSql: string;

  beforeAll(async () => {
    const postgres = await import("postgres");
    client = postgres.default(DB_URL!);

    migrationSql = readFileSync(
      resolve(__dirname, "../../../drizzle/0032_backfill_library_names.sql"),
      "utf8",
    );

    userWithName = `${TEST_PREFIX}-named`;
    userNullName = `${TEST_PREFIX}-noname`;
    userCustom = `${TEST_PREFIX}-custom`;

    // Clean up any leftover state from prior runs (idempotent).
    await client`DELETE FROM libraries WHERE user_id IN (${userWithName}, ${userNullName}, ${userCustom})`;
    await client`DELETE FROM "user" WHERE id IN (${userWithName}, ${userNullName}, ${userCustom})`;

    // Seed users. user.name is NOT NULL in schema, so simulate the "null"
    // case with empty string — split_part('', ' ', 1) returns '', which is
    // what NULLIF coerces to NULL → COALESCE fallback fires.
    await client`
      INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES
        (${userWithName}, 'Mohid Butt',  ${userWithName + "@test"}, true, now(), now()),
        (${userNullName}, '',            ${userNullName + "@test"}, true, now(), now()),
        (${userCustom},   'Jane Doe',    ${userCustom   + "@test"}, true, now(), now())
    `;

    // Seed libraries — one per user (0030 enforces unique index on user_id).
    const [a] = await client`
      INSERT INTO libraries (user_id, name) VALUES (${userWithName}, 'My Library') RETURNING id
    `;
    libIdNamed = a.id;
    const [b] = await client`
      INSERT INTO libraries (user_id, name) VALUES (${userNullName}, 'Example Library') RETURNING id
    `;
    libIdNull = b.id;
    const [c] = await client`
      INSERT INTO libraries (user_id, name) VALUES (${userCustom}, 'Custom Name') RETURNING id
    `;
    libIdCustom = c.id;
  });

  afterAll(async () => {
    if (!client) return;
    await client`DELETE FROM libraries WHERE id IN (${libIdNamed}, ${libIdNull}, ${libIdCustom})`;
    await client`DELETE FROM "user" WHERE id IN (${userWithName}, ${userNullName}, ${userCustom})`;
    await client.end();
  });

  it("renames 'My Library' to '{firstname}'s Library' when user has a name", async () => {
    await client.unsafe(migrationSql);
    const [row] = await client`SELECT name FROM libraries WHERE id = ${libIdNamed}`;
    expect(row.name).toBe("Mohid's Library");
  });

  it("falls back to 'My's Library' when user.name is blank", async () => {
    // Already applied above. COALESCE(NULLIF(split_part('',' ',1),''),'My') → 'My'.
    const [row] = await client`SELECT name FROM libraries WHERE id = ${libIdNull}`;
    expect(row.name).toBe("My's Library");
  });

  it("does NOT touch libraries with custom names", async () => {
    const [row] = await client`SELECT name FROM libraries WHERE id = ${libIdCustom}`;
    expect(row.name).toBe("Custom Name");
  });

  it("is idempotent — second run is a no-op", async () => {
    await client.unsafe(migrationSql);
    const [a] = await client`SELECT name FROM libraries WHERE id = ${libIdNamed}`;
    const [b] = await client`SELECT name FROM libraries WHERE id = ${libIdNull}`;
    const [c] = await client`SELECT name FROM libraries WHERE id = ${libIdCustom}`;
    expect(a.name).toBe("Mohid's Library");
    expect(b.name).toBe("My's Library");
    expect(c.name).toBe("Custom Name");
  });
});
