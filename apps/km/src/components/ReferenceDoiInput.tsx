"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { denormaliseForList, type CslItem } from "@/lib/csl";

interface ReferenceDoiInputProps {
  libraryId: number;
  folderPath: string;
}

type LookupState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; csl: CslItem }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

const DEBOUNCE_MS = 300;

export function ReferenceDoiInput({ libraryId, folderPath }: ReferenceDoiInputProps) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [state, setState] = useState<LookupState>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const reqIdRef = useRef(0);

  useEffect(() => {
    const doi = value.trim();
    if (!doi) {
      setState({ kind: "idle" });
      return;
    }
    const reqId = ++reqIdRef.current;
    setState({ kind: "loading" });
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/doi/${encodeURIComponent(doi)}`);
        if (reqId !== reqIdRef.current) return;
        if (res.status === 404) {
          setState({ kind: "not_found" });
          return;
        }
        if (!res.ok) {
          setState({ kind: "error", message: `HTTP ${res.status}` });
          return;
        }
        const csl = (await res.json()) as CslItem;
        setState({ kind: "found", csl });
      } catch (err) {
        if (reqId !== reqIdRef.current) return;
        setState({ kind: "error", message: (err as Error).message });
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [value]);

  async function onImport() {
    const doi = value.trim();
    if (!doi || state.kind !== "found") return;
    setBusy(true);
    try {
      const res = await fetch("/api/references", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ libraryId, folderPath, doi }),
      });
      if (res.status === 201) {
        toast.success("Reference imported");
        setValue("");
        setState({ kind: "idle" });
        router.refresh();
        return;
      }
      const body = await res.json().catch(() => null);
      if (res.status === 409 && body?.suggestion) {
        toast.error("Citation key conflict", {
          description: `Suggested: ${body.suggestion}`,
        });
        return;
      }
      toast.error("Import failed", {
        description: body?.error ?? body?.message ?? `HTTP ${res.status}`,
      });
    } finally {
      setBusy(false);
    }
  }

  const preview = state.kind === "found" ? denormaliseForList(state.csl) : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
          placeholder="Enter DOI (e.g. 10.1038/nature12373)"
        />
        <Button
          type="button"
          onClick={onImport}
          disabled={busy || state.kind !== "found"}
        >
          {busy ? "Importing…" : "Import"}
        </Button>
      </div>
      <StateLine state={state} preview={preview} />
    </div>
  );
}

function StateLine({
  state,
  preview,
}: {
  state: LookupState;
  preview: ReturnType<typeof denormaliseForList> | null;
}) {
  if (state.kind === "idle") return null;
  if (state.kind === "loading") {
    return <p className="text-xs text-muted-foreground">Looking up DOI…</p>;
  }
  if (state.kind === "not_found") {
    return <p className="text-xs text-destructive">DOI not found</p>;
  }
  if (state.kind === "error") {
    return (
      <p className="text-xs text-destructive">
        Lookup failed: {state.message}
      </p>
    );
  }
  if (!preview) return null;
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm">
      <p className="line-clamp-2 font-medium">{preview.title || "(untitled)"}</p>
      <p className="text-xs text-muted-foreground">
        {[preview.authorsText, preview.year ?? undefined].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}
