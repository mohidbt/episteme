"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { invalidateDriveTree } from "@/lib/drive-sync";

export type DeleteToTrashKind = "paper" | "reference" | "note";

export function DeleteToTrashButton({
  libraryId,
  kind,
  id,
  title,
}: {
  libraryId: number;
  kind: DeleteToTrashKind;
  id: string;
  title: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    if (busy) return;
    const label = title?.trim() || "this item";
    if (!window.confirm(`Move "${label}" to Trash?`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/folders/trash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ libraryId, target: { kind, id } }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      toast.success("Moved to trash");
      invalidateDriveTree();
      router.push("/drive");
    } catch {
      toast.error("Failed to move to trash");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="destructive"
      size="sm"
      onClick={onDelete}
      disabled={busy}
    >
      <Trash2 aria-hidden className="size-3.5" />
      Delete
    </Button>
  );
}
