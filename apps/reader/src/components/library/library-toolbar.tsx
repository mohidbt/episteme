"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type SortKey = "recent" | "uploaded" | "title";

const LABELS: Record<SortKey, string> = {
  recent: "Recently opened",
  uploaded: "Upload date",
  title: "Title",
};

export function LibraryToolbar({ sort, q }: { sort: SortKey; q: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [text, setText] = useState(q);

  useEffect(() => { setText(q); }, [q]);

  function push(next: URLSearchParams) {
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
  }

  function onSort(value: string) {
    const next = new URLSearchParams(params);
    if (value === "recent") next.delete("sort"); else next.set("sort", value);
    push(next);
  }

  useEffect(() => {
    const t = setTimeout(() => {
      const trimmed = text.trim();
      const next = new URLSearchParams(params);
      if (trimmed) next.set("q", trimmed); else next.delete("q");
      if (next.toString() !== params.toString()) push(next);
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div className="mt-6 flex items-center justify-between gap-3 border-b pb-3">
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Search title or filename…"
        className="max-w-sm h-9 bg-transparent border-0 border-b border-transparent focus-visible:ring-0 focus-visible:border-foreground/30 rounded-none px-0"
        data-testid="library-search"
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm" data-testid="library-sort">
              <span className="text-muted-foreground">Sort:</span>
              {LABELS[sort]}
              <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="min-w-[10rem]">
          <DropdownMenuRadioGroup value={sort} onValueChange={onSort}>
            {(Object.keys(LABELS) as SortKey[]).map((k) => (
              <DropdownMenuRadioItem key={k} value={k}>
                {LABELS[k]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
