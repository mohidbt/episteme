"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type FontPref = "sans" | "serif" | "mono";

const OPTIONS: { value: FontPref; label: string }[] = [
  { value: "sans", label: "Sans" },
  { value: "serif", label: "Serif" },
  { value: "mono", label: "Mono" },
];

export function FontToggle({ initial }: { initial: FontPref }) {
  const [value, setValue] = useState<FontPref>(initial);
  const [pending, start] = useTransition();
  const router = useRouter();

  function choose(next: FontPref) {
    if (next === value || pending) return;
    const prev = value;
    setValue(next);
    start(async () => {
      const res = await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ font: next }),
      });
      if (!res.ok) {
        setValue(prev);
        toast.error("Could not save font preference");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div
      role="group"
      aria-label="Editor font"
      data-slot="button-group"
      className="inline-flex items-center gap-1 rounded-lg border border-border bg-background p-0.5"
    >
      {OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <Button
            key={opt.value}
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={active}
            data-active={active ? "true" : undefined}
            disabled={pending}
            onClick={() => choose(opt.value)}
            className={cn(
              active && "bg-muted text-foreground",
            )}
          >
            {opt.label}
          </Button>
        );
      })}
    </div>
  );
}
