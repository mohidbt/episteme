export function getUserIdFromRequest(req: Request): string | null {
  return req.headers.get("x-user-id");
}
