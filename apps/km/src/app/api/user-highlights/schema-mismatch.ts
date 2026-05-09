import { jsonError } from "@/lib/crud";

type DbErrorLike = {
  code?: unknown;
  message?: unknown;
};

function isMissingPaperIdError(error: unknown): boolean {
  const e = error as DbErrorLike | null;
  if (!e || e.code !== "42703") return false;
  const msg = typeof e.message === "string" ? e.message.toLowerCase() : "";
  return msg.includes("paper_id");
}

export function schemaMismatchResponseIfNeeded(error: unknown): Response | null {
  if (!isMissingPaperIdError(error)) return null;
  return jsonError(503, "schema_mismatch", {
    message: "Database schema mismatch detected. Run migrations and `pnpm db:predeploy-check`.",
  });
}

