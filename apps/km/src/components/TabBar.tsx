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
const DEFAULT_HREF = "/drive";
const DEFAULT_TITLE = "Drive";

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
      ? parsed.tabs.filter(
          (t): t is Tab =>
            !!t && typeof t.href === "string" && typeof t.title === "string",
        )
      : [];
    const activeHref =
      typeof parsed.activeHref === "string" ? parsed.activeHref : null;
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
  const hydratedRef = useRef(false);

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

  // Track current pathname as the active tab; if no tab matches, add an
  // ephemeral one so the user always sees where they are.
  useEffect(() => {
    if (!pathname) return;
    setState((prev) => {
      const exists = prev.tabs.some((t) => t.href === pathname);
      if (exists) {
        if (prev.activeHref === pathname) return prev;
        return { ...prev, activeHref: pathname };
      }
      // First load: seed a tab for the current page so user sees it.
      if (!hydratedRef.current && prev.tabs.length === 0) {
        hydratedRef.current = true;
        return {
          tabs: [{ href: pathname, title: titleFromHref(pathname) }],
          activeHref: pathname,
        };
      }
      return prev;
    });
    hydratedRef.current = true;
  }, [pathname]);

  const openTab = useCallback(
    (href: string, title: string) => {
      setState((prev) => {
        const exists = prev.tabs.some((t) => t.href === href);
        const tabs = exists ? prev.tabs : [...prev.tabs, { href, title }];
        return { tabs, activeHref: href };
      });
      router.push(href);
    },
    [router],
  );

  const closeTab = useCallback(
    (href: string) => {
      setState((prev) => {
        const idx = prev.tabs.findIndex((t) => t.href === href);
        if (idx === -1) return prev;
        const tabs = prev.tabs.filter((t) => t.href !== href);
        let activeHref = prev.activeHref;
        if (activeHref === href) {
          const next = tabs[idx] ?? tabs[idx - 1] ?? null;
          activeHref = next?.href ?? null;
          if (activeHref) router.push(activeHref);
        }
        return { tabs, activeHref };
      });
    },
    [router],
  );

  const setActive = useCallback(
    (href: string) => {
      setState((prev) => ({ ...prev, activeHref: href }));
      router.push(href);
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
  if (href === "/drive" || href === "/") return "Drive";
  if (href.startsWith("/papers")) return "Papers";
  if (href.startsWith("/notes")) return "Notes";
  if (href.startsWith("/references")) return "References";
  if (href.startsWith("/n/")) return decodeURIComponent(href.slice(3));
  if (href.startsWith("/p/")) return "Paper";
  if (href.startsWith("/d/")) return "Folder";
  if (href.startsWith("/r/")) return "Reference";
  if (href.startsWith("/settings")) return "Settings";
  return href;
}

export function TabBar() {
  const { tabs, activeHref, setActive, closeTab, openTab } = useTabs();

  return (
    <div
      role="tablist"
      aria-label="Open tabs"
      className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-background/60 px-2 backdrop-blur"
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
              "group flex h-7 max-w-[180px] items-center gap-1 rounded-md border border-transparent px-2 text-xs",
              active
                ? "bg-muted text-foreground border-border"
                : "text-muted-foreground hover:bg-muted/50",
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
              className="rounded p-0.5 text-muted-foreground opacity-0 hover:bg-background hover:text-foreground group-hover:opacity-100"
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
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
