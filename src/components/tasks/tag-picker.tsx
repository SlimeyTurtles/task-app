"use client";

import { useMemo, useState } from "react";
import { ChevronDown, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";

export function TagPicker({
  value,
  onChange,
  placeholder = "Add tags…",
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const { data: tags } = trpc.tags.list.useQuery();
  const [search, setSearch] = useState("");

  const tagsById = useMemo(() => new Map(tags?.map((t) => [t.id, t]) ?? []), [tags]);

  const filtered = useMemo(() => {
    if (!tags) return [];
    const q = search.trim().toLowerCase();
    return q ? tags.filter((t) => t.name.toLowerCase().includes(q)) : tags;
  }, [tags, search]);

  function toggle(id: string) {
    if (value.includes(id)) onChange(value.filter((v) => v !== id));
    else onChange([...value, id]);
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="w-full justify-between">
            <span className="flex flex-wrap gap-1 items-center min-w-0">
              {value.length === 0 ? (
                <span className="text-muted-foreground">{placeholder}</span>
              ) : (
                value.map((id) => {
                  const t = tagsById.get(id);
                  return (
                    <Badge key={id} variant="secondary" className="gap-1">
                      {t?.name ?? id}
                      <span
                        role="button"
                        tabIndex={0}
                        className="cursor-pointer text-muted-foreground hover:text-foreground inline-flex"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggle(id);
                        }}
                      >
                        <X className="size-3" />
                      </span>
                    </Badge>
                  );
                })
              )}
            </span>
            <ChevronDown className="size-4 text-muted-foreground" />
          </Button>
        }
      />
      <PopoverContent className="w-64 p-2">
        <Input
          placeholder="Filter tags…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-2"
        />
        <div className="max-h-64 overflow-y-auto space-y-0.5">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2 text-center">No tags.</p>
          ) : (
            filtered.map((tag) => (
              <label
                key={tag.id}
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 rounded-md text-sm cursor-pointer hover:bg-accent",
                )}
              >
                <Checkbox checked={value.includes(tag.id)} onCheckedChange={() => toggle(tag.id)} />
                <span className="truncate flex-1">{tag.name}</span>
              </label>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
