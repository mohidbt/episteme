// @ts-nocheck — pdfjs types are complex; we rely on runtime shape
/**
 * Annotation-based citation marker extraction.
 *
 * Strategy A (primary): parse the reference text directly from the named
 * destination string, which in this PDF format embeds the full reference text.
 * e.g. "springernature_…:1.  Shin, Y. & Brangwynne, C. P. …:79"
 *
 * Strategy A-fallback: use pdfjs page.getTextContent() with positioned items
 * to find and parse the reference entry at/below destY.
 */

import { getDocumentProxy } from "unpdf";
import { getFile } from "@/lib/storage";
import { parseBibLines, REF_ENTRY_START_RE } from "@/lib/citations/parser";
import type { ParsedReference } from "@/lib/citations/parser";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MarkerRect {
  /** The resolved reference number (1-based) */
  markerIndex: number;
  pageNumber: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface AnnotationExtractionResult {
  references: ParsedReference[];
  markers: MarkerRect[];
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

export async function extractAnnotationMarkers(
  filePath: string
): Promise<AnnotationExtractionResult> {
  const buffer = await getFile(filePath);
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const numPages: number = pdf.numPages;

  // --- Pass 1: collect all internal-link annotations ---
  type RawAnnotation = {
    rect: [number, number, number, number];
    dest: string | unknown[] | null;
    pageNumber: number;
  };

  const rawAnnotations: RawAnnotation[] = [];

  for (let p = 1; p <= numPages; p++) {
    const page = await pdf.getPage(p);
    const annotations = await page.getAnnotations();
    for (const ann of annotations) {
      // Internal link: subtype "Link", has dest, no url
      if (ann.subtype === "Link" && ann.dest != null && !ann.url) {
        rawAnnotations.push({
          rect: ann.rect as [number, number, number, number],
          dest: ann.dest,
          pageNumber: p,
        });
      }
    }
  }

  if (rawAnnotations.length === 0) {
    return { references: [], markers: [] };
  }

  // --- Pass 2: resolve each dest → (destPage, destY) and parse reference ---

  type ResolvedAnnotation = RawAnnotation & {
    destPage: number;
    destY: number;
    parsedRef: ParsedReference | null;
  };

  const resolved: ResolvedAnnotation[] = [];

  for (const ann of rawAnnotations) {
    try {
      let explicitDest: unknown[];
      let destString: string | null = null;

      if (typeof ann.dest === "string") {
        destString = ann.dest;
        const d = await pdf.getDestination(ann.dest);
        if (!d) {
          console.warn("[annotation-extractor] named dest not found:", ann.dest.slice(0, 60));
          continue;
        }
        explicitDest = d as unknown[];
      } else if (Array.isArray(ann.dest)) {
        explicitDest = ann.dest;
      } else {
        console.warn("[annotation-extractor] unrecognised dest type:", typeof ann.dest);
        continue;
      }

      // explicitDest = [pageRef, modeLiteral, ...args]
      const [pageRef, mode, ...args] = explicitDest;
      const pageIndex: number = await pdf.getPageIndex(pageRef);
      const destPage = pageIndex + 1;

      // Determine destY from mode name
      const modeName: string =
        typeof mode === "object" && mode !== null && "name" in mode
          ? (mode as { name: string }).name
          : String(mode);

      let destY: number;
      if (modeName === "XYZ") {
        const y = args[1];
        destY = typeof y === "number" ? y : Infinity;
      } else if (modeName === "FitH" || modeName === "FitBH") {
        const y = args[0];
        destY = typeof y === "number" ? y : Infinity;
      } else {
        // Fit, FitB, FitV, FitR — no reliable Y; use top of page
        destY = Infinity;
      }

      // Strategy A: try to parse reference directly from the named dest string
      // The dest string often encodes the full reference text in this PDF format.
      const parsedRef = destString
        ? parseRefFromDestString(destString)
        : null;

      resolved.push({ ...ann, destPage, destY, parsedRef });
    } catch (err) {
      console.warn(
        "[annotation-extractor] failed to resolve dest for ann on page",
        ann.pageNumber,
        err
      );
    }
  }

  if (resolved.length === 0) {
    return { references: [], markers: [] };
  }

  // --- Pass 3: for dest strings that didn't yield a parsed ref, use
  //     positioned text fallback. Build page text maps only as needed. ---

  const needsTextFallback = resolved.filter((r) => r.parsedRef === null);
  const uniqueFallbackPages = [...new Set(needsTextFallback.map((r) => r.destPage))];

  type TextItem = { y: number; text: string };
  const pageTextItems = new Map<number, TextItem[]>();

  for (const destPage of uniqueFallbackPages) {
    const page = await pdf.getPage(destPage);
    const content = await page.getTextContent();
    const items: TextItem[] = [];
    for (const item of content.items) {
      if ("str" in item && Array.isArray(item.transform) && item.str.trim()) {
        const y: number = item.transform[5];
        items.push({ y, text: item.str });
      }
    }
    // Sort descending by y: higher y = higher on page in PDF coords
    items.sort((a, b) => b.y - a.y);
    pageTextItems.set(destPage, items);
  }

  // Cache: destPage+destY → ParsedReference (avoid re-parsing same entry)
  const textFallbackCache = new Map<string, ParsedReference | null>();

  for (const ann of needsTextFallback) {
    const cacheKey = `${ann.destPage}:${ann.destY}`;
    if (!textFallbackCache.has(cacheKey)) {
      const ref = findReferenceAtDest(
        pageTextItems.get(ann.destPage) ?? [],
        ann.destY
      );
      textFallbackCache.set(cacheKey, ref);
    }
    ann.parsedRef = textFallbackCache.get(cacheKey) ?? null;

    if (!ann.parsedRef) {
      console.warn(
        "[annotation-extractor] no reference entry found at page",
        ann.destPage,
        "destY",
        ann.destY
      );
    }
  }

  // --- Pass 4: collect references and markers ---
  const referenceByIndex = new Map<number, ParsedReference>();
  const markers: MarkerRect[] = [];

  for (const ann of resolved) {
    const ref = ann.parsedRef;
    if (!ref) continue;

    // Register reference (dedup by markerIndex)
    if (!referenceByIndex.has(ref.markerIndex)) {
      referenceByIndex.set(ref.markerIndex, ref);
    }

    // Validate rect is non-zero
    const [x0, y0, x1, y1] = ann.rect;
    if (x0 === x1 && y0 === y1) {
      console.warn(
        "[annotation-extractor] zero-sized rect on page",
        ann.pageNumber,
        "skipping"
      );
      continue;
    }

    markers.push({
      markerIndex: ref.markerIndex,
      pageNumber: ann.pageNumber,
      x0,
      y0,
      x1,
      y1,
    });
  }

  const references = Array.from(referenceByIndex.values()).sort(
    (a, b) => a.markerIndex - b.markerIndex
  );

  return { references, markers };
}

// ---------------------------------------------------------------------------
// Parse reference from named destination string
//
// Format observed: "prefix:N.  Author, A. B. et al. Title. Journal vol, pp (year).\r:pagenum"
// e.g. "springernature_natphy_3158.indd:﻿1.﻿﻿\t…Shin, Y. … (2017).﻿\r:79"
//
// We strip the prefix before the first colon-digit sequence, clean control chars,
// and feed to parseBibLines.
// ---------------------------------------------------------------------------

function parseRefFromDestString(destStr: string): ParsedReference | null {
  // Strip the InDesign file prefix (up to and including the first ":")
  // then clean up BOM/zero-width/tab/CR characters, leaving readable text
  const colonIdx = destStr.indexOf(":");
  if (colonIdx === -1) return null;

  let body = destStr.slice(colonIdx + 1);

  // Strip trailing ":pageNum" suffix
  body = body.replace(/:\d+$/, "");

  // Remove Unicode control characters: BOM (U+FEFF), zero-width space (U+200B),
  // soft hyphen (U+00AD), zero-width no-break space, tabs, carriage returns
  // Keep regular printable chars + newlines for line reconstruction.
  // eslint-disable-next-line no-control-regex
  body = body.replace(/[\u200B\uFEFF\u00AD\u200C\u200D\t\r]+/g, " ");

  // Normalize multiple spaces
  body = body.replace(/ {2,}/g, " ").trim();

  if (!body) return null;

  // The body should now look like "1.  Shin, Y. & Brangwynne, C. P. ..."
  const parsed = parseBibLines([body]);
  return parsed[0] ?? null;
}

// ---------------------------------------------------------------------------
// Strategy A-fallback: find reference entry at/below destY using positioned text
// ---------------------------------------------------------------------------

function findReferenceAtDest(
  items: { y: number; text: string }[],
  destY: number
): ParsedReference | null {
  if (items.length === 0) return null;

  // Reconstruct text lines by grouping items within 2pt of the same y.
  // Returns an array of { y (representative), line (joined text) } sorted
  // descending by y (top to bottom in PDF).
  type TextLine = { y: number; line: string };
  const lines: TextLine[] = [];

  for (const item of items) {
    const existing = lines.find((l) => Math.abs(l.y - item.y) <= 2);
    if (existing) {
      existing.line += item.text;
    } else {
      lines.push({ y: item.y, line: item.text });
    }
  }
  // Already sorted descending by y because items were sorted that way

  // If destY is Infinity, use the topmost line
  const effectiveMaxY = destY === Infinity ? lines[0]?.y ?? 0 : destY;

  // Find lines at or below destY
  const startIdx = lines.findIndex((l) => l.y <= effectiveMaxY);
  if (startIdx === -1) return null;

  // Scan from startIdx downward to find first line matching REF_ENTRY_START_RE
  let entryStartIdx = -1;
  for (let i = startIdx; i < lines.length; i++) {
    if (REF_ENTRY_START_RE.test(lines[i].line.trim())) {
      entryStartIdx = i;
      break;
    }
  }

  // If not found below, scan upward from startIdx
  if (entryStartIdx === -1) {
    for (let i = startIdx - 1; i >= 0; i--) {
      if (REF_ENTRY_START_RE.test(lines[i].line.trim())) {
        entryStartIdx = i;
        break;
      }
    }
  }

  if (entryStartIdx === -1) return null;

  // Collect lines for this entry until the next entry start
  const entryLines: string[] = [];
  for (let i = entryStartIdx; i < lines.length; i++) {
    if (i > entryStartIdx && REF_ENTRY_START_RE.test(lines[i].line.trim())) break;
    entryLines.push(lines[i].line);
  }

  if (entryLines.length === 0) return null;

  const parsed = parseBibLines(entryLines);
  return parsed[0] ?? null;
}
