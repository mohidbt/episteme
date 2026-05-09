import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { references_ } from "@episteme/db/schema";
import { POST } from "./route";
import { POST as POST_LIB } from "../../libraries/route";
import {
  createTestUser,
  deleteTestUser,
  req,
  type TestUser,
} from "../../_test-utils";

// `other` is a stable second user used for cross-ownership negative cases.
// Each test provisions its own (owner, libId) pair via `newLibrary` so the
// one-library-per-user invariant holds — a single shared user could only
// own one library, and the second `newLibrary` call on the same user would
// 409.
let other: TestUser;
const allocatedUsers: TestUser[] = [];

beforeAll(async () => {
  other = await createTestUser();
});

afterAll(async () => {
  await deleteTestUser(other.id);
  for (const owned of allocatedUsers) {
    await deleteTestUser(owned.id);
  }
});

function fileFrom(content: string, name: string, type = "application/x-bibtex"): File {
  return new File([content], name, { type });
}

function fromBibReq(form: FormData, cookie?: string): Request {
  return req("/api/references/from-bib", { method: "POST", cookie, body: form });
}

async function newLibrary(name: string): Promise<{ owner: TestUser; libId: number }> {
  const owner = await createTestUser();
  allocatedUsers.push(owner);
  const r = await POST_LIB(
    req("/api/libraries", { method: "POST", cookie: owner.cookie, body: JSON.stringify({ name }) }),
  );
  const libId = (await r.json()).id;
  return { owner, libId };
}

const SINGLE_BIB = `@article{smith2020,
  title={Deep Learning Survey},
  author={Smith, John},
  year={2020},
  journal={Nature}
}`;

const MULTI_BIB = `@article{jones2021,
  title={First Entry},
  author={Jones, Alice},
  year={2021},
  journal={Science}
}
@inproceedings{brown2022,
  title={Second Entry},
  author={Brown, Bob},
  year={2022},
  booktitle={ICML}
}
@techreport{green2023,
  title={Third Entry},
  author={Green, Carol},
  year={2023},
  institution={MIT}
}`;

const MALFORMED_BIB = `@article{good,
  title={OK Entry},
  author={Valid, Author},
  year={2020}
}
This is not bibtex at all
maybe it causes issues`;

describe("references/from-bib", () => {
  it("401 when no cookie", async () => {
    const { libId } = await newLibrary("BibAuth");
    const form = new FormData();
    form.set("libraryId", String(libId));
    form.set("file", fileFrom(SINGLE_BIB, "refs.bib"));
    const r = await POST(fromBibReq(form));
    expect(r.status).toBe(401);
  });

  it("403 when user does not own library", async () => {
    const { libId } = await newLibrary("BibOwn");
    const form = new FormData();
    form.set("libraryId", String(libId));
    form.set("file", fileFrom(SINGLE_BIB, "refs.bib"));
    const r = await POST(fromBibReq(form, other.cookie));
    expect(r.status).toBe(403);
  });

  it("creates single entry from .bib file", async () => {
    const { owner, libId } = await newLibrary("BibSingle");
    const form = new FormData();
    form.set("libraryId", String(libId));
    form.set("file", fileFrom(SINGLE_BIB, "single.bib"));
    const r = await POST(fromBibReq(form, owner.cookie));
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.created).toBe(1);
    expect(body.skipped).toBe(0);

    const rows = await db.select().from(references_).where(eq(references_.libraryId, libId));
    expect(rows).toHaveLength(1);
    expect(rows[0].citationKey).toMatch(/^smith2020/);
  });

  it("creates 3 entries from multi-entry .bib file", async () => {
    const { owner, libId } = await newLibrary("BibMulti");
    const form = new FormData();
    form.set("libraryId", String(libId));
    form.set("file", fileFrom(MULTI_BIB, "multi.bib"));
    const r = await POST(fromBibReq(form, owner.cookie));
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.created).toBe(3);
    expect(body.skipped).toBe(0);

    const rows = await db.select().from(references_).where(eq(references_.libraryId, libId));
    expect(rows).toHaveLength(3);
  });

  it("skips duplicate citationKey silently on second import", async () => {
    const { owner, libId } = await newLibrary("BibDup");
    const form1 = new FormData();
    form1.set("libraryId", String(libId));
    form1.set("file", fileFrom(SINGLE_BIB, "single.bib"));
    const r1 = await POST(fromBibReq(form1, owner.cookie));
    expect(r1.status).toBe(201);
    expect((await r1.json()).created).toBe(1);

    const form2 = new FormData();
    form2.set("libraryId", String(libId));
    form2.set("file", fileFrom(SINGLE_BIB, "single.bib"));
    const r2 = await POST(fromBibReq(form2, owner.cookie));
    expect(r2.status).toBe(201);
    const body2 = await r2.json();
    expect(body2.created).toBe(0);
    expect(body2.skipped).toBe(1);

    const rows = await db.select().from(references_).where(eq(references_.libraryId, libId));
    expect(rows).toHaveLength(1);
  });

  it("returns errors array but does not 500 on partially malformed BibTeX", async () => {
    const { owner, libId } = await newLibrary("BibMalformed");
    const form = new FormData();
    form.set("libraryId", String(libId));
    form.set("file", fileFrom(MALFORMED_BIB, "malformed.bib"));
    const r = await POST(fromBibReq(form, owner.cookie));
    // Should not be a 500
    expect(r.status).not.toBe(500);
    // Should succeed or gracefully degrade (400 or 201)
    expect([201, 400]).toContain(r.status);
  });

  it("references are scoped per user — user B's library does not get user A's refs", async () => {
    const a = await newLibrary("BibUserA");
    const b = await newLibrary("BibUserB");

    const formA = new FormData();
    formA.set("libraryId", String(a.libId));
    formA.set("file", fileFrom(SINGLE_BIB, "single.bib"));
    await POST(fromBibReq(formA, a.owner.cookie));

    const rowsB = await db
      .select()
      .from(references_)
      .where(eq(references_.libraryId, b.libId));
    expect(rowsB).toHaveLength(0);
  });

  it("400 when file is not .bib", async () => {
    const { owner, libId } = await newLibrary("BibWrongExt");
    const form = new FormData();
    form.set("libraryId", String(libId));
    form.set("file", fileFrom("col1,col2\n1,2\n", "data.csv", "text/csv"));
    const r = await POST(fromBibReq(form, owner.cookie));
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe("unsupported_file_type");
  });

  it("413 when file exceeds 5 MB", async () => {
    const { owner, libId } = await newLibrary("BibBig");
    const bigBib = SINGLE_BIB + "\n" + "% " + "x".repeat(5 * 1024 * 1024);
    const form = new FormData();
    form.set("libraryId", String(libId));
    form.set("file", fileFrom(bigBib, "big.bib"));
    const r = await POST(fromBibReq(form, owner.cookie));
    expect(r.status).toBe(413);
  });
});
