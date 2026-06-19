"use client";

// G17 — Per-row "fill missing" action.
// Posts known fields + missing field names to /api/ai-fill, shows the preview
// inside a confirm() dialog (one-time, no auto-apply), and on accept calls
// the supplied PATCH path. Uses ⬡ glyph per G3 convention.
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { isOpenRouterKeyError } from "@/lib/openrouter-errors";
import { renderOpenRouterKeyToastDescription } from "@/components/OpenRouterKeyErrorToast";
import { suggestionsToCslPatch } from "@/lib/csl";
import {
  TrialExhaustedError,
  fetchOrThrowTrialExhausted,
  surfaceTrialExhaustedToast,
} from "@/lib/trial-exhausted";

interface Props {
  /** Endpoint that PATCHes accepted suggestions (e.g. `/api/papers/ID`). */
  patchUrl: string;
  /** "paper" or "reference" — used in the prompt. */
  kind: "paper" | "reference";
  /** Known field values for the row. */
  known: Record<string, unknown>;
  /** Missing fields the LLM should fill. Empty = button disabled. */
  missing: string[];
  /** Optional label override for screen readers. */
  ariaLabel?: string;
  /** Optional CSS classes appended to the button. */
  className?: string;
  /** Existing CSL JSON for the row (needed to merge suggestions into cslJson). */
  cslJson?: Record<string, unknown> | null;
  /** Called when the fill request starts (for animation). */
  onFillStart?: () => void;
  /** Called when the fill request ends, success or failure (for animation). */
  onFillEnd?: () => void;
}

export function AiFillButton({
  patchUrl,
  kind,
  known,
  missing,
  ariaLabel,
  className,
  cslJson,
  onFillStart,
  onFillEnd,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const disabled = missing.length === 0 || busy;

  async function onClick() {
    if (disabled) return;
    setBusy(true);
    onFillStart?.();
    try {
      const res = await fetchOrThrowTrialExhausted("/api/ai-fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, known, missing }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (isOpenRouterKeyError(body.error)) {
          toast.error("OpenRouter API key missing or invalid", {
            description: renderOpenRouterKeyToastDescription(),
          });
          return;
        }
        toast.error("AI fill failed", { description: `HTTP ${res.status}` });
        return;
      }
      const data = (await res.json()) as { suggestions: Record<string, unknown> };
      const suggestions = data.suggestions ?? {};
      const keys = Object.keys(suggestions);
      if (keys.length === 0) {
        toast.message("No suggestions returned");
        return;
      }
      const previewLines = keys.map((k) => `${k}: ${formatValue(suggestions[k])}`).join("\n");
      const ok = window.confirm(`Apply these suggestions?\n\n${previewLines}`);
      if (!ok) return;

      // For references, suggestions use denormalised field names (title, authors,
      // year, doi, venue) but the PATCH endpoint only accepts cslJson. Convert
      // and merge into existing cslJson before PATCHing.
      const patchBody =
        kind === "reference"
          ? { cslJson: suggestionsToCslPatch(suggestions, cslJson ?? {}) }
          : suggestions;

      const patch = await fetch(patchUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      });
      if (!patch.ok) {
        toast.error("Apply failed", { description: `HTTP ${patch.status}` });
        return;
      }
      toast.success("Filled");
      router.refresh();
    } catch (err) {
      if (err instanceof TrialExhaustedError) {
        surfaceTrialExhaustedToast();
      } else {
        toast.error("AI fill failed");
      }
    } finally {
      setBusy(false);
      onFillEnd?.();
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel ?? `Fill missing fields with AI`}
      data-testid="ai-fill-button"
      data-ai-filling={busy || undefined}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
        disabled && "pointer-events-none opacity-30",
        className,
      )}
    >
      {busy ? (
        <Loader2 aria-hidden className="size-3.5 animate-spin" />
      ) : (
        <span aria-hidden="true" className="text-sm leading-none">⬡</span>
      )}
    </button>
  );
}

function formatValue(v: unknown): string {
  if (Array.isArray(v)) return v.join(", ");
  if (v == null) return "";
  return String(v);
}