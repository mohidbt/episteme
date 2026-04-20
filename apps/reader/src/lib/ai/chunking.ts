import type { ExtractedPage } from "./pdf-text";

export interface DocumentChunk {
  chunkIndex: number;
  content: string;
  pageStart: number;
  pageEnd: number;
  tokenCount: number;
}

const APPROX_CHARS_PER_TOKEN = 4;
const CHUNK_TOKENS = 500;
const OVERLAP_TOKENS = 50;

export function chunkPages(pages: ExtractedPage[]): DocumentChunk[] {
  const stream: { ch: string; page: number }[] = [];
  for (const p of pages) {
    for (const ch of p.text) stream.push({ ch, page: p.pageNumber });
    stream.push({ ch: "\n", page: p.pageNumber });
  }

  const chunkChars = CHUNK_TOKENS * APPROX_CHARS_PER_TOKEN;
  const overlapChars = OVERLAP_TOKENS * APPROX_CHARS_PER_TOKEN;
  const step = chunkChars - overlapChars;

  const chunks: DocumentChunk[] = [];
  let idx = 0;
  for (let start = 0; start < stream.length; start += step) {
    const end = Math.min(start + chunkChars, stream.length);
    const slice = stream.slice(start, end);
    if (slice.length === 0) break;
    const content = slice.map((s) => s.ch).join("").trim();
    if (!content) continue;
    chunks.push({
      chunkIndex: idx++,
      content,
      pageStart: slice[0].page,
      pageEnd: slice[slice.length - 1].page,
      tokenCount: Math.ceil(slice.length / APPROX_CHARS_PER_TOKEN),
    });
    if (end === stream.length) break;
  }
  return chunks;
}
