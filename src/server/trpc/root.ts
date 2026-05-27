import { router, publicProcedure } from "./init";
import { areasRouter } from "./routers/areas";
import { projectsRouter } from "./routers/projects";
import { tagsRouter } from "./routers/tags";
import { tasksRouter } from "./routers/tasks";

export const appRouter = router({
  health: publicProcedure.query(() => ({ status: "ok" as const, time: new Date().toISOString() })),
  areas: areasRouter,
  projects: projectsRouter,
  tags: tagsRouter,
  tasks: tasksRouter,
});

export type AppRouter = typeof appRouter;
