import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

export interface PaperMetadata {
  title: string;
  authors: string[];
  doi?: string;
  year?: number;
}

// DOI per crossref: 10.<registrant>/<suffix>. Suffix chars are tight enough
// to avoid matching plain version strings like "10.1".
const DOI_RE = /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i;

const AUTHOR_LINE_RE =
  /^[A-Z][a-z]+(?:\s[A-Z][a-z]+)+(?:,\s*[A-Z][a-z]+(?:\s[A-Z][a-z]+)+)*/;

const YEAR_RE = /\b(?:19|20)\d{2}\b/;

// Publication year near a conference / proceedings marker. Preferred over
// the first raw year match because papers cite earlier work (first year seen
// is often a reference, not the pub year).
const PUB_YEAR_RE =
  /(?:Conference|Proceedings|Published|NeurIPS|NIPS|ICML|ICLR|AAAI|ACL|EMNLP|NAACL|CVPR|ECCV|ICCV|JMLR|TACL)[^.\n]{0,80}?\b((?:19|20)\d{2})\b/;

/** Strip path traversal / directory segments and trim whitespace. Preserves unicode. */
export function sanitizeFilename(raw: string): string {
  const trimmed = raw.trim();
  // Take only the final path segment — handles both "/" and "\".
  const lastSlash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const base = lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;
  return base;
}

/** Convert a raw filename into a fallback title: sanitize then drop a trailing .pdf. */
export function filenameToTitle(raw: string): string {
  const clean = sanitizeFilename(raw);
  return clean.replace(/\.pdf$/i, "");
}

interface PositionedItem {
  str: string;
  x: number;
  y: number;
  height: number;
}

function toPositioned(items: TextItem[]): PositionedItem[] {
  const out: PositionedItem[] = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    // transform = [a, b, c, d, e, f]; (e, f) is the translation (x, y).
    const x = it.transform[4] as number;
    const y = it.transform[5] as number;
    out.push({ str: it.str, x, y, height: it.height });
  }
  return out;
}

/** Group items into visual lines by y-coordinate, sorted top-to-bottom. */
function groupIntoLines(items: PositionedItem[]): PositionedItem[][] {
  // Sort top-to-bottom (larger y first in PDF coords), then left-to-right.
  const sorted = [...items].sort((a, b) => {
    if (Math.abs(a.y - b.y) > 2) return b.y - a.y;
    return a.x - b.x;
  });
  const lines: PositionedItem[][] = [];
  let current: PositionedItem[] = [];
  let currentY = Number.POSITIVE_INFINITY;
  for (const it of sorted) {
    if (Math.abs(it.y - currentY) > 2 && current.length > 0) {
      lines.push(current);
      current = [];
    }
    if (current.length === 0) currentY = it.y;
    current.push(it);
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

function lineText(line: PositionedItem[]): string {
  return line
    .map((i) => i.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function lineHeight(line: PositionedItem[]): number {
  // Use max height in the line — captures the tallest glyph.
  return Math.max(...line.map((i) => i.height));
}

/** Identify title: largest-font line among the top lines of page 1. */
function pickTitle(lines: PositionedItem[][]): { title: string; index: number } | null {
  // Look only within the top third of the page's text lines (the title
  // always appears near the top, not deep in the body).
  const topLines = lines.slice(0, Math.max(1, Math.ceil(lines.length / 3)));
  let bestIdx = -1;
  let bestHeight = 0;
  for (let i = 0; i < topLines.length; i++) {
    const h = lineHeight(topLines[i]);
    const text = lineText(topLines[i]);
    if (!text) continue;
    if (h > bestHeight) {
      bestHeight = h;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return null;
  // Merge contiguous lines at (approximately) the same font size — titles
  // sometimes wrap across two lines.
  let end = bestIdx;
  while (
    end + 1 < topLines.length &&
    Math.abs(lineHeight(topLines[end + 1]) - bestHeight) < 0.5 &&
    lineText(topLines[end + 1]).length > 0
  ) {
    end++;
  }
  const parts: string[] = [];
  for (let i = bestIdx; i <= end; i++) parts.push(lineText(topLines[i]));
  return { title: parts.join(" ").replace(/\s+/g, " ").trim(), index: end };
}

// A "Firstname Lastname" (possibly "F. M. Lastname") chunk. Allows unicode
// letters so names like "Łukasz Kaiser" aren't dropped.
const NAME_TOKEN = /^\p{Lu}[\p{L}.]*(?:\s\p{Lu}[\p{L}.]*)+$/u;

function pickAuthors(
  lines: PositionedItem[][],
  afterIndex: number,
): string[] {
  // Look at up to ~6 lines below the title. Two formats in the wild:
  //   (a) "Alice Adams, Bob Brown, ..."  — comma-separated on one line.
  //   (b) "Alice Adams   Bob Brown   Carol Chen" — columnar, separated by
  //       large x-gaps (affiliations below each name). Handle both.
  const window = lines.slice(afterIndex + 1, afterIndex + 1 + 6);
  const names: string[] = [];

  for (const line of window) {
    // (a) Comma-separated form
    const text = lineText(line);
    if (text.includes(",")) {
      const m = text.match(AUTHOR_LINE_RE);
      if (m) {
        for (const part of m[0].split(",")) {
          const name = part.trim();
          if (name && !names.includes(name)) names.push(name);
        }
        continue;
      }
    }

    // (b) Column form — split by big x-gaps between items.
    const columns = splitByGap(line);
    for (const col of columns) {
      const name = col
        .map((i) => i.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
        // Strip trailing marker characters like ∗, †, ‡.
        .replace(/[\s∗*†‡§¶]+$/, "")
        .trim();
      if (NAME_TOKEN.test(name) && !names.includes(name)) names.push(name);
    }
    if (names.length > 0) break; // stop once we found a plausible author row
  }
  return names;
}

function splitByGap(line: PositionedItem[]): PositionedItem[][] {
  // Sort left-to-right, then group items whose x-gap to the previous item
  // exceeds ~2× the typical gap (column separator).
  const sorted = [...line].sort((a, b) => a.x - b.x);
  if (sorted.length === 0) return [];
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(sorted[i].x - (sorted[i - 1].x + estimateWidth(sorted[i - 1])));
  }
  // A column break is a gap significantly larger than typical inter-word gaps.
  // Use a fixed threshold of 12 PDF points — wider than a normal space at
  // typical 10pt body text but narrower than the multi-column gutters.
  const THRESHOLD = 12;
  const groups: PositionedItem[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    if (gaps[i - 1] > THRESHOLD) groups.push([sorted[i]]);
    else groups[groups.length - 1].push(sorted[i]);
  }
  return groups;
}

function estimateWidth(it: PositionedItem): number {
  // Rough: glyph count × 0.5 × height (body text). Only used as a baseline
  // for the column-gap heuristic; precise width isn't available from
  // pdfjs TextItems.
  return it.str.length * 0.5 * (it.height || 10);
}

function fallback(filename?: string): PaperMetadata {
  return {
    title: filename ? filenameToTitle(filename) : "",
    authors: [],
    doi: undefined,
    year: undefined,
  };
}

export async function extractMetadata(
  bytes: Uint8Array,
  fallbackFilename?: string,
): Promise<PaperMetadata> {
  let doc;
  try {
    // pdfjs-dist detaches the underlying ArrayBuffer — copy so callers can
    // reuse the input (e.g. the same fixture across tests).
    doc = await getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useSystemFonts: false,
    }).promise;
  } catch {
    return fallback(fallbackFilename);
  }

  try {
    const page1 = await doc.getPage(1);
    const tc1 = await page1.getTextContent();
    const items1 = toPositioned(tc1.items as TextItem[]);
    const lines1 = groupIntoLines(items1);

    const titlePick = pickTitle(lines1);
    const title = titlePick?.title ?? (fallbackFilename ? filenameToTitle(fallbackFilename) : "");
    const authors = titlePick ? pickAuthors(lines1, titlePick.index) : [];

    const page1Text = lines1.map(lineText).join("\n");
    const doiMatch = page1Text.match(DOI_RE);
    const doi = doiMatch ? doiMatch[0] : undefined;

    // Year: prefer a conference/proceedings-tagged year; fall back to the
    // first bare 4-digit year. Scan pages 1–2.
    let text2 = "";
    if (doc.numPages >= 2) {
      const page2 = await doc.getPage(2);
      const tc2 = await page2.getTextContent();
      text2 = (tc2.items as TextItem[]).map((i) => i.str).join(" ");
    }
    const combined = `${page1Text}\n${text2}`;
    let year: number | undefined;
    const pubMatch = combined.match(PUB_YEAR_RE);
    if (pubMatch) {
      year = Number(pubMatch[1]);
    } else {
      const bareMatch = combined.match(YEAR_RE);
      if (bareMatch) year = Number(bareMatch[0]);
    }

    return { title, authors, doi, year };
  } finally {
    await doc.destroy();
  }
}

export async function extractCover(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await getDocument({
    // Copy — see note in extractMetadata; pdfjs-dist detaches the buffer.
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
  }).promise;
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1.5 });
    // pdfjs-dist v5 autoselects NodeCanvasFactory (backed by @napi-rs/canvas)
    // when running under Node — we reuse that internal factory to avoid
    // shipping our own.
    const factory = (page as unknown as {
      _transport: { canvasFactory: { create(w: number, h: number): { canvas: unknown; context: unknown } } };
    })._transport.canvasFactory;
    const { canvas, context } = factory.create(viewport.width, viewport.height);
    // pdfjs v5 types expect `canvas: HTMLCanvasElement`; under Node the
    // @napi-rs/canvas Canvas is a drop-in replacement — cast to satisfy TS.
    await page.render({
      canvas: canvas as HTMLCanvasElement,
      canvasContext: context as CanvasRenderingContext2D,
      viewport,
    }).promise;
    const png = (canvas as { toBuffer(fmt: string): Buffer }).toBuffer("image/png");
    return new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
  } finally {
    await doc.destroy();
  }
}
