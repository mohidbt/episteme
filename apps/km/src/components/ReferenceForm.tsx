"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { validateCslJson, type CslItem } from "@/lib/csl";
import type { ReferenceRow } from "@/lib/references-server";
import { cn } from "@/lib/utils";

interface ReferenceFormProps {
  reference: ReferenceRow;
}

interface AuthorFields {
  family: string;
  given: string;
}

interface FormState {
  citationKey: string;
  folderPath: string;
  title: string;
  authors: AuthorFields[];
  year: string;
  containerTitle: string;
  doi: string;
  url: string;
  abstract: string;
  // Preserve any unknown CSL fields so we round-trip them on save.
  extraCsl: Record<string, unknown>;
}

function toAuthors(csl: CslItem): AuthorFields[] {
  const list = Array.isArray(csl.author) ? csl.author : [];
  return list.map((a) => ({ family: a.family ?? "", given: a.given ?? "" }));
}

function readYear(csl: CslItem): string {
  const y = csl.issued?.["date-parts"]?.[0]?.[0];
  return typeof y === "number" && Number.isFinite(y) ? String(y) : "";
}

const KNOWN_CSL_KEYS = new Set([
  "id",
  "type",
  "title",
  "author",
  "issued",
  "container-title",
  "DOI",
  "URL",
  "abstract",
]);

function toForm(ref: ReferenceRow): FormState {
  const csl = (ref.cslJson ?? { id: ref.id, type: "article" }) as CslItem;
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(csl)) {
    if (!KNOWN_CSL_KEYS.has(k)) extra[k] = v;
  }
  return {
    citationKey: ref.citationKey,
    folderPath: ref.folderPath,
    title: csl.title ?? "",
    authors: toAuthors(csl),
    year: readYear(csl),
    containerTitle: (csl["container-title"] as string | undefined) ?? "",
    doi: csl.DOI ?? "",
    url: csl.URL ?? "",
    abstract: csl.abstract ?? "",
    extraCsl: extra,
  };
}

function buildCslFromForm(form: FormState, base: CslItem): CslItem {
  const out: Record<string, unknown> = { ...form.extraCsl };
  out.id = base.id ?? form.citationKey;
  out.type = base.type ?? "article";
  if (form.title.trim()) out.title = form.title.trim();
  const authors = form.authors
    .map((a) => ({
      family: a.family.trim(),
      given: a.given.trim(),
    }))
    .filter((a) => a.family || a.given)
    .map((a) => {
      const obj: { family?: string; given?: string } = {};
      if (a.family) obj.family = a.family;
      if (a.given) obj.given = a.given;
      return obj;
    });
  if (authors.length > 0) out.author = authors;
  const yearTrim = form.year.trim();
  if (yearTrim) {
    const n = Number(yearTrim);
    if (Number.isFinite(n)) out.issued = { "date-parts": [[n]] };
  }
  if (form.containerTitle.trim()) out["container-title"] = form.containerTitle.trim();
  if (form.doi.trim()) out.DOI = form.doi.trim();
  if (form.url.trim()) out.URL = form.url.trim();
  if (form.abstract.trim()) out.abstract = form.abstract.trim();
  return out as CslItem;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function ReferenceForm({ reference }: ReferenceFormProps) {
  const router = useRouter();
  const initialCsl = useMemo(
    () => (reference.cslJson ?? { id: reference.id, type: "article" }) as CslItem,
    [reference],
  );
  const [initial, setInitial] = useState<ReferenceRow>(reference);
  const [form, setForm] = useState<FormState>(() => toForm(reference));
  const [tab, setTab] = useState<"form" | "json">("form");
  const [jsonText, setJsonText] = useState(() =>
    JSON.stringify(initialCsl, null, 2),
  );
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function addAuthor() {
    setForm((p) => ({ ...p, authors: [...p.authors, { family: "", given: "" }] }));
  }

  function removeAuthor(idx: number) {
    setForm((p) => ({ ...p, authors: p.authors.filter((_, i) => i !== idx) }));
  }

  function updateAuthor(idx: number, patch: Partial<AuthorFields>) {
    setForm((p) => ({
      ...p,
      authors: p.authors.map((a, i) => (i === idx ? { ...a, ...patch } : a)),
    }));
  }

  function switchToJsonTab() {
    // Re-serialize current form state into JSON when leaving the form tab,
    // so the JSON view reflects unsaved edits.
    const csl = buildCslFromForm(form, initialCsl);
    setJsonText(JSON.stringify(csl, null, 2));
    setJsonError(null);
    setTab("json");
  }

  function switchToFormTab() {
    // If JSON is valid, pull it into form state on tab switch.
    try {
      const parsed = JSON.parse(jsonText);
      const csl = validateCslJson(parsed);
      const extra: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(csl)) {
        if (!KNOWN_CSL_KEYS.has(k)) extra[k] = v;
      }
      setForm((p) => ({
        ...p,
        title: csl.title ?? "",
        authors: toAuthors(csl),
        year: readYear(csl),
        containerTitle: (csl["container-title"] as string | undefined) ?? "",
        doi: csl.DOI ?? "",
        url: csl.URL ?? "",
        abstract: csl.abstract ?? "",
        extraCsl: extra,
      }));
      setJsonError(null);
      setTab("form");
    } catch (err) {
      setJsonError((err as Error).message);
      // Stay on JSON tab to force fix.
    }
  }

  function validateJsonOnBlur() {
    try {
      const parsed = JSON.parse(jsonText);
      validateCslJson(parsed);
      setJsonError(null);
    } catch (err) {
      setJsonError((err as Error).message);
    }
  }

  async function save() {
    const patch: Record<string, unknown> = {};

    let nextCsl: CslItem;
    if (tab === "json") {
      try {
        const parsed = JSON.parse(jsonText);
        nextCsl = validateCslJson(parsed);
        setJsonError(null);
      } catch (err) {
        setJsonError((err as Error).message);
        toast.error("Invalid CSL JSON", { description: (err as Error).message });
        return;
      }
    } else {
      nextCsl = buildCslFromForm(form, initialCsl);
    }

    if (form.citationKey.trim() !== initial.citationKey) {
      patch.citationKey = form.citationKey.trim();
    }
    if (form.folderPath !== initial.folderPath) {
      patch.folderPath = form.folderPath;
    }
    if (!deepEqual(nextCsl, initialCsl)) {
      patch.cslJson = nextCsl;
    }

    if (Object.keys(patch).length === 0) {
      toast.info("No changes");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/references/${reference.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const desc =
          body?.error === "validation" && Array.isArray(body?.issues) && body.issues[0]
            ? `${(body.issues[0].path ?? []).join(".") || "field"}: ${body.issues[0].message}`
            : (body?.error ?? body?.message ?? `HTTP ${res.status}`);
        toast.error("Save failed", { description: desc });
        return;
      }
      const updated = (await res.json()) as ReferenceRow;
      setInitial(updated);
      setForm(toForm(updated));
      setJsonText(
        JSON.stringify(
          (updated.cslJson ?? { id: updated.id, type: "article" }) as CslItem,
          null,
          2,
        ),
      );
      toast.success("Saved");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1 border-b">
        <TabButton active={tab === "form"} onClick={switchToFormTab}>
          Form
        </TabButton>
        <TabButton active={tab === "json"} onClick={switchToJsonTab}>
          JSON
        </TabButton>
        <div className="ml-auto">
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {tab === "form" ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="ref-key">Citation key</Label>
              <Input
                id="ref-key"
                value={form.citationKey}
                onChange={(e) => set("citationKey", e.currentTarget.value)}
                className="font-mono"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ref-folder">Folder</Label>
              <Input
                id="ref-folder"
                value={form.folderPath}
                onChange={(e) => set("folderPath", e.currentTarget.value)}
                placeholder="projects/phd/"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ref-title">Title</Label>
            <Input
              id="ref-title"
              value={form.title}
              onChange={(e) => set("title", e.currentTarget.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label>Authors</Label>
            <div className="flex flex-col gap-2">
              {form.authors.map((a, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    value={a.family}
                    onChange={(e) => updateAuthor(idx, { family: e.currentTarget.value })}
                    placeholder="Family"
                  />
                  <Input
                    value={a.given}
                    onChange={(e) => updateAuthor(idx, { given: e.currentTarget.value })}
                    placeholder="Given"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeAuthor(idx)}
                    aria-label={`Remove author ${idx + 1}`}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addAuthor}
                className="self-start"
              >
                <Plus className="size-3.5" />
                Add author
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="ref-year">Year</Label>
              <Input
                id="ref-year"
                type="number"
                inputMode="numeric"
                value={form.year}
                onChange={(e) => set("year", e.currentTarget.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ref-container">Container title</Label>
              <Input
                id="ref-container"
                value={form.containerTitle}
                onChange={(e) => set("containerTitle", e.currentTarget.value)}
                placeholder="Journal or book title"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="ref-doi">DOI</Label>
              <Input
                id="ref-doi"
                value={form.doi}
                onChange={(e) => set("doi", e.currentTarget.value)}
                placeholder="10.1000/xyz123"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ref-url">URL</Label>
              <Input
                id="ref-url"
                value={form.url}
                onChange={(e) => set("url", e.currentTarget.value)}
                placeholder="https://…"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ref-abstract">Abstract</Label>
            <textarea
              id="ref-abstract"
              rows={4}
              value={form.abstract}
              onChange={(e) => set("abstract", e.currentTarget.value)}
              className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Label htmlFor="ref-json">CSL JSON</Label>
          <textarea
            id="ref-json"
            value={jsonText}
            onChange={(e) => setJsonText(e.currentTarget.value)}
            onBlur={validateJsonOnBlur}
            rows={22}
            spellCheck={false}
            className={cn(
              "w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
              jsonError && "border-destructive",
            )}
          />
          {jsonError && (
            <p className="text-xs text-destructive">{jsonError}</p>
          )}
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground -mb-px border-b-2 border-transparent",
        active && "border-foreground text-foreground",
      )}
    >
      {children}
    </button>
  );
}
