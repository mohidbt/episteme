"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { AgentThreadRow } from "@/lib/threads";

export function NewConversationButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const onClick = useCallback(async () => {
    if (pending) return;
    setPending(true);
    let navigated = false;
    try {
      const res = await fetch("/api/agent/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        setPending(false);
        return;
      }
      const data = (await res.json()) as { thread: AgentThreadRow };
      if (data.thread?.threadId) {
        navigated = true;
        router.push(`/agents/${data.thread.threadId}`);
      }
    } catch {
      // Silent for MVP.
    } finally {
      if (!navigated) setPending(false);
    }
  }, [pending, router]);

  // Keep label width stable across pending/idle to avoid layout shift (#169):
  // overlay both labels in a grid cell, swap visibility only.
  return (
    <Button
      type="button"
      onClick={onClick}
      data-testid="new-conversation-button"
      aria-busy={pending}
    >
      <span className="grid">
        <span
          className="col-start-1 row-start-1"
          aria-hidden={pending}
          style={{ visibility: pending ? "hidden" : "visible" }}
        >
          New conversation
        </span>
        <span
          className="col-start-1 row-start-1"
          aria-hidden={!pending}
          style={{ visibility: pending ? "visible" : "hidden" }}
        >
          Starting…
        </span>
      </span>
    </Button>
  );
}
