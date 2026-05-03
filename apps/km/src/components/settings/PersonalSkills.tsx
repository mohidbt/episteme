"use client";

// Personal skills CRUD table for Settings -> Agent -> Skills.
//
// Lists user-authored skill entries from /api/agents/skills/personal,
// supports + new (dialog), edit description + instructions, delete inline.
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

export type PersonalSkill = {
  slug: string;
  name: string;
  description: string;
  instructions: string;
};

async function fetchList(): Promise<PersonalSkill[]> {
  const res = await fetch("/api/agents/skills/personal");
  if (!res.ok) throw new Error(`http ${res.status}`);
  const body = (await res.json()) as { skills: PersonalSkill[] };
  return body.skills ?? [];
}

export function PersonalSkills() {
  const [skills, setSkills] = React.useState<PersonalSkill[] | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createName, setCreateName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState<{
    slug: string;
    name: string;
    description: string;
    instructions: string;
  } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void fetchList()
      .then((list) => {
        if (!cancelled) setSkills(list);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setSkills([]);
          toast.error(`Failed to load skills: ${err.message}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate() {
    const name = createName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await fetch("/api/agents/skills/personal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const created = (await res.json()) as PersonalSkill;
      setSkills((prev) => [...(prev ?? []), created]);
      setCreateName("");
      setCreateOpen(false);
    } catch (err) {
      toast.error(
        `Create failed: ${err instanceof Error ? err.message : "unknown"}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function openEdit(slug: string) {
    setEditing({ slug, name: "", description: "", instructions: "" });
    setBusy(true);
    try {
      const res = await fetch(`/api/agents/skills/personal/${slug}`);
      if (!res.ok) throw new Error(`http ${res.status}`);
      const body = (await res.json()) as {
        slug: string;
        name?: string;
        description: string;
        instructions: string;
      };
      setEditing({
        slug: body.slug,
        name: body.name ?? "",
        description: body.description ?? "",
        instructions: body.instructions ?? "",
      });
    } catch (err) {
      setEditing(null);
      toast.error(
        `Load failed: ${err instanceof Error ? err.message : "unknown"}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/agents/skills/personal/${editing.slug}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: editing.name,
            description: editing.description,
            instructions: editing.instructions,
          }),
        },
      );
      if (!res.ok) throw new Error(`http ${res.status}`);
      // Refresh list to pick up updated description.
      const updated = await fetchList();
      setSkills(updated);
      setEditing(null);
      toast.success("Saved");
    } catch (err) {
      toast.error(
        `Save failed: ${err instanceof Error ? err.message : "unknown"}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(slug: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/agents/skills/personal/${slug}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      setSkills((prev) => (prev ?? []).filter((s) => s.slug !== slug));
    } catch (err) {
      toast.error(
        `Delete failed: ${err instanceof Error ? err.message : "unknown"}`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="personal-skills">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Your Skills</div>
        <Button
          type="button"
          size="sm"
          className="bg-foreground text-background hover:bg-foreground/90"
          onClick={() => setCreateOpen(true)}
          data-testid="new-skill-button"
        >
          + New skill
        </Button>
      </div>

      {(skills?.length ?? 0) === 0 ? (
        <Empty>
          <EmptyTitle>No personal skills yet</EmptyTitle>
          <EmptyDescription>
            Add a skill to teach your agents how you work.
          </EmptyDescription>
        </Empty>
      ) : (
        <div className="rounded-md border border-border">
          <table className="w-full text-sm">
            <tbody>
              {(skills ?? []).map((s) => (
                <tr
                  key={s.slug}
                  className="border-b border-border last:border-0"
                  data-testid={`personal-skill-row-${s.slug}`}
                >
                  <td className="px-3 py-2 font-medium">{s.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {s.description || <span className="italic text-muted-foreground/60">Description missing</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => openEdit(s.slug)}
                      data-testid={`edit-skill-${s.slug}`}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(s.slug)}
                      data-testid={`delete-skill-${s.slug}`}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New skill</DialogTitle>
            <DialogDescription>
              Give your skill a short name. You can edit the details next.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Skill name"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            data-testid="new-skill-name-input"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleCreate}
              disabled={busy || !createName.trim()}
              data-testid="new-skill-submit"
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit your Skill</DialogTitle>
            <DialogDescription>
              Describe what the skill does and provide full instructions for the
              agent.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="skill-name">Name</Label>
              <Input
                id="skill-name"
                value={editing?.name ?? ""}
                onChange={(e) =>
                  setEditing((prev) =>
                    prev ? { ...prev, name: e.target.value } : prev,
                  )
                }
                placeholder="Skill name"
                disabled={busy}
                data-testid="edit-skill-name"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="skill-description">Description</Label>
              <Textarea
                id="skill-description"
                value={editing?.description ?? ""}
                onChange={(e) =>
                  setEditing((prev) =>
                    prev ? { ...prev, description: e.target.value } : prev,
                  )
                }
                rows={2}
                placeholder="Description for agent, what it can do, and when to automatically use it"
                disabled={busy && !editing?.description}
                data-testid="edit-skill-description"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="skill-instructions">Skill Instructions</Label>
              <Textarea
                id="skill-instructions"
                value={editing?.instructions ?? ""}
                onChange={(e) =>
                  setEditing((prev) =>
                    prev ? { ...prev, instructions: e.target.value } : prev,
                  )
                }
                rows={10}
                placeholder="Full instructions for agent."
                disabled={busy && !editing?.instructions}
                data-testid="edit-skill-instructions"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={saveEdit}
              disabled={busy}
              data-testid="edit-skill-save"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
