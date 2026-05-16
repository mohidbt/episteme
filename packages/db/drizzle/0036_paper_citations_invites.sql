-- D2: paper_citations polymorphic edge table + invite_codes.
--
-- paper_citations stores edges from a citing source (paper) to either an
-- existing paper in the system OR a free-floating document_references row
-- ("reference fallback"). Polymorphic by (kind, id) columns; UNIQUE keeps
-- auto-link idempotent. match_method records provenance for debugging /
-- manual UI: 'doi' (exact DOI), 'title-fuzzy', or 'manual' (user edit).
--
-- invite_codes is a flat allowlist of human-shareable codes redeemed at
-- signup. one row per code; used_by_user_id stamped on redemption.
--
-- NEW TABLES ONLY — no ALTER on legacy tables, migrate_only role safe.

CREATE TABLE IF NOT EXISTS "paper_citations" (
  "id" bigserial PRIMARY KEY,
  "citer_kind" text NOT NULL CHECK ("citer_kind" IN ('paper','reference')),
  "citer_id" text NOT NULL,
  "cited_kind" text NOT NULL CHECK ("cited_kind" IN ('paper','reference')),
  "cited_id" text NOT NULL,
  "source_marker_idx" integer,
  "match_method" text NOT NULL CHECK ("match_method" IN ('doi','title-fuzzy','manual')),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("citer_kind", "citer_id", "cited_kind", "cited_id"),
  CHECK (NOT ("citer_kind" = "cited_kind" AND "citer_id" = "cited_id"))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pc_citer" ON "paper_citations"("citer_kind","citer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pc_cited" ON "paper_citations"("cited_kind","cited_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invite_codes" (
  "code" text PRIMARY KEY,
  "used_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "used_at" timestamptz,
  "created_by_user_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_invite_used_by" ON "invite_codes"("used_by_user_id") WHERE "used_by_user_id" IS NOT NULL;
