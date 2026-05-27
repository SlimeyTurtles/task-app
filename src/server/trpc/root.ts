import { router, publicProcedure } from "./init";
import { areasRouter } from "./routers/areas";
import { eventsRouter } from "./routers/events";
import { projectsRouter } from "./routers/projects";
import { tagsRouter } from "./routers/tags";
import { tasksRouter } from "./routers/tasks";
import { timeBlocksRouter } from "./routers/time-blocks";

export const appRouter = router({
  health: publicProcedure.query(() => ({ status: "ok" as const, time: new Date().toISOString() })),
  areas: areasRouter,
  projects: projectsRouter,
  tags: tagsRouter,
  tasks: tasksRouter,
  events: eventsRouter,
  timeBlocks: timeBlocksRouter,
});

export type AppRouter = typeof appRouter;
