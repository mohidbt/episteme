import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notes, user } from "@episteme/db/schema";

export type PublicNote = {
  title: string;
  contentMd: string;
  updatedAt: Date;
  authorName: string;
  username: string;
};

export const getPublicNote = cache(
  async (username: string, slug: string): Promise<PublicNote | null> => {
    if (!username || !slug) return null;
    const [row] = await db
      .select({
        title: notes.title,
        contentMd: notes.contentMd,
        updatedAt: notes.updatedAt,
        authorName: user.name,
        username: user.username,
      })
      .from(notes)
      .innerJoin(user, eq(user.id, notes.userId))
      .where(
        and(
          eq(user.username, username),
          eq(notes.publicSlug, slug),
          eq(notes.isPublic, true),
        ),
      );
    if (!row || row.username == null) return null;
    return row as PublicNote;
  },
);
