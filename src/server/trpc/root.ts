import { router, publicProcedure } from "./init";

// Root router. Sub-routers (tasks, areas, projects, tags, events, ...) land here
// in later phases as their corresponding features are built.
export const appRouter = router({
  health: publicProcedure.query(() => ({ status: "ok" as const, time: new Date().toISOString() })),
});

export type AppRouter = typeof appRouter;
