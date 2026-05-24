import { pgTable, text, uuid, timestamp, primaryKey, index } from "drizzle-orm/pg-core";
import { papers } from "./papers";
import { user } from "./auth";

// K8 — Thread→paper association so the reader sidebar can list past agent
// threads scoped to the currently open paper. thread_id is the LangGraph
// checkpointer's thread id (text, user-supplied at /invoke); paper_id is the
// active reader paper. user_id is mandatory for tenant scoping on reads.
export const agentThreadPapers = pgTable(
  "agent_thread_papers",
  {
    threadId: text("thread_id").notNull(),
    paperId: uuid("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.threadId, t.paperId] }),
    index("agent_thread_papers_user_paper_idx").on(t.userId, t.paperId, t.createdAt),
  ],
);
