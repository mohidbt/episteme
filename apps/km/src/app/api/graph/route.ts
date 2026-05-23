import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import {
  nodesForUser,
  edgesPaperIsRef,
  edgesWikiLink,
  edgesSharedTag,
  edgesSemanticSim,
  edgesPaperCitations,
} from "@/lib/graph/live-edges";

const CAP_PER_SRC_DST = 20;
const QUOTA_PAPER_IS_REF = 5000;
const QUOTA_WIKI_LINK = 5000;
const QUOTA_SHARED_TAG = 5000;
const QUOTA_SEMANTIC = 10000;
const QUOTA_PAPER_CITATION = 5000;

function byWeightDesc<T extends { weight: number }>(a: T, b: T): number {
  return b.weight - a.weight;
}

export async function GET(req: Request) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [nodes, eRef, eWiki, eTag, eSem, eCite] = await Promise.all([
    nodesForUser(userId),
    edgesPaperIsRef(userId),
    edgesWikiLink(userId),
    edgesSharedTag(userId),
    edgesSemanticSim(userId, CAP_PER_SRC_DST),
    edgesPaperCitations(userId),
  ]);

  const keptRef = eRef.slice(0, QUOTA_PAPER_IS_REF);
  const keptWiki = eWiki.slice(0, QUOTA_WIKI_LINK);
  const keptTag = [...eTag].sort(byWeightDesc).slice(0, QUOTA_SHARED_TAG);
  const keptSem = [...eSem].sort(byWeightDesc).slice(0, QUOTA_SEMANTIC);
  // One edge per citation row now (kind="citing"), so a flat slice works.
  const keptCite = eCite.slice(0, QUOTA_PAPER_CITATION);

  // No paper_is_ref ↔ citation dedup: the two edges represent distinct
  // facts (identity vs bibliography citation). A paper that IS the same
  // entity as a library reference AND is cited by another paper which
  // bibliographically references it should surface both edges. See plan
  // H-batch.

  const det = [...keptRef, ...keptCite, ...keptWiki, ...keptTag];
  const sem = keptSem;

  return NextResponse.json({
    nodes,
    edges: [...det, ...sem],
    capped: {
      paper_is_ref: { kept: keptRef.length, total: eRef.length },
      paper_citation: { kept: keptCite.length, total: eCite.length },
      wiki_link: { kept: keptWiki.length, total: eWiki.length },
      shared_tag: { kept: keptTag.length, total: eTag.length },
      semantic_sim: { kept: keptSem.length, total: eSem.length },
    },
  });
}
