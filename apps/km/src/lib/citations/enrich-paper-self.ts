// GSD-65 Part 1: post-finalize, enrich a paper's own metadata via Semantic
// Scholar using its DOI, then OVERWRITE paper fields (title, authors, year,
// doi, venue, abstractShort) with the S2 values.
//
// Rationale (per issue): "Paper metadata is way worse than the semanticscholar-
// enriched reference metadata. so the latter should be the source of truth."
//
// Failure modes are silent: a finalize call must never fail because S2 is
// unreachable. Returns { enriched: false } and logs warn for all error paths.
//
// Idempotent: safe to call repeatedly. Subsequent calls re-fetch S2 and
// re-overwrite — same DOI → same fields. The check `if (!paper.doi) skip` is
// what gates "did we already enrich" implicitly (the only place we set DOI
// is via this function or the PDF extractor, so a re-call is a noop on
// already-resolved DOIs and a refresh on new ones).

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { papers } from "@episteme/db/schema";
import { getUserS2Key } from "@episteme/auth/byok";
import {
  resolvePaperId,
  fetchPaperBatch,
  type PaperMetadata,
} from "./semantic-scholar";

const ABSTRACT_MAX_CHARS = 500;

export interface PaperForSelfEnrichment {
  id: string;
  userId: string;
  title: string | null;
  authors: string[] | null;
  year: number | null;
  doi: string | null;
}

export interface SelfEnrichResult {
  enriched: boolean;
  s2PaperId?: string;
}

function trimAbstract(s: string | null): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > ABSTRACT_MAX_CHARS
    ? trimmed.slice(0, ABSTRACT_MAX_CHARS)
    : trimmed;
}

function buildOverwrite(meta: PaperMetadata): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (meta.title) out.title = meta.title;
  if (meta.authors.length > 0) {
    out.authors = meta.authors.map((a) => a.name);
  }
  if (meta.year != null) out.year = meta.year;
  const s2Doi = meta.externalIds?.DOI ?? null;
  if (s2Doi) out.doi = s2Doi;
  if (meta.venue) out.venue = meta.venue;
  const abs = trimAbstract(meta.abstract);
  if (abs) out.abstractShort = abs;
  return out;
}

export async function enrichPaperSelfFromS2(
  paper: PaperForSelfEnrichment,
): Promise<SelfEnrichResult> {
  if (!paper.doi || paper.doi.trim().length === 0) {
    return { enriched: false };
  }

  let s2Key: string | null;
  try {
    s2Key = await getUserS2Key(paper.userId);
  } catch {
    s2Key = null;
  }
  const apiKey = s2Key ?? undefined;

  let s2PaperId: string | null = null;
  try {
    s2PaperId = await resolvePaperId(
      { id: 0, doi: paper.doi, title: paper.title ?? undefined },
      { apiKey },
    );
  } catch (err) {
    console.warn(
      `[enrich-paper-self] resolvePaperId failed for paper ${paper.id}`,
      err,
    );
    return { enriched: false };
  }

  if (!s2PaperId) {
    return { enriched: false };
  }

  let batch: PaperMetadata[];
  try {
    batch = await fetchPaperBatch([s2PaperId], { apiKey });
  } catch (err) {
    console.warn(
      `[enrich-paper-self] fetchPaperBatch failed for paper ${paper.id}`,
      err,
    );
    return { enriched: false };
  }

  const meta = batch[0];
  if (!meta) {
    return { enriched: false };
  }

  const values = buildOverwrite(meta);
  if (Object.keys(values).length === 0) {
    return { enriched: false };
  }

  try {
    await db.update(papers).set(values).where(eq(papers.id, paper.id));
  } catch (err) {
    console.warn(
      `[enrich-paper-self] DB update failed for paper ${paper.id}`,
      err,
    );
    return { enriched: false };
  }

  return { enriched: true, s2PaperId };
}
