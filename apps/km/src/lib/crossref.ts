import type { CslItem } from "./csl";
import { stripJats as stripJatsUtil } from "./strip-jats";

const TYPE_MAP: Record<string, string> = {
  "journal-article": "article-journal",
  "proceedings-article": "paper-conference",
  "book-chapter": "chapter",
  "posted-content": "article",
};

type CrossRefAuthor = {
  family?: string;
  given?: string;
  name?: string;
  sequence?: string;
  affiliation?: unknown[];
};

type CrossRefDateField = { "date-parts"?: number[][] };

type CrossRefMessage = {
  DOI: string;
  type?: string;
  title?: string[];
  author?: CrossRefAuthor[];
  issued?: CrossRefDateField;
  published?: CrossRefDateField;
  "published-print"?: CrossRefDateField;
  "published-online"?: CrossRefDateField;
  URL?: string;
  "container-title"?: string[];
  abstract?: string;
  publisher?: string;
};

/**
 * Re-export from the shared strip-jats util so callers that previously imported
 * `stripJats` from this module keep working. New code should import from
 * `./strip-jats` directly.
 */
export const stripJats = stripJatsUtil;

export function crossRefToCsl(message: unknown): CslItem {
  const msg = message as Record<string, unknown>;
  if (typeof msg?.DOI !== "string") {
    throw new Error("CrossRef message missing required string field: DOI");
  }
  const m = msg as unknown as CrossRefMessage;

  const csl: CslItem = {
    id: m.DOI,
    type: TYPE_MAP[m.type ?? ""] ?? (m.type ?? "misc"),
    DOI: m.DOI,
  };

  if (m.title?.[0]) csl.title = m.title[0];

  if (m.URL) csl.URL = m.URL;
  if (m["container-title"]?.[0]) csl["container-title"] = m["container-title"][0];
  if (m.abstract) csl.abstract = stripJats(m.abstract);
  if (m.publisher) csl.publisher = m.publisher;

  if (m.author) {
    csl.author = m.author.map((a) => {
      if (a.family !== undefined || a.given !== undefined) {
        const entry: { family?: string; given?: string } = {};
        if (a.family !== undefined) entry.family = a.family;
        if (a.given !== undefined) entry.given = a.given;
        return entry;
      }
      if (a.name !== undefined) {
        return { literal: a.name };
      }
      return {};
    });
  }

  const dateParts =
    m.issued?.["date-parts"] ??
    m.published?.["date-parts"] ??
    m["published-print"]?.["date-parts"] ??
    m["published-online"]?.["date-parts"];

  if (dateParts !== undefined) {
    csl.issued = { "date-parts": dateParts };
  }

  return csl;
}

export async function fetchCrossRef(doi: string): Promise<CslItem | null> {
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Episteme/0.1 (mailto:team@episteme.local)",
      },
      signal: ctrl.signal,
    });

    if (res.status === 404) return null;
    if (res.status !== 200) {
      throw new Error(`CrossRef returned HTTP ${res.status} for DOI ${doi}`);
    }

    const body = (await res.json()) as { status: string; message: unknown };
    return crossRefToCsl(body.message);
  } finally {
    clearTimeout(t);
  }
}
