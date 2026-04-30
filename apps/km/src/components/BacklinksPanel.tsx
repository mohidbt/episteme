"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface BacklinkSource {
  id: string;
  title: string;
  slug: string;
  snippet: string;
}

export function BacklinksPanel({ noteId }: { noteId: string }) {
  const [sources, setSources] = useState<BacklinkSource[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/notes/${noteId}/backlinks`)
      .then((r) => (r.ok ? r.json() : { sources: [] }))
      .then((data: { sources: BacklinkSource[] }) => {
        if (!cancelled) setSources(data.sources ?? []);
      })
      .catch(() => {
        if (!cancelled) setSources([]);
      });
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  if (!sources || sources.length === 0) return null;

  return (
    <details className="mt-8 border-t pt-6" open>
      <summary className="cursor-pointer text-sm font-medium text-muted-foreground select-none">
        Linked from ({sources.length})
      </summary>
      <ul className="mt-3 space-y-3">
        {sources.map((s) => (
          <li key={s.id}>
            <Link
              href={`/n/${s.slug}`}
              className="block rounded-md border px-3 py-2 hover:bg-accent transition-colors"
            >
              <div className="text-sm font-medium">{s.title}</div>
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
