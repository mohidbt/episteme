export function streamPassthrough(upstream: Response): Response {
  if (!upstream.ok) {
    // GSD-126 P0: 402 from the agents service means the user's managed
    // OR bucket is drained. Replace the (possibly empty / SSE-shaped)
    // body with a stable JSON code the UI can switch on.
    if (upstream.status === 402) {
      return Response.json({ error: "trial_exhausted" }, { status: 402 });
    }
    // Preserve upstream Content-Type when present (agents-side structured
    // errors like 404 {"detail": "source_pdf_missing"} from GSD-135 send
    // JSON; without the header the browser may treat the body as text).
    const upstreamContentType = upstream.headers.get("content-type");
    return new Response(upstream.body, {
      status: upstream.status,
      headers: upstreamContentType
        ? { "Content-Type": upstreamContentType }
        : undefined,
    });
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
