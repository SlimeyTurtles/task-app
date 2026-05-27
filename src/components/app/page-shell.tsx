import type { ReactNode } from "react";

export function PageShell({
  title,
  description,
  actions,
  children,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6 p-6 md:p-8 max-w-screen-2xl w-full">
      {title ? (
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {description ? <p className="text-muted-foreground mt-1">{description}</p> : null}
          </div>
          {actions}
        </header>
      ) : null}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function PhaseStub({ phase }: { phase: number }) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
      <p className="text-sm">
        This page becomes functional in <span className="font-medium text-foreground">Phase {phase}</span> of the
        build plan.
      </p>
    </div>
  );
}
