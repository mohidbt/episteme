import type { DocumentSegmentKind, DocumentSegmentPayload } from "@episteme/db/schema/document-segments";

export interface SegmentForSeed {
  kind: DocumentSegmentKind;
  payload: DocumentSegmentPayload;
}

export function buildExplainSeed(seg: SegmentForSeed): string {
  const label = seg.kind === "section_header" ? "section" : seg.kind;
  let payloadLine = "";
  if (seg.kind === "section_header" && seg.payload.text) {
    payloadLine = `\n\n"${seg.payload.text}"`;
  } else if (seg.kind === "figure" && seg.payload.caption) {
    payloadLine = `\n\nCaption: ${seg.payload.caption}`;
  } else if (seg.kind === "formula" && seg.payload.latex) {
    const clean = seg.payload.latex
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
    payloadLine = clean ? `\n\n$$${clean}$$` : "";
  }
  return `Explain this ${label}.${payloadLine}`;
}
