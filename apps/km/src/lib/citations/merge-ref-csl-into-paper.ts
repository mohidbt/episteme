// GSD-72: Pure helper that diffs two CSL JSON blobs (the reference's prior
// CSL vs the incoming CSL) and produces a partial patch shaped for the
// `papers` table.
//
// The caller (PATCH /api/references/[id]) feeds the patch to
// `db.update(papers).set(patch)` ONLY when the reference is bound to a paper.
// Empty patch → no DB write.
//
// Field mapping (CSL → papers column):
//   csl.title                          → papers.title
//   csl.author[]                       → papers.authors[]   (name strings)
//   csl.issued['date-parts'][0][0]     → papers.year        (int)
//   csl.DOI                            → papers.doi
//   csl.abstract                       → papers.abstractShort (≤500 chars)
//   csl['container-title']             → papers.venue       (first if array)
//
// Behavior:
// - Only emits a field whose normalized value DIFFERS from the prior CSL's
//   normalization. Edits that don't actually change the mapped paper-side
//   value are no-ops.
// - Malformed values (e.g. non-numeric year) are dropped per-field, never
//   thrown. The whole patch may still contain other valid fields.
// - Treats whitespace-only strings as empty (does not overwrite a real value
//   with whitespace).

const ABSTRACT_MAX_CHARS = 500;

type CslAuthor = {
  family?: unknown;
  given?: unknown;
  literal?: unknown;
  name?: unknown;
};

type CslLike = Record<string, unknown> | null | undefined;

export interface PaperPatch {
  title?: string;
  authors?: string[];
  year?: number;
  doi?: string;
  abstractShort?: string;
  venue?: string;
}

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function normalizeTitle(csl: CslLike): string | null {
  return asString(csl?.title);
}

function formatAuthor(a: unknown): string | null {
  if (!a || typeof a !== "object") return null;
  const x = a as CslAuthor;
  const literal = asString(x.literal);
  if (literal) return literal;
  const name = asString(x.name);
  if (name) return name;
  const family = asString(x.family);
  const given = asString(x.given);
  if (family && given) return `${family}, ${given}`;
  if (family) return family;
  if (given) return given;
  return null;
}

function normalizeAuthors(csl: CslLike): string[] | null {
  const a = csl?.author;
  if (!Array.isArray(a)) return null;
  const out: string[] = [];
  for (const entry of a) {
    const formatted = formatAuthor(entry);
    if (formatted) out.push(formatted);
  }
  return out.length > 0 ? out : null;
}

function normalizeYear(csl: CslLike): number | null {
  const issued = csl?.issued;
  if (!issued || typeof issued !== "object") return null;
  const dp = (issued as { "date-parts"?: unknown })["date-parts"];
  if (!Array.isArray(dp) || dp.length === 0) return null;
  const first = dp[0];
  if (!Array.isArray(first) || first.length === 0) return null;
  const raw = first[0];
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return i;
}

function normalizeDoi(csl: CslLike): string | null {
  return asString(csl?.DOI);
}

function normalizeAbstract(csl: CslLike): string | null {
  const a = asString(csl?.abstract);
  if (!a) return null;
  return a.length > ABSTRACT_MAX_CHARS ? a.slice(0, ABSTRACT_MAX_CHARS) : a;
}

function normalizeVenue(csl: CslLike): string | null {
  const v = csl?.["container-title"];
  if (Array.isArray(v)) {
    for (const entry of v) {
      const s = asString(entry);
      if (s) return s;
    }
    return null;
  }
  return asString(v);
}

function arraysEqual(a: string[] | null, b: string[] | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function mergeRefCslIntoPaper(
  prevCsl: CslLike,
  nextCsl: CslLike,
): PaperPatch {
  const patch: PaperPatch = {};
  if (!nextCsl || typeof nextCsl !== "object") return patch;

  const prev = (prevCsl && typeof prevCsl === "object" ? prevCsl : null) as CslLike;

  const nextTitle = normalizeTitle(nextCsl);
  if (nextTitle && nextTitle !== normalizeTitle(prev)) {
    patch.title = nextTitle;
  }

  const nextAuthors = normalizeAuthors(nextCsl);
  if (nextAuthors && !arraysEqual(nextAuthors, normalizeAuthors(prev))) {
    patch.authors = nextAuthors;
  }

  const nextYear = normalizeYear(nextCsl);
  if (nextYear != null && nextYear !== normalizeYear(prev)) {
    patch.year = nextYear;
  }

  const nextDoi = normalizeDoi(nextCsl);
  if (nextDoi && nextDoi !== normalizeDoi(prev)) {
    patch.doi = nextDoi;
  }

  const nextAbs = normalizeAbstract(nextCsl);
  if (nextAbs && nextAbs !== normalizeAbstract(prev)) {
    patch.abstractShort = nextAbs;
  }

  const nextVenue = normalizeVenue(nextCsl);
  if (nextVenue && nextVenue !== normalizeVenue(prev)) {
    patch.venue = nextVenue;
  }

  return patch;
}
