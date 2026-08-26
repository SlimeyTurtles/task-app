import { PageShell } from "@/components/app/page-shell";
import { CHANGELOG, PLANNED_FEATURES, type ChangeKind } from "@/lib/changelog";
import { Sparkles } from "lucide-react";

const KIND_LABEL: Record<ChangeKind, string> = {
  added: "New",
  improved: "Improved",
  fixed: "Fixed",
};

const KIND_CLASS: Record<ChangeKind, string> = {
  added: "bg-primary/10 text-primary border-primary/25",
  improved: "bg-accent text-accent-foreground border-accent-foreground/15",
  fixed: "bg-muted text-muted-foreground border-border",
};

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function ChangelogPage() {
  return (
    <PageShell
      title="Changelog"
      description="What's new in the Almanac, one version at a time."
    >
      <div className="max-w-3xl space-y-8 pb-8">
        <section className="rounded-lg border border-dashed border-primary/30 bg-primary/[0.04] p-5">
          <h2 className="font-heading text-lg font-semibold flex items-center gap-2">
            <Sparkles className="size-4 text-primary" aria-hidden />
            On the horizon
          </h2>
          <ul className="mt-3 space-y-1.5 text-[0.95rem] text-muted-foreground">
            {PLANNED_FEATURES.map((f) => (
              <li key={f} className="flex gap-2.5">
                <span className="text-primary/60 select-none" aria-hidden>
                  ◦
                </span>
                {f}
              </li>
            ))}
          </ul>
        </section>

        <ol className="relative space-y-10 border-l border-border pl-6 ml-2">
          {CHANGELOG.map((entry) => (
            <li key={entry.version} className="relative">
              <span
                className="absolute -left-[31px] top-1.5 size-2.5 rounded-full bg-primary ring-4 ring-background"
                aria-hidden
              />
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="font-heading text-xl font-semibold tracking-tight">
                  {entry.title}
                </h2>
                <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary">
                  v{entry.version}
                </span>
                <time dateTime={entry.date} className="text-sm text-muted-foreground">
                  {formatDate(entry.date)}
                </time>
              </div>
              <ul className="mt-3 space-y-2">
                {entry.changes.map((c) => (
                  <li key={c.text} className="flex items-start gap-2.5 text-[0.95rem]">
                    <span
                      className={`mt-0.5 shrink-0 rounded-full border px-2 py-px text-[0.7rem] font-medium ${KIND_CLASS[c.kind]}`}
                    >
                      {KIND_LABEL[c.kind]}
                    </span>
                    <span>{c.text}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    </PageShell>
  );
}
