"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function CreateLibraryEmptyState() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const onCreate = async () => {
    setPending(true);
    try {
      const res = await fetch("/api/libraries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "My Library" }),
      });
      if (!res.ok) return;
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-start gap-3 p-4">
      <p className="font-display text-lg leading-tight text-sidebar-foreground">
        No library yet
      </p>
      <p className="text-sm text-muted-foreground">
        Create one to start organising papers, references, and notes.
      </p>
      <Button size="sm" onClick={onCreate} disabled={pending}>
        {pending ? "Creating…" : "Create library"}
      </Button>
    </div>
  );
}
