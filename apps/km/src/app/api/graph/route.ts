import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import {
  nodesForUser,
  edgesPaperIsRef,
  edgesWikiLink,
  edgesSharedTag,
  edgesSemanticSim,
} from "@/lib/graph/live-edges";

const CAP_PER_SRC_DST = 20;
const QUOTA_PAPER_IS_REF = 5000;
const QUOTA_WIKI_LINK = 5000;
const QUOTA_SHARED_TAG = 5000;
const QUOTA_SEMANTIC = 10000;

function byWeightDesc<T extends { weight: number }>(a: T, b: T): number {
  return b.weight - a.weight;
}

export async function GET(req: Request) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [nodes, eRef, eWiki, eTag, eSem] = await Promise.all([
    nodesForUser(userId),
    edgesPaperIsRef(userId),
    edgesWikiLink(userId),
    edgesSharedTag(userId),
    edgesSemanticSim(userId),
  ]);

  const keptRef = eRef.slice(0, QUOTA_PAPER_IS_REF);
  const keptWiki = eWiki.slice(0, QUOTA_WIKI_LINK);
  const keptTag = [...eTag].sort(byWeightDesc).slice(0, QUOTA_SHARED_TAG);
  const keptSem = [...eSem].sort(byWeightDesc).slice(0, QUOTA_SEMANTIC);

  const det = [...keptRef, ...keptWiki, ...keptTag];
  const sem = keptSem;

  return NextResponse.json({
    nodes,
    edges: [...det, ...sem],
    capped: {
      paperIsRef: { kept: keptRef.length, total: eRef.length },
      wikiLink: { kept: keptWiki.length, total: eWiki.length },
      sharedTag: { kept: keptTag.length, total: eTag.length },
      semanticSim: { kept: keptSem.length, total: eSem.length },
    },
  });
}
