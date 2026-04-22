export interface NoteChunk {
  chunkIdx: number;
  content: string;
}

export const CHUNK_CHAR_CAP = 2500;

export function chunkMarkdown(md: string): NoteChunk[] {
  if (!md.trim()) return [];
  const paragraphs = md
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const chunks: NoteChunk[] = [];
  let buf = "";
  for (const p of paragraphs) {
    const sep = buf ? "\n\n" : "";
    const candidate = buf + sep + p;
    if (candidate.length > CHUNK_CHAR_CAP && buf.length > 0) {
      chunks.push({ chunkIdx: chunks.length, content: buf });
      buf = p;
    } else {
      buf = candidate;
    }
  }
  if (buf) chunks.push({ chunkIdx: chunks.length, content: buf });
  return chunks;
}
