export function streamPassthrough(upstream: Response): Response {
  if (!upstream.ok) {
    // GSD-126 P0: 402 from the agents service means the user's managed
    // OR bucket is drained. Replace the (possibly empty / SSE-shaped)
    // body with a stable JSON code the UI can switch on.
    if (upstream.status === 402) {
      return Response.json({ error: "trial_exhausted" }, { status: 402 });
    }
    return new Response(upstream.body, { status: upstream.status });
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
