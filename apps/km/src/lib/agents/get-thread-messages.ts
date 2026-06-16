import { signRequest } from "@/lib/agents/sign-request";
import type { Citation } from "@/lib/agent-events";

export type PersistedMessagePart =
  | { type: "text"; text: string }
  | {
      type: "tool-call";
      id: string;
      name: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool-result";
      id: string;
      output?: unknown;
      errorText?: string;
    };

export interface PersistedMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /**
   * G-R3-07 #78 — when the assistant turn included tool calls/results, the
   * agents service emits a structured `parts` array so hydration can rebuild
   * the rich `<Tool>` cards instead of falling back to a flat text bubble
   * (which previously rendered the literal "thought" model leakage).
   */
  parts?: PersistedMessagePart[];
  /**
   * BG1 — inline citations stamped onto the AIMessage in the checkpoint at
   * stream-finalize time. Present on assistant messages whose live SSE turn
   * emitted a `sources` event; absent otherwise. Seeded into
   * `sourcesByMessage` on hydration so reload restores citation pills.
   */
  citations?: Citation[];
}

/**
 * Fetch the persisted message list for a thread directly from the FastAPI
 * agents service, bypassing the local Next.js `/api/agents/km/state/[thread]`
 * route handler.
 *
 * Why bypass the local route?
 *   - The previous implementation did `fetch(${proto}://${host}/api/agents/...)`
 *     from the Server Component, which forced the request to round-trip over
 *     loopback through the Next.js dev/prod server back into another route
 *     handler that itself called FastAPI. That added one full HTTP hop, an
 *     extra HMAC sign step, cookie revalidation, and `cache: "no-store"`
 *     header processing for what should be an in-process call.
 *
 * This helper signs the request once and calls the FastAPI sidecar directly.
 *
 * NOTE on caching: we currently keep this uncached (per-request) because
 * thread state mutates on every agent turn and there is no `revalidateTag`
 * plumbing wired up for thread writes yet. Adding tag-based invalidation
 * is a follow-up — see issue #65.
 */
export async function getThreadMessages(
  userId: string,
  threadId: string,
): Promise<PersistedMessage[]> {
  const agentsUrl = process.env.AGENTS_URL;
  if (!agentsUrl) return [];

  const path = `/agents/km/state/${threadId}`;
  const { headers } = signRequest({
    method: "GET",
    path,
    body: "",
    userId,
    // llmKey not needed for state reads — kept empty for HMAC consistency.
    llmKey: "",
  });

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${agentsUrl}${path}`, {
      method: "GET",
      headers: { ...headers } as Record<string, string>,
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { messages?: PersistedMessage[] };
    return Array.isArray(data.messages) ? data.messages : [];
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}
