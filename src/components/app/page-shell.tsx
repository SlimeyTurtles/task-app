import type { ReactNode } from "react";

export function PageShell({
  title,
  description,
  actions,
  children,
  /** When true the content area does not scroll (used by the calendar, which fits the viewport). */
  fill = false,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
  fill?: boolean;
}) {
  return (
    <div className="flex flex-col h-full min-h-0 w-full max-w-screen-2xl mx-auto px-6 md:px-8 pt-6 pb-6 gap-5">
      {title ? (
        <header className="flex items-start justify-between gap-4 shrink-0">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight">{title}</h1>
            {description ? (
              <p className="text-muted-foreground mt-1 max-w-2xl text-[0.95rem]">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </header>
      ) : null}
      <div className={fill ? "flex-1 min-h-0 flex flex-col" : "flex-1 min-h-0 overflow-y-auto"}>
        {children}
      </div>
    </div>
  );
}

export function PhaseStub({ phase }: { phase: number }) {
  return (
    <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground bg-card/40">
      <p className="text-sm">
        This page becomes functional in <span className="font-medium text-foreground">Phase {phase}</span> of the
        build plan.
      </p>
    </div>
  );
}
