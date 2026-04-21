"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function RuledLinesToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  const router = useRouter();

  function toggle() {
    if (pending) return;
    const next = !on;
    const prev = on;
    setOn(next);
    start(async () => {
      const res = await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ruledLines: next }),
      });
      if (!res.ok) {
        setOn(prev);
        toast.error("Could not save ruled lines preference");
        return;
      }
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Ruled lines"
      disabled={pending}
      onClick={toggle}
      className={cn(
        "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-border transition-colors",
        "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        "disabled:pointer-events-none disabled:opacity-50",
        on ? "bg-primary" : "bg-muted",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow transition-transform",
          on ? "translate-x-5" : "translate-x-1",
        )}
      />
    </button>
  );
}
