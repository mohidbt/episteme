"use client";

import { pdfjs } from "react-pdf";

// Worker must be set in the same module as react-pdf usage (per react-pdf docs)
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

export function usePdfDocument(documentId: number) {
  const url = `/api/documents/${documentId}/file`;
  return { url };
}
