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
import type { GraphEdge } from "@/lib/graph/types";

const CAP_PER_SRC_DST = 20;
const QUOTA_PAPER_IS_REF = 5000;
const QUOTA_WIKI_LINK = 5000;
const QUOTA_SHARED_TAG = 5000;
const QUOTA_SEMANTIC = 10000;
const QUOTA_PAPER_CITATION = 5000;

function byWeightDesc<T extends { weight: number }>(a: T, b: T): number {
  return b.weight - a.weight;
}

function pairKey(e: GraphEdge): string {
  return `${e.src.kind}:${e.src.id}>${e.dst.kind}:${e.dst.id}`;
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

  const keptRefRaw = eRef.slice(0, QUOTA_PAPER_IS_REF);
  const keptWiki = eWiki.slice(0, QUOTA_WIKI_LINK);
  const keptTag = [...eTag].sort(byWeightDesc).slice(0, QUOTA_SHARED_TAG);
  const keptSem = [...eSem].sort(byWeightDesc).slice(0, QUOTA_SEMANTIC);
  const keptCite = eCite.slice(0, QUOTA_PAPER_CITATION);

  // Dedup: prefer paper_citation over paper_is_ref on duplicate (srcKind,srcId,dstKind,dstId).
  const citePairs = new Set(keptCite.map(pairKey));
  const keptRef = keptRefRaw.filter((e) => !citePairs.has(pairKey(e)));

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
