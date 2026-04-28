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
    try {
      const res = await fetch("/api/agent/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { thread: AgentThreadRow };
      if (data.thread?.threadId) {
        router.push(`/agents/${data.thread.threadId}`);
      }
    } catch {
      // Silent for MVP.
    } finally {
      setPending(false);
    }
  }, [pending, router]);

  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={pending}
      data-testid="new-conversation-button"
    >
      {pending ? "Starting…" : "New conversation"}
    </Button>
  );
}
