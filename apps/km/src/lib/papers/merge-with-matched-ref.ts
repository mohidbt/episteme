// GSD-32 Phase 3: read-time merge of a paper with its matched library
// reference. Paper wins on every non-blank field; ref CSL fills blanks. Pure
// fn — does not mutate the paper row.

import type { papers as papersTable, references_ as referencesTable } from "@episteme/db/schema";

type PaperRow = typeof papersTable.$inferSelect;
type RefRow = typeof referencesTable.$inferSelect;

const ABSTRACT_MAX = 500;

function isBlank(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function cslAuthorsToStrings(authors: unknown): string[] | null {
  if (!Array.isArray(authors)) return null;
  const out: string[] = [];
  for (const a of authors) {
    if (typeof a === "string") {
      if (a.trim()) out.push(a);
      continue;
    }
    if (a && typeof a === "object") {
      const o = a as { family?: string; given?: string; literal?: string };
      if (o.literal && o.literal.trim()) out.push(o.literal);
      else if (o.family) out.push(o.family);
    }
  }
  return out.length > 0 ? out : null;
}

function cslYear(issued: unknown): number | null {
  if (!issued || typeof issued !== "object") return null;
  const dp = (issued as { "date-parts"?: unknown })["date-parts"];
  if (!Array.isArray(dp) || dp.length === 0) return null;
  const first = dp[0];
  if (!Array.isArray(first) || first.length === 0) return null;
  const y = first[0];
  return typeof y === "number" && Number.isFinite(y) ? y : null;
}

export type RefForMerge = Pick<RefRow, "cslJson"> | null;

export function mergeWithMatchedRef<P extends PaperRow>(paper: P, ref: RefForMerge): P {
  if (!ref || !ref.cslJson || typeof ref.cslJson !== "object") return paper;
  const csl = ref.cslJson as Record<string, unknown>;

  const out: P = { ...paper };

  if (isBlank(out.title)) {
    const t = typeof csl.title === "string" ? csl.title : null;
    if (!isBlank(t)) out.title = t;
  }
  if (isBlank(out.authors)) {
    const authors = cslAuthorsToStrings(csl.author);
    if (authors) out.authors = authors;
  }
  if (isBlank(out.year)) {
    const y = cslYear(csl.issued);
    if (y != null) out.year = y;
  }
  if (isBlank(out.doi)) {
    const d = typeof csl.DOI === "string" ? csl.DOI : null;
    if (!isBlank(d)) out.doi = d;
  }
  if (isBlank(out.venue)) {
    const v = typeof csl["container-title"] === "string" ? (csl["container-title"] as string) : null;
    if (!isBlank(v)) out.venue = v;
  }
  if (isBlank(out.abstractShort)) {
    const a = typeof csl.abstract === "string" ? csl.abstract : null;
    if (!isBlank(a)) out.abstractShort = a!.slice(0, ABSTRACT_MAX);
  }

  return out;
}
