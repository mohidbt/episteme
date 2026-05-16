import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  documentReferences,
  libraries,
  paperCitations,
  papers,
  user,
} from "@episteme/db/schema";
import { seedPaperCitations } from "@/lib/citations/seed-paper-citations";

const userIds: string[] = [];
let userId: string;
let libId: number;
let mainPaperId: string;
let doiMatchPaperId: string;

const SEED_CSL = [
  "psm-rosenbaum-rubin1983.csl.json",
  "psm-rosenbaum-rubin1985.csl.json",
  "psm-rubin1973.csl.json",
  "psm-heckman1979.csl.json",
  "psm-dehejia-wahba2002.csl.json",
  "psm-austin2011.csl.json",
];

// DOI present in psm-austin2011.csl.json — assigned to a 2nd paper so the
// auto-link DOI path resolves to that paper (cited_kind='paper').
const AUSTIN_DOI = "10.1080/00273171.2011.568786";

beforeAll(async () => {
  const id = `spc_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  await db.insert(user).values({
    id,
    name: "spc",
    email: `${id}@t.local`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  userIds.push(id);
  userId = id;
  const [lib] = await db
    .insert(libraries)
    .values({ userId, name: "SPC" })
    .returning({ id: libraries.id });
  libId = lib.id;
  const [p1] = await db
    .insert(papers)
    .values({
      libraryId: libId,
      userId,
      folderPath: "",
      filename: "psm-paper-1.pdf",
      title: "PSM main",
    })
    .returning({ id: papers.id });
  mainPaperId = p1.id;
  const [p2] = await db
    .insert(papers)
    .values({
      libraryId: libId,
      userId,
      folderPath: "",
      filename: "psm-austin.pdf",
      title: "Austin 2011",
      doi: AUSTIN_DOI,
    })
    .returning({ id: papers.id });
  doiMatchPaperId = p2.id;
});

afterAll(async () => {
  if (userIds.length) await db.delete(user).where(inArray(user.id, userIds));
});

describe("seedPaperCitations", () => {
  it("inserts document_references rows + paper_citations edges (incl. a DOI hit)", async () => {
    const result = await seedPaperCitations(mainPaperId, SEED_CSL);
    expect(result.refsInserted).toBe(SEED_CSL.length);
    expect(result.linked).toBeGreaterThanOrEqual(1);

    const refs = await db
      .select({ id: documentReferences.id, doi: documentReferences.doi, markerIndex: documentReferences.markerIndex })
      .from(documentReferences)
      .where(eq(documentReferences.paperId, mainPaperId));
    expect(refs.length).toBe(SEED_CSL.length);
    expect(refs.map((r) => r.markerIndex).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);

    const edges = await db
      .select({
        citedKind: paperCitations.citedKind,
        citedId: paperCitations.citedId,
        matchMethod: paperCitations.matchMethod,
      })
      .from(paperCitations)
      .where(
        and(
          eq(paperCitations.citerKind, "paper"),
          eq(paperCitations.citerId, mainPaperId),
        ),
      );
    expect(edges.length).toBeGreaterThanOrEqual(1);
    const doiHit = edges.find(
      (e) => e.citedKind === "paper" && e.citedId === doiMatchPaperId,
    );
    expect(doiHit).toBeDefined();
    expect(doiHit?.matchMethod).toBe("doi");
  });
});
