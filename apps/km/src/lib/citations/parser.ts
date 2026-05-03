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

const MARKER_RE = /\[(\d{1,3})\]/g;
// Tolerate a leading PDF line-number prefix (e.g. "609 References") that some
// journal PDFs render on every line.
const BIB_HEADER_RE = /^(?:\d{1,5}\s+)?(references|bibliography|works cited|literature cited|references and notes)\s*$/im;
export const REF_ENTRY_START_RE = /^(?:\d{1,5}\s+)?(?:\[(\d{1,3})\]\s+|(\d{1,3})\.\s+)/;
const YEAR_RE = /\b(1[9]\d{2}|20\d{2})\b/g;
const DOI_RE = /(?:https?:\/\/doi\.org\/|doi:\s*)?(\b10\.\d{4,}\/\S+)/i;
const URL_RE = /https?:\/\/(?!doi\.org)[^\s)>\]]+/i;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function extractCitations(pages: ExtractedPage[]): ExtractionResult {
  const markers = extractMarkers(pages);
  const references = extractReferences(pages);
  return { markers, references };
}

function extractMarkers(pages: ExtractedPage[]): CitationMarker[] {
  const seen = new Map<number, CitationMarker>();

  for (const page of pages) {
    const matches = page.text.matchAll(MARKER_RE);
    for (const match of matches) {
      const idx = parseInt(match[1], 10);
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

function extractReferences(pages: ExtractedPage[]): ParsedReference[] {
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

export function parseBibLines(lines: string[]): ParsedReference[] {
  const entries: { markerIndex: number; rawText: string }[] = [];
  let current: { markerIndex: number; rawText: string } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const startMatch = trimmed.match(REF_ENTRY_START_RE);
    if (startMatch) {
      if (current) entries.push(current);
      const idx = parseInt(startMatch[1] ?? startMatch[2], 10);
      if (idx < 1 || idx > 999) {
        current = null;
        continue;
      }
      // Drop the leading line-number prefix and the marker token so the
      // remaining rawText starts with author / title text rather than
      // `"609 [1]"` artifacts left over from line-numbered PDFs.
      const cleaned = trimmed.replace(/^(?:\d{1,5}\s+)?(?:\[\d{1,3}\]\s+|\d{1,3}\.\s+)/, "");
      current = { markerIndex: idx, rawText: cleaned };
    } else if (current) {
      // Continuation lines may also be prefixed with a line number; strip it.
      const continuation = trimmed.replace(/^\d{1,5}\s+/, "");
      current.rawText += " " + continuation;
    }
  }

  if (current) entries.push(current);

  return entries.map(({ markerIndex, rawText }) => parseReferenceEntry(markerIndex, rawText));
}

function parseReferenceEntry(markerIndex: number, rawText: string): ParsedReference {
  const ref: ParsedReference = { markerIndex, rawText };

  const doiMatch = rawText.match(DOI_RE);
  if (doiMatch) {
    ref.doi = doiMatch[1].replace(/[.,;)\]]+$/, "");
  }

  const urlMatch = rawText.match(URL_RE);
  if (urlMatch) {
    ref.url = urlMatch[0].replace(/[.,;)\]]+$/, "");
  }

  const bodyForYear = ref.doi ? rawText.replace(ref.doi, "") : rawText;
  const yearMatches = [...bodyForYear.matchAll(YEAR_RE)];
  if (yearMatches.length > 0) {
    const inParens = yearMatches.find((m) => {
      const before = bodyForYear[m.index! - 1];
      return before === "(" || before === "[";
    });
    ref.year = (inParens ?? yearMatches[0])[1];
  }

  const body = rawText.replace(REF_ENTRY_START_RE, "");
  const authorTitle = extractAuthorsAndTitle(body);
  if (authorTitle.authors) ref.authors = authorTitle.authors;
  if (authorTitle.title) ref.title = authorTitle.title;

  return ref;
}

function extractAuthorsAndTitle(body: string): { authors?: string; title?: string } {
  const inParensYear = body.match(/^([\s\S]*?)\s*\(\d{4}\)[.,]?\s*([\s\S]*)/);
  if (inParensYear) {
    const authorsPart = inParensYear[1].trim();
    const rest = inParensYear[2].trim();
    const titleMatch = rest.match(/^([^.]+(?:\.[^.]+?)?)\./);
    return {
      authors: authorsPart || undefined,
      title: titleMatch ? titleMatch[1].trim() : rest.split(".")[0]?.trim() || undefined,
    };
  }

  const parts = body.split(/\.\s+/);
  if (parts.length >= 2) {
    return {
      authors: parts[0].trim() || undefined,
      title: parts[1].trim() || undefined,
    };
  }

  return {};
}
