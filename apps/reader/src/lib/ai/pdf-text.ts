// Server-side PDF text extraction using unpdf (serverless-compatible, no native deps)
import { extractText, getDocumentProxy } from "unpdf";
import { getFile } from "@/lib/storage";

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

export async function extractPdfPages(filePath: string): Promise<ExtractedPage[]> {
  const buffer = await getFile(filePath);
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  // mergePages: false returns string[] — one entry per page
  const { totalPages, text } = await extractText(pdf, { mergePages: false });

  const pages: ExtractedPage[] = [];
  for (let i = 0; i < totalPages; i++) {
    pages.push({ pageNumber: i + 1, text: text[i] ?? "" });
  }
  return pages;
}
