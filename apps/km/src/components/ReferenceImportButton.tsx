"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { invalidateTree } from "@/lib/tree-invalidate";

interface Props {
  libraryId: number;
  folderPath: string;
}

interface ImportResponse {
  imported: number;
  skipped: number;
  conflicts: Array<{ citationKey: string; reason: string; final?: string }>;
}

export function ReferenceImportButton({ libraryId, folderPath }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.set("libraryId", String(libraryId));
      form.set("folderPath", folderPath);
      form.set("file", file);
      const res = await fetch("/api/references/import", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as ImportResponse | { error?: string } | null;
      if (!res.ok) {
        const err = (body as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
        toast.error("Import failed", { description: err });
        return;
      }
      const r = body as ImportResponse;
      const parts = [`${r.imported} imported`];
      if (r.skipped > 0) parts.push(`${r.skipped} skipped`);
      toast.success(parts.join(", "));
      router.refresh();
      invalidateTree();
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="h-4 w-4" aria-hidden />
        {busy ? "Importing…" : "Import .bib / .ris / .json"}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".bib,.ris,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          if (f) void onFile(f);
        }}
      />
    </>
  );
}
