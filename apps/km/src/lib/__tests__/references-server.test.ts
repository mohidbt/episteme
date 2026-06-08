// GSD-8 — paperAlreadyReferenced covers BOTH wiring states:
//   (a) explicit paper_id link, and
//   (b) DOI hit in the same library when paper_id IS NULL.
// The (b) case is the real-world bug: legacy refs created before paper_id
// wiring still 409 on add-as-reference but used to slip past the disable check.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { libraries, papers, references_, user } from "@episteme/db/schema";
import { paperAlreadyReferenced } from "@/lib/references-server";

async function makeUser(): Promise<string> {
  const id = `rs_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  await db.insert(user).values({
    id,
    name: "rs",
    email: `${id}@t.local`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

const userIds: string[] = [];
let userId: string;
let libId: number;
let paperLinkedId: string;
let paperDoiOnlyId: string;
let paperUnreferencedId: string;

beforeAll(async () => {
  userId = await makeUser();
  userIds.push(userId);
  const [lib] = await db
    .insert(libraries)
    .values({ userId, name: "R" })
    .returning({ id: libraries.id });
  libId = lib.id;

  // Three papers in the same library:
  //  - paperLinked:        has DOI, ref points back via paper_id
  //  - paperDoiOnly:       has DOI, ref exists w/ matching CSL DOI but paper_id IS NULL
  //  - paperUnreferenced:  has DOI but no ref anywhere
  const inserted = await db
    .insert(papers)
    .values([
      { libraryId: libId, userId, filename: "a.pdf", doi: "10.1/linked" },
      { libraryId: libId, userId, filename: "b.pdf", doi: "10.1/DoiOnly" },
      { libraryId: libId, userId, filename: "c.pdf", doi: "10.1/none" },
    ])
    .returning({ id: papers.id, doi: papers.doi });
  paperLinkedId = inserted[0].id;
  paperDoiOnlyId = inserted[1].id;
  paperUnreferencedId = inserted[2].id;

  await db.insert(references_).values([
    {
      libraryId: libId,
      userId,
      citationKey: "linked2024",
      cslJson: { DOI: "10.1/linked", type: "article-journal" },
      paperId: paperLinkedId,
    },
    {
      libraryId: libId,
      userId,
      citationKey: "doionly2024",
      // Mixed case to exercise the lower(...) comparison.
      cslJson: { DOI: "10.1/doionly", type: "article-journal" },
      paperId: null,
    },
  ]);
});

afterAll(async () => {
  if (userIds.length) await db.delete(user).where(inArray(user.id, userIds));
});

describe("paperAlreadyReferenced", () => {
  it("returns true when an explicit paper_id link exists", async () => {
    const got = await paperAlreadyReferenced(paperLinkedId, libId, "10.1/linked", userId);
    expect(got).toBe(true);
  });

  it("returns true when only a DOI hit exists in the same library (paper_id IS NULL)", async () => {
    const got = await paperAlreadyReferenced(paperDoiOnlyId, libId, "10.1/DoiOnly", userId);
    expect(got).toBe(true);
  });

  it("returns false when no link and no DOI hit", async () => {
    const got = await paperAlreadyReferenced(paperUnreferencedId, libId, "10.1/none", userId);
    expect(got).toBe(false);
  });

  it("returns false when paper has no DOI and no explicit link", async () => {
    const got = await paperAlreadyReferenced(paperUnreferencedId, libId, null, userId);
    expect(got).toBe(false);
  });
});
