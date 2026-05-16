import { promises as fs } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { documentReferences } from "@episteme/db/schema";
import { validateCslJson, type CslItem } from "@/lib/csl";
import { autoLinkPaperCitations, type AutoLinkResult } from "@/lib/citations/auto-link";

// D7.1: synthesize document_references rows from CSL files for a guest-seeded
// paper, then run inline auto-link. No agents service, no LLM — pure DB.
// Used by seedAnonymousUser so /references shows non-empty citation rows from
// minute zero on a fresh guest workspace.

const SEED_DIR = "public/seed";

export interface SeedPaperCitationsResult extends AutoLinkResult {
  refsInserted: number;
}

function cslAuthors(csl: CslItem): Array<{ name: string }> | null {
  if (!csl.author?.length) return null;
  const names = csl.author
    .map((a) => {
      if (a.literal) return a.literal;
      const family = a.family ?? "";
      const given = a.given ?? "";
      return [given, family].filter(Boolean).join(" ").trim();
    })
    .filter((n) => n.length > 0);
  return names.length ? names.map((name) => ({ name })) : null;
}

function cslYear(csl: CslItem): string | null {
  const y = csl.issued?.["date-parts"]?.[0]?.[0];
  return typeof y === "number" && Number.isFinite(y) ? String(y) : null;
}

export async function seedPaperCitations(
  paperId: string,
  cslFilenames: readonly string[],
): Promise<SeedPaperCitationsResult> {
  let refsInserted = 0;
  for (let i = 0; i < cslFilenames.length; i++) {
    const file = cslFilenames[i];
    const cslRaw = JSON.parse(
      await fs.readFile(path.join(process.cwd(), SEED_DIR, file), "utf8"),
    ) as CslItem;
    const csl = validateCslJson(cslRaw);
    const title = typeof csl.title === "string" ? csl.title : null;
    await db.insert(documentReferences).values({
      paperId,
      markerText: `[${i + 1}]`,
      markerIndex: i + 1,
      title,
      authors: cslAuthors(csl),
      year: cslYear(csl),
      doi: typeof csl.DOI === "string" ? csl.DOI : null,
    });
    refsInserted++;
  }
  const linkResult = await autoLinkPaperCitations(paperId);
  return { refsInserted, linked: linkResult.linked };
}
