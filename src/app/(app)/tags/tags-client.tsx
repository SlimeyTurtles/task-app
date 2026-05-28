"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Pencil, Plus, Share2, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import { ShareDialog, type ShareTarget } from "@/components/sharing/share-dialog";

type TagRow = {
  id: string;
  name: string;
  parentTagId: string | null;
  color: string | null;
  description: string | null;
  _count: { tasks: number; projects: number };
};

type TreeNode = TagRow & { children: TreeNode[] };

function buildTree(tags: TagRow[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const t of tags) byId.set(t.id, { ...t, children: [] });
  const roots: TreeNode[] = [];
  for (const t of byId.values()) {
    if (t.parentTagId && byId.has(t.parentTagId)) {
      byId.get(t.parentTagId)!.children.push(t);
    } else {
      roots.push(t);
    }
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

export function TagsClient() {
  const { data: tags, isLoading } = trpc.tags.list.useQuery();
  const utils = trpc.useUtils();
  const del = trpc.tags.delete.useMutation({
    onSuccess: () => utils.tags.list.invalidate(),
  });

  const [dialog, setDialog] = useState<{
    open: boolean;
    tag?: TagRow | null;
    parentTagId?: string | null;
  }>({ open: false });
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);

  const tree = useMemo(() => buildTree(tags ?? []), [tags]);

  function openNew(parentTagId?: string | null) {
    setDialog({ open: true, tag: null, parentTagId });
  }
  function openEdit(tag: TagRow) {
    setDialog({ open: true, tag });
  }

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => openNew(null)}>
          <Plus className="size-4" /> New tag
        </Button>
      </div>

      <div className="mt-6">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading tags…</p>
        ) : tree.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tags yet. Tags are orthogonal to areas/projects — use them for context labels like
            &quot;morning,&quot; &quot;low-energy,&quot; &quot;errand,&quot; or for groupings like Seymour → Cats → Pets.
          </p>
        ) : (
          <Card className="p-2">
            <ul className="space-y-0.5">
              {tree.map((node) => (
                <TreeRow
                  key={node.id}
                  node={node}
                  depth={0}
                  onAddChild={(id) => openNew(id)}
                  onEdit={openEdit}
                  onShare={(node) => setShareTarget({ kind: "tag", id: node.id, name: node.name })}
                  onDelete={(id, name) => {
                    if (!confirm(`Delete tag "${name}"? Child tags will be re-parented to its parent.`)) return;
                    del.mutate({ id }, { onError: (e) => toast.error(e.message) });
                  }}
                />
              ))}
            </ul>
          </Card>
        )}
      </div>

      <TagDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        tag={dialog.tag}
        parentTagId={dialog.parentTagId}
        allTags={tags ?? []}
      />

      <ShareDialog
        open={shareTarget !== null}
        onOpenChange={(open) => {
          if (!open) setShareTarget(null);
        }}
        target={shareTarget}
      />
    </>
  );
}

function TreeRow({
  node,
  depth,
  onAddChild,
  onEdit,
  onShare,
  onDelete,
}: {
  node: TreeNode;
  depth: number;
  onAddChild: (id: string) => void;
  onEdit: (tag: TagRow) => void;
  onShare: (node: TreeNode) => void;
  onDelete: (id: string, name: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <li>
      <div
        className={cn(
          "group flex items-center gap-1 px-2 py-1.5 rounded-md hover:bg-accent/50",
        )}
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        {node.children.length > 0 ? (
          <button
            onClick={() => setExpanded((e) => !e)}
            className="size-5 inline-flex items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            <ChevronRight className={cn("size-4 transition-transform", expanded && "rotate-90")} />
          </button>
        ) : (
          <span className="size-5" />
        )}
        {node.color ? (
          <span className="size-3 rounded-full shrink-0" style={{ backgroundColor: node.color }} />
        ) : null}
        <span className="text-sm flex-1 truncate">{node.name}</span>
        <Badge variant="outline" className="text-xs font-normal">
          {node._count.tasks} tasks
        </Badge>
        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100">
          <Button variant="ghost" size="icon" className="size-7" onClick={() => onAddChild(node.id)}>
            <Plus className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="size-7" onClick={() => onEdit(node)}>
            <Pencil className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="size-7" onClick={() => onShare(node)}>
            <Share2 className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => onDelete(node.id, node.name)}
          >
            <Trash2 className="size-3.5 text-destructive" />
          </Button>
        </div>
      </div>
      {expanded && node.children.length > 0 ? (
        <ul className="space-y-0.5">
          {node.children.map((c) => (
            <TreeRow
              key={c.id}
              node={c}
              depth={depth + 1}
              onAddChild={onAddChild}
              onEdit={onEdit}
              onShare={onShare}
              onDelete={onDelete}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

const TagSchema = z.object({
  name: z.string().trim().min(1).max(64),
  parentTagId: z.string().optional(),
  color: z.string().max(32).optional(),
  description: z.string().max(2000).optional(),
});
type TagFormValues = z.infer<typeof TagSchema>;

function TagDialog({
  open,
  onOpenChange,
  tag,
  parentTagId,
  allTags,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tag?: TagRow | null;
  parentTagId?: string | null;
  allTags: TagRow[];
}) {
  const utils = trpc.useUtils();
  const create = trpc.tags.create.useMutation();
  const update = trpc.tags.update.useMutation();

  const form = useForm<TagFormValues>({
    resolver: zodResolver(TagSchema),
    defaultValues: {
      name: tag?.name ?? "",
      parentTagId: tag?.parentTagId ?? parentTagId ?? "",
      color: tag?.color ?? "",
      description: tag?.description ?? "",
    },
  });

  // Reset when opening for a different tag.
  useMemo(() => {
    form.reset({
      name: tag?.name ?? "",
      parentTagId: tag?.parentTagId ?? parentTagId ?? "",
      color: tag?.color ?? "",
      description: tag?.description ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag?.id, parentTagId, open]);

  const possibleParents = useMemo(() => {
    // Exclude self and descendants when editing.
    if (!tag) return allTags;
    const blocked = new Set<string>([tag.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const t of allTags) {
        if (t.parentTagId && blocked.has(t.parentTagId) && !blocked.has(t.id)) {
          blocked.add(t.id);
          changed = true;
        }
      }
    }
    return allTags.filter((t) => !blocked.has(t.id));
  }, [allTags, tag]);

  async function onSubmit(values: TagFormValues) {
    const payload = {
      name: values.name.trim(),
      parentTagId: values.parentTagId || null,
      color: values.color?.trim() || null,
      description: values.description?.trim() || null,
    };
    try {
      if (tag) {
        await update.mutateAsync({ id: tag.id, ...payload });
        toast.success("Tag updated.");
      } else {
        await create.mutateAsync(payload);
        toast.success("Tag created.");
      }
      await utils.tags.list.invalidate();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save tag.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tag ? "Edit tag" : "New tag"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="tag-name">Name</Label>
            <Input id="tag-name" autoFocus {...form.register("name")} />
            {form.formState.errors.name ? (
              <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tag-parent">Parent tag</Label>
            <select
              id="tag-parent"
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              {...form.register("parentTagId")}
            >
              <option value="">— Top-level —</option>
              {possibleParents.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tag-color">Color (CSS)</Label>
            <Input id="tag-color" placeholder="#10b981" {...form.register("color")} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tag-desc">Description</Label>
            <Textarea id="tag-desc" rows={2} {...form.register("description")} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {tag ? "Save changes" : "Create tag"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
