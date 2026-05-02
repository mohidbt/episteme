"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import { X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "app-tabs-v1";
const DEFAULT_HREF = "/";
const DEFAULT_TITLE = "Drive";

/** /drive redirects to /, so normalize to the canonical path. */
function normalizeHref(href: string): string {
  if (href === "/drive") return "/";
  return href;
}

export type Tab = { href: string; title: string };

type TabsState = { tabs: Tab[]; activeHref: string | null };

type TabsApi = TabsState & {
  openTab: (href: string, title: string) => void;
  closeTab: (href: string) => void;
  setActive: (href: string) => void;
};

const Ctx = createContext<TabsApi | null>(null);

const DEFAULT_STATE: TabsState = { tabs: [], activeHref: null };

function loadFromStorage(): TabsState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TabsState>;
    const tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs
          .filter(
            (t): t is Tab =>
              !!t && typeof t.href === "string" && typeof t.title === "string",
          )
          .map((t) => ({ ...t, href: normalizeHref(t.href) }))
      : [];
    const activeHref = typeof parsed.activeHref === "string"
      ? normalizeHref(parsed.activeHref)
      : null;
    return { tabs, activeHref };
  } catch {
    return null;
  }
}

export function TabBarProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  // Initialize with the same default the server renders to avoid SSR/client
  // hydration mismatch. localStorage is read in a mount-only effect below.
  const [state, setState] = useState<TabsState>(DEFAULT_STATE);
  const persistedRef = useRef(false);

  // Hydrate from localStorage after mount (client-only).
  useEffect(() => {
    const stored = loadFromStorage();
    if (stored && (stored.tabs.length > 0 || stored.activeHref)) {
      setState(stored);
    }
    persistedRef.current = true;
  }, []);

  // Persist on change — but only after the initial hydration pass, so we
  // don't overwrite stored state with the default on first commit.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!persistedRef.current) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* quota / disabled storage — ignore */
    }
  }, [state]);

  // Sync tab state with the current pathname — always ensure a tab exists
  // for wherever the user has navigated.
  useEffect(() => {
    if (!pathname) return;
    const href = normalizeHref(pathname);
    setState((prev) => {
      const exists = prev.tabs.some((t) => t.href === href);
      if (exists) {
        if (prev.activeHref === href) return prev;
        return { ...prev, activeHref: href };
      }
      return {
        tabs: [...prev.tabs, { href, title: titleFromHref(href) }],
        activeHref: href,
      };
    });
  }, [pathname]);

  const openTab = useCallback(
    (href: string, title: string) => {
      const normalized = normalizeHref(href);
      setState((prev) => {
        const exists = prev.tabs.some((t) => t.href === normalized);
        const tabs = exists
          ? prev.tabs
          : [...prev.tabs, { href: normalized, title }];
        return { tabs, activeHref: normalized };
      });
      router.push(normalized);
    },
    [router],
  );

  const closeTab = useCallback(
    (href: string) => {
      const normalized = normalizeHref(href);
      setState((prev) => {
        const idx = prev.tabs.findIndex((t) => t.href === normalized);
        if (idx === -1) return prev;
        const tabs = prev.tabs.filter((t) => t.href !== normalized);
        let activeHref = prev.activeHref;
        if (activeHref === normalized) {
          const next = tabs[idx] ?? tabs[idx - 1] ?? null;
          activeHref = next?.href ?? DEFAULT_HREF;
          router.push(activeHref);
        }
        // Never leave zero tabs — fall back to default
        if (tabs.length === 0) {
          return {
            tabs: [{ href: DEFAULT_HREF, title: DEFAULT_TITLE }],
            activeHref: DEFAULT_HREF,
          };
        }
        return { tabs, activeHref };
      });
    },
    [router],
  );

  const setActive = useCallback(
    (href: string) => {
      const normalized = normalizeHref(href);
      setState((prev) => ({ ...prev, activeHref: normalized }));
      router.push(normalized);
    },
    [router],
  );

  const value = useMemo<TabsApi>(
    () => ({ ...state, openTab, closeTab, setActive }),
    [state, openTab, closeTab, setActive],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTabs(): TabsApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTabs must be used within TabBarProvider");
  return ctx;
}

function titleFromHref(href: string): string {
  if (href === "/") return "Drive";
  if (href.startsWith("/drive/")) return lastSegment(href);
  if (href.startsWith("/papers/folder/")) return lastSegment(href);
  if (href.startsWith("/papersets")) return "Papersets";
  if (href.startsWith("/papers")) return "Papers";
  if (href.startsWith("/references/folder/")) return lastSegment(href);
  if (href.startsWith("/references")) return "References";
  if (href.startsWith("/notes")) return "Notes";
  if (href.startsWith("/n/")) return decodeURIComponent(href.slice(3));
  if (href.startsWith("/p/")) return "Paper";
  if (href.startsWith("/d/")) return "Paperset";
  if (href.startsWith("/r/")) return "Reference";
  if (href.startsWith("/tags")) return lastSegment(href) || "Tags";
  if (href.startsWith("/agents")) return "Agent";
  if (href.startsWith("/settings")) return "Settings";
  if (href.startsWith("/trash")) return "Trash";
  return lastSegment(href) || href;
}

function lastSegment(href: string): string {
  const seg = href.split("/").filter(Boolean).pop();
  return seg ? decodeURIComponent(seg) : "";
}

export function TabBar() {
  const { tabs, activeHref, setActive, closeTab, openTab } = useTabs();

  return (
    <div
      role="tablist"
      aria-label="Open tabs"
      className="flex shrink-0 items-end gap-0 bg-[var(--bg-roof)] px-3 pt-5 h-[52px] overflow-x-auto"
      style={{ "--tabbar-h": "52px" } as React.CSSProperties}
    >
      {tabs.map((tab) => {
        const active = tab.href === activeHref;
        return (
          <div
            key={tab.href}
            role="tab"
            aria-selected={active}
            data-testid="tab-bar-tab"
            data-href={tab.href}
            className={cn(
              "group relative flex h-8 max-w-[280px] items-center gap-1.5 px-3 text-[12.5px] rounded-t-lg",
              active
                ? "bg-background text-foreground font-medium border border-[var(--roof-border)] border-b-0 -mb-px z-10"
                : "text-[var(--fg-muted)] hover:bg-[var(--bg-roof-2)]",
            )}
          >
            <button
              type="button"
              onClick={() => setActive(tab.href)}
              className="min-w-0 flex-1 truncate text-left"
              title={tab.href}
            >
              {tab.title}
            </button>
            <button
              type="button"
              aria-label={`Close ${tab.title}`}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.href);
              }}
              className="rounded p-0.5 text-[var(--fg-muted)] opacity-0 hover:bg-[var(--bg-roof-2)] hover:text-[var(--fg)] group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        data-testid="tab-bar-new"
        aria-label="New tab"
        onClick={() => openTab(DEFAULT_HREF, DEFAULT_TITLE)}
        className="mb-px flex h-8 w-8 items-center justify-center rounded-lg text-[var(--fg-muted)] hover:bg-[var(--bg-roof-2)] hover:text-[var(--fg)]"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}