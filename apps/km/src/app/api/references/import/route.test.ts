import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { POST } from "./route";
import { POST as POST_LIB } from "../../libraries/route";
import {
  createTestUser,
  deleteTestUser,
  req,
  type TestUser,
} from "../../_test-utils";
import { db } from "@/lib/db";
import { references_ } from "@episteme/db/schema";

let u: TestUser;
let other: TestUser;

beforeAll(async () => {
  u = await createTestUser();
  other = await createTestUser();
});

afterAll(async () => {
  await deleteTestUser(u.id);
  await deleteTestUser(other.id);
});

async function newLibrary(cookie: string, name: string): Promise<number> {
  const r = await POST_LIB(
    req("/api/libraries", { method: "POST", cookie, body: JSON.stringify({ name }) }),
  );
  return (await r.json()).id;
}

function importReq(form: FormData, cookie?: string): Request {
  return req("/api/references/import", { method: "POST", cookie, body: form });
}

function fileFrom(content: string, name: string, type = "text/plain"): File {
  return new File([content], name, { type });
}

async function readFixture(name: string): Promise<string> {
  return await readFile(join(process.cwd(), "e2e/fixtures", name), "utf-8");
}

describe("references/import", () => {
  it("401 when no cookie", async () => {
    const libId = await newLibrary(u.cookie, "L401");
    const form = new FormData();
    form.set("libraryId", String(libId));
    form.set("file", fileFrom("@article{x,title={T}}", "x.bib"));
    const r = await POST(importReq(form));
    expect(r.status).toBe(401);
  });

  it("403 when user has no ownership on libraryId", async () => {
    const libId = await newLibrary(u.cookie, "Lown");
    const form = new FormData();
    form.set("libraryId", String(libId));
    form.set("file", fileFrom("@article{x,title={T}}", "x.bib"));
    const r = await POST(importReq(form, other.cookie));
    expect(r.status).toBe(403);
  });

  it("400 on unknown file format", async () => {
    const libId = await newLibrary(u.cookie, "Lfmt");
    const form = new FormData();
    form.set("libraryId", String(libId));
    form.set("file", fileFrom("col1,col2\n1,2\n", "data.csv"));
    const r = await POST(importReq(form, u.cookie));
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe("unknown_format");
  });

  it("imports vaswani.bib alone", async () => {
    const libId = await newLibrary(u.cookie, "Lbib");
    const bib = await readFixture("vaswani.bib");
    const form = new FormData();
    form.set("libraryId", String(libId));
    form.set("file", fileFrom(bib, "vaswani.bib"));
    const r = await POST(importReq(form, u.cookie));
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body).toEqual({ imported: 1, skipped: 0, conflicts: [] });

    const rows = await db.select().from(references_).where(eq(references_.libraryId, libId));
    expect(rows).toHaveLength(1);
    expect(rows[0].citationKey).toMatch(/^vaswani2017/);
  });

  it("imports refs.ris alone into empty library", async () => {
    const libId = await newLibrary(u.cookie, "Lris");
    const ris = await readFixture("refs.ris");
    const form = new FormData();
    form.set("libraryId", String(libId));
    form.set("file", fileFrom(ris, "refs.ris"));
    const r = await POST(importReq(form, u.cookie));
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body).toEqual({ imported: 2, skipped: 0, conflicts: [] });
  });

  it("imports vaswani.bib then refs.ris — RIS Vaswani dedupes, BERT imports", async () => {
    const libId = await newLibrary(u.cookie, "Lboth");
    const bib = await readFixture("vaswani.bib");
    const ris = await readFixture("refs.ris");

    const form1 = new FormData();
    form1.set("libraryId", String(libId));
    form1.set("file", fileFrom(bib, "vaswani.bib"));
    const r1 = await POST(importReq(form1, u.cookie));
    expect(r1.status).toBe(201);
    expect((await r1.json()).imported).toBe(1);

    const form2 = new FormData();
    form2.set("libraryId", String(libId));
    form2.set("file", fileFrom(ris, "refs.ris"));
    const r2 = await POST(importReq(form2, u.cookie));
    expect(r2.status).toBe(201);
    const body = await r2.json();
    expect(body.imported).toBe(1);
    expect(body.skipped).toBe(1);
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0].reason).toBe("duplicate_doi");

    const rows = await db
      .select()
      .from(references_)
      .where(eq(references_.libraryId, libId));
    expect(rows).toHaveLength(2);
    const dois = rows.map((r) => (r.cslJson as any)?.DOI).sort();
    expect(dois).toEqual(
      ["10.48550/arXiv.1706.03762", "10.48550/arXiv.1810.04805"].sort(),
    );
  });

  it("importing vaswani.bib twice into the same library dedupes by DOI", async () => {
    const libId = await newLibrary(u.cookie, "Ldup");
    const bib = await readFixture("vaswani.bib");

    const form1 = new FormData();
    form1.set("libraryId", String(libId));
    form1.set("file", fileFrom(bib, "vaswani.bib"));
    const r1 = await POST(importReq(form1, u.cookie));
    expect(r1.status).toBe(201);
    expect((await r1.json()).imported).toBe(1);

    const form2 = new FormData();
    form2.set("libraryId", String(libId));
    form2.set("file", fileFrom(bib, "vaswani.bib"));
    const r2 = await POST(importReq(form2, u.cookie));
    expect(r2.status).toBe(201);
    const body = await r2.json();
    expect(body.imported).toBe(0);
    expect(body.skipped).toBe(1);
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0].reason).toBe("duplicate_doi");
  });

  it("imports a CSL-JSON single object (not array)", async () => {
    const libId = await newLibrary(u.cookie, "Ljson1");
    const csl = {
      id: "a",
      type: "article",
      title: "T",
      DOI: `10.1/x${Date.now()}`,
    };
    const form = new FormData();
    form.set("libraryId", String(libId));
    form.set("file", fileFrom(JSON.stringify(csl), "single.json"));
    const r = await POST(importReq(form, u.cookie));
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.imported).toBe(1);
  });

  it("400 on CSL-JSON with missing id field", async () => {
    const libId = await newLibrary(u.cookie, "Ljsonbad");
    const csl = [{ type: "article", title: "no id" }];
    const form = new FormData();
    form.set("libraryId", String(libId));
    form.set("file", fileFrom(JSON.stringify(csl), "bad.json"));
    const r = await POST(importReq(form, u.cookie));
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe("parse_failed");
  });
});
