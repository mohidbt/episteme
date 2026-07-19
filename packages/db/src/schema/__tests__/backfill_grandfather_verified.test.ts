/**
 * GSD-142: grandfather existing real (non-anonymous) accounts before the
 * email-verification hard-block ships.
 *
 * Verifies migration 0062_grandfather_verified_users against a live Postgres
 * test DB. Skips when DATABASE_URL not set (mirrors backfill_library_names).
 *
 * The migration is a one-shot data-only UPDATE. This test seeds three users —
 * a non-anon unverified (must flip), an anonymous unverified (must stay
 * false, gate exempts anon), and an already-verified user (untouched) — runs
 * the migration SQL inline, and asserts only the non-anon unverified row
 * flipped to email_verified=true.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DB_URL = process.env.DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

const TEST_PREFIX = "test-gsd142-grandfather";

describeDb("0062 grandfather verified users migration", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any;
  let realUnverified: string;
  let anonUnverified: string;
  let alreadyVerified: string;
  let migrationSql: string;

  beforeAll(async () => {
    const postgres = await import("postgres");
    client = postgres.default(DB_URL!);

    migrationSql = readFileSync(
      resolve(__dirname, "../../../drizzle/0062_grandfather_verified_users.sql"),
      "utf8",
    );

    realUnverified = `${TEST_PREFIX}-real`;
    anonUnverified = `${TEST_PREFIX}-anon`;
    alreadyVerified = `${TEST_PREFIX}-verified`;

    const ids = [realUnverified, anonUnverified, alreadyVerified];
    await client`DELETE FROM "user" WHERE id IN ${client(ids)}`;

    await client`
      INSERT INTO "user" (id, name, email, email_verified, is_anonymous, created_at, updated_at)
      VALUES
        (${realUnverified},  'Real',  ${realUnverified + "@test"},  false, false, now(), now()),
        (${anonUnverified},  'Anon',  ${anonUnverified + "@test"},  false, true,  now(), now()),
        (${alreadyVerified}, 'Done',  ${alreadyVerified + "@test"}, true,  false, now(), now())
    `;
  });

  afterAll(async () => {
    const ids = [realUnverified, anonUnverified, alreadyVerified];
    await client`DELETE FROM "user" WHERE id IN ${client(ids)}`;
    await client.end({ timeout: 5 });
  });

  it("flips non-anon unverified users to verified", async () => {
    await client.unsafe(migrationSql);
    const [row] = await client`
      SELECT email_verified FROM "user" WHERE id = ${realUnverified}
    `;
    expect(row.email_verified).toBe(true);
  });

  it("leaves anonymous users untouched", async () => {
    const [row] = await client`
      SELECT email_verified FROM "user" WHERE id = ${anonUnverified}
    `;
    expect(row.email_verified).toBe(false);
  });

  it("leaves already-verified users untouched", async () => {
    const [row] = await client`
      SELECT email_verified FROM "user" WHERE id = ${alreadyVerified}
    `;
    expect(row.email_verified).toBe(true);
  });
});
