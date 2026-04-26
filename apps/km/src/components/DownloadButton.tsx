"use client";

import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

function buildFilename(slug: string): string {
  // Strip trailing .md to avoid double suffix
  const stripped = slug.endsWith(".md") ? slug.slice(0, -3) : slug;
  // Sanitize: replace anything outside [a-zA-Z0-9-_] with hyphen
  const sanitized = stripped.replace(/[^a-zA-Z0-9\-_]/g, "-");
  if (!sanitized) return "note.md";
  return `${sanitized}.md`;
}

export function DownloadButton({
  slug,
  getMarkdown,
}: {
  slug: string;
  getMarkdown: () => string;
}) {
  const handleDownload = () => {
    const md = getMarkdown();
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = buildFilename(slug);
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Button variant="ghost" size="sm" onClick={handleDownload}>
      <DownloadIcon className="mr-1 h-4 w-4" />
      Download
    </Button>
  );
}
