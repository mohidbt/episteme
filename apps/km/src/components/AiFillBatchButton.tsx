"use client";

// G17 — Batch "fill all missing" trigger. Iterates over the visible rows
// that have at least one missing field and calls /api/ai-fill for each
// (sequential to avoid hammering OpenRouter). Each suggestion patch goes
// through the per-row PATCH URL. NO confirmation per row in batch mode —
// the user already opted in by clicking "Fill all visible".
import { useState } from "react";
import { Wand2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { isOpenRouterKeyError } from "@/lib/openrouter-errors";
import { renderOpenRouterKeyToastDescription } from "@/components/OpenRouterKeyErrorToast";

export interface BatchRow {
  id: string;
  patchUrl: string;
  known: Record<string, unknown>;
  missing: string[];
}

interface Props {
  kind: "paper" | "reference";
  rows: BatchRow[];
}

export function AiFillBatchButton({ kind, rows }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const candidates = rows.filter((r) => r.missing.length > 0);
  const disabled = candidates.length === 0 || busy;

  async function onClick() {
    if (disabled) return;
    if (
      !window.confirm(
        `Fill missing fields for ${candidates.length} ${kind}${candidates.length === 1 ? "" : "s"}? Suggestions will be applied directly.`,
      )
    ) {
      return;
    }
    setBusy(true);
    let filled = 0;
    let failed = 0;
    let keyErrorSeen = false;
    for (const row of candidates) {
      try {
        const res = await fetch("/api/ai-fill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, known: row.known, missing: row.missing }),
        });
        if (!res.ok) {
          if (!keyErrorSeen) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            if (isOpenRouterKeyError(body.error)) {
              keyErrorSeen = true;
              break;
            }
          }
          failed++;
          continue;
        }
        const data = (await res.json()) as { suggestions: Record<string, unknown> };
        if (!data.suggestions || Object.keys(data.suggestions).length === 0) continue;
        const patch = await fetch(row.patchUrl, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data.suggestions),
        });
        if (patch.ok) filled++;
        else failed++;
      } catch {
        failed++;
      }
    }
    setBusy(false);
    if (keyErrorSeen) {
      toast.error("OpenRouter API key missing or invalid", {
        description: renderOpenRouterKeyToastDescription(),
      });
    }
    if (filled > 0) toast.success(`Filled ${filled} row${filled === 1 ? "" : "s"}`);
    if (failed > 0 && !keyErrorSeen)
      toast.error(`Failed on ${failed} row${failed === 1 ? "" : "s"}`);
    router.refresh();
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      data-testid="ai-fill-batch-button"
    >
      {busy ? (
        <Loader2 aria-hidden className="size-3.5 animate-spin" />
      ) : (
        <Wand2 aria-hidden className="size-3.5" />
      )}
      {busy ? "Filling…" : `Fill all missing (${candidates.length})`}
    </Button>
  );
}
