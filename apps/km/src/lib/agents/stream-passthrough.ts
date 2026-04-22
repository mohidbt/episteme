export function streamPassthrough(upstream: Response): Response {
  if (!upstream.ok) {
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
