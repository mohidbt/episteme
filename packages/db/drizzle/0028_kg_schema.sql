CREATE TABLE "semantic_edges" (
	"user_id" text NOT NULL,
	"src_kind" text NOT NULL,
	"src_id" uuid NOT NULL,
	"dst_kind" text NOT NULL,
	"dst_id" uuid NOT NULL,
	"weight" real NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "semantic_edges_user_id_src_kind_src_id_dst_kind_dst_id_pk" PRIMARY KEY("user_id","src_kind","src_id","dst_kind","dst_id")
);
--> statement-breakpoint
CREATE TABLE "reference_embeddings" (
	"reference_id" uuid PRIMARY KEY NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_recompute" (
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"node_id" uuid NOT NULL,
	"enqueued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"tries" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pending_recompute_user_id_kind_node_id_pk" PRIMARY KEY("user_id","kind","node_id")
);
--> statement-breakpoint
ALTER TABLE "reference_embeddings" ADD CONSTRAINT "reference_embeddings_reference_id_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."references"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "semantic_edges_src" ON "semantic_edges" USING btree ("user_id","src_kind","src_id");--> statement-breakpoint
CREATE INDEX "semantic_edges_dst" ON "semantic_edges" USING btree ("user_id","dst_kind","dst_id");--> statement-breakpoint
CREATE INDEX "reference_embeddings_emb_idx" ON "reference_embeddings" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);--> statement-breakpoint
CREATE INDEX "pending_recompute_enqueued" ON "pending_recompute" USING btree ("enqueued_at");--> statement-breakpoint
CREATE INDEX "pending_recompute_claimed" ON "pending_recompute" USING btree ("claimed_at");--> statement-breakpoint
-- CHECK constraints (drizzle-kit doesn't emit these from .check() helpers in our version)
ALTER TABLE "semantic_edges"
  ADD CONSTRAINT "semantic_edges_src_kind_chk" CHECK (src_kind IN ('paper','note')),
  ADD CONSTRAINT "semantic_edges_dst_kind_chk" CHECK (dst_kind IN ('paper','note','reference'));
--> statement-breakpoint
ALTER TABLE "pending_recompute"
  ADD CONSTRAINT "pending_recompute_kind_chk" CHECK (kind IN ('paper','note'));
