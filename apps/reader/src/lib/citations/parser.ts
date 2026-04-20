import type { ExtractedPage } from "@/lib/ai/pdf-text";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CitationMarker {
  markerText: string;  // "[1]"
  markerIndex: number; // 1
  pageNumber: number;  // first page this marker appears on
}

export interface ParsedReference {
  markerIndex: number;
  rawText: string;      // full reference text (may span wrapped lines)
  title?: string;       // best-effort parsed title
  authors?: string;     // best-effort parsed authors
  year?: string;        // 4-digit year 1900–2099
  doi?: string;         // 10.xxxx/... normalized
  url?: string;         // http(s) URL
}

export interface ExtractionResult {
  markers: CitationMarker[];
  references: ParsedReference[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Matches [n] where n is 1–999. Uses `g` flag — consume only via matchAll (resets lastIndex).
const MARKER_RE = /\[(\d{1,3})\]/g;

// Bibliography section header (case-insensitive)
const BIB_HEADER_RE = /^(references|bibliography|works cited|literature cited)\s*$/im;

// A line that starts a new numbered reference entry.
// Accepts both:
//   [n]  — bracket style (IEEE/APA/Chicago): [1] Smith …
//   n.   — Vancouver/AMA/Nature style:        1. Smith …
//
// DOI disambiguation: the n. branch requires \s+ immediately after the dot.
// A DOI like "10.1038/nature…" has a digit ('1') right after the dot, which
// does not satisfy \s+, so it is never treated as an entry-start line and is
// absorbed as continuation text instead. No negative lookahead is needed.
export const REF_ENTRY_START_RE = /^(?:\[(\d{1,3})\]\s+|(\d{1,3})\.\s+)/;

// Year: 4 digits in range 1900–2099. Uses `g` flag — consume only via matchAll (resets lastIndex).
const YEAR_RE = /\b(1[9]\d{2}|20\d{2})\b/g;

// DOI: handles doi:10.xxx, DOI:10.xxx, https://doi.org/10.xxx, plain 10.xxx/
const DOI_RE = /(?:https?:\/\/doi\.org\/|doi:\s*)?(\b10\.\d{4,}\/\S+)/i;

// URL: http(s) links (not doi.org since those are handled by DOI_RE)
const URL_RE = /https?:\/\/(?!doi\.org)[^\s)>\]]+/i;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function extractCitations(pages: ExtractedPage[]): ExtractionResult {
  const markers = extractMarkers(pages);
  const references = extractReferences(pages);
  return { markers, references };
}

// ---------------------------------------------------------------------------
// Marker extraction
// ---------------------------------------------------------------------------

function extractMarkers(pages: ExtractedPage[]): CitationMarker[] {
  // markerIndex -> CitationMarker (keep first occurrence)
  const seen = new Map<number, CitationMarker>();

  for (const page of pages) {
    const matches = page.text.matchAll(MARKER_RE);
    for (const match of matches) {
      const idx = parseInt(match[1], 10);
      // Range check: 1–999
      if (idx < 1 || idx > 999) continue;
      if (!seen.has(idx)) {
        seen.set(idx, {
          markerText: `[${idx}]`,
          markerIndex: idx,
          pageNumber: page.pageNumber,
        });
      }
    }
  }

  return Array.from(seen.values()).sort((a, b) => a.markerIndex - b.markerIndex);
}

// ---------------------------------------------------------------------------
// Bibliography / reference extraction
// ---------------------------------------------------------------------------

function extractReferences(pages: ExtractedPage[]): ParsedReference[] {
  // Combine all page text into one block, tracking which "page" the bib section starts
  // so we can handle multi-page bib sections.

  // First, find the page where the bibliography header starts
  let bibPageIndex = -1;
  let bibLineOffset = -1;

  for (let pi = 0; pi < pages.length; pi++) {
    const lines = pages[pi].text.split("\n");
    for (let li = 0; li < lines.length; li++) {
      if (BIB_HEADER_RE.test(lines[li].trim())) {
        bibPageIndex = pi;
        bibLineOffset = li;
        break;
      }
    }
    if (bibPageIndex !== -1) break;
  }

  if (bibPageIndex === -1) return [];

  // Collect all lines from after the header to the end of the document
  const bibLines: string[] = [];

  for (let pi = bibPageIndex; pi < pages.length; pi++) {
    const lines = pages[pi].text.split("\n");
    const startLine = pi === bibPageIndex ? bibLineOffset + 1 : 0;
    for (let li = startLine; li < lines.length; li++) {
      bibLines.push(lines[li]);
    }
  }

  return parseBibLines(bibLines);
}

// ---------------------------------------------------------------------------
// Parse collected bibliography lines into ParsedReference[]
// ---------------------------------------------------------------------------

export function parseBibLines(lines: string[]): ParsedReference[] {
  // Group lines into reference entries. A new entry starts when a line matches
  // REF_ENTRY_START_RE. Continuation lines (indented or plain) are appended.
  const entries: { markerIndex: number; rawText: string }[] = [];
  let current: { markerIndex: number; rawText: string } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const startMatch = trimmed.match(REF_ENTRY_START_RE);
    if (startMatch) {
      if (current) entries.push(current);
      // Group 1 = bracket style [n], group 2 = Vancouver style n.
      const idx = parseInt(startMatch[1] ?? startMatch[2], 10);
      // Skip out-of-range
      if (idx < 1 || idx > 999) {
        current = null;
        continue;
      }
      current = { markerIndex: idx, rawText: trimmed };
    } else if (current) {
      // Continuation line — append
      current.rawText += " " + trimmed;
    }
    // Lines before any [n] entry are ignored (e.g., the header itself)
  }

  if (current) entries.push(current);

  return entries.map(({ markerIndex, rawText }) => parseReferenceEntry(markerIndex, rawText));
}

// ---------------------------------------------------------------------------
// Parse a single reference entry line into structured fields
// ---------------------------------------------------------------------------

function parseReferenceEntry(markerIndex: number, rawText: string): ParsedReference {
  const ref: ParsedReference = { markerIndex, rawText };

  // DOI (before URL so doi.org URLs are captured as DOI, not URL)
  const doiMatch = rawText.match(DOI_RE);
  if (doiMatch) {
    // Normalize: strip trailing punctuation that may have been captured
    ref.doi = doiMatch[1].replace(/[.,;)\]]+$/, "");
  }

  // URL (non-doi)
  const urlMatch = rawText.match(URL_RE);
  if (urlMatch) {
    ref.url = urlMatch[0].replace(/[.,;)\]]+$/, "");
  }

  // Year — prefer years in range 1900–2099, take the last one found
  // (typically the publication year is near the start; "last" avoids picking
  //  up an access year from a URL like /2023/)
  const bodyForYear = ref.doi ? rawText.replace(ref.doi, "") : rawText;
  const yearMatches = [...bodyForYear.matchAll(YEAR_RE)];
  if (yearMatches.length > 0) {
    // Prefer first year in parens if any, otherwise use first match
    const inParens = yearMatches.find((m) => {
      const before = bodyForYear[m.index! - 1];
      return before === "(" || before === "[";
    });
    ref.year = (inParens ?? yearMatches[0])[1];
  }

  // Authors and title — best-effort fuzzy extraction
  // Strip the leading "[n] " prefix
  const body = rawText.replace(REF_ENTRY_START_RE, "");

  // Attempt: authors are before the first "(" or the title, title is the
  // first "quoted" or sentence-case segment after the authors.
  // Strategy: split on first "." after a plausible author segment
  const authorTitle = extractAuthorsAndTitle(body);
  if (authorTitle.authors) ref.authors = authorTitle.authors;
  if (authorTitle.title) ref.title = authorTitle.title;

  return ref;
}

// ---------------------------------------------------------------------------
// Fuzzy author / title extraction
// ---------------------------------------------------------------------------

function extractAuthorsAndTitle(
  body: string
): { authors?: string; title?: string } {
  // Many formats:
  //   "Smith, J. and Doe, A. (2020). Title here. ..."
  //   "Smith J, Doe A. Title here. Journal. ..."
  //   "Smith J. Title here. Journal 2020;"
  //
  // Heuristic:
  //  1. Find the first occurrence of a year in parens "(YYYY)" — everything
  //     before it is authors, first sentence after it is title.
  //  2. Fallback: take text before first period as authors, next sentence as title.

  const inParensYear = body.match(/^([\s\S]*?)\s*\(\d{4}\)[.,]?\s*([\s\S]*)/);
  if (inParensYear) {
    const authorsPart = inParensYear[1].trim();
    const rest = inParensYear[2].trim();
    // Title is up to the first period that's followed by a space+capital or end
    const titleMatch = rest.match(/^([^.]+(?:\.[^.]+?)?)\./);
    return {
      authors: authorsPart || undefined,
      title: titleMatch ? titleMatch[1].trim() : rest.split(".")[0]?.trim() || undefined,
    };
  }

  // Fallback: first segment before "." is authors, next segment is title
  const parts = body.split(/\.\s+/);
  if (parts.length >= 2) {
    return {
      authors: parts[0].trim() || undefined,
      title: parts[1].trim() || undefined,
    };
  }

  return {};
}
