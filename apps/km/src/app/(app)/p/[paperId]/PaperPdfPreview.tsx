import Link from "next/link";
import { BookOpen, Download, FileText } from "lucide-react";

export function PaperPdfPreview({
  paperId,
  filename,
  title,
}: {
  paperId: string;
  filename: string;
  title: string;
}) {
  return (
    <div className="flex h-full min-h-[60vh] items-center justify-center bg-muted/30 p-6 lg:min-h-0">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-md border border-border bg-background">
          <FileText className="h-7 w-7 text-muted-foreground" aria-hidden />
        </div>
        <div className="min-w-0 space-y-1">
          <h2 className="truncate text-base font-medium">{title}</h2>
          <p className="truncate text-sm text-muted-foreground">{filename}</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Link
            href={`/papers/${paperId}/read`}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <BookOpen className="h-4 w-4" aria-hidden />
            Open reader
          </Link>
          <Link
            href={`/api/papers/${paperId}/file`}
            download={filename}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <Download className="h-4 w-4" aria-hidden />
            Download
          </Link>
        </div>
      </div>
    </div>
  );
}
